import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, isValidDateOnly, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import RoomType from "@/models/RoomType";
import Booking from "@/models/Booking";
import InventoryDay from "@/models/InventoryDay";
import InventoryBlock from "@/models/InventoryBlock";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

function dateKeys(startDate: string, endDate: string): string[] {
  const cursor = new Date(startDate + "T00:00:00.000Z");
  const end = new Date(endDate + "T00:00:00.000Z");
  const dates: string[] = [];
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}


export async function GET(_request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:read" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Inventory read permission is required", 403);
  await dbConnect();
  const blocks = await InventoryBlock.find({ tenantId: access.tenantId, propertyId: access.propertyId })
    .sort({ createdAt: -1 }).limit(100).lean();
  return NextResponse.json({ data: blocks.map((block) => ({
    id: block._id.toString(), roomTypeId: block.roomTypeId.toString(),
    startDate: block.startDate, endDate: block.endDate, quantity: block.quantity,
    remainingQuantity: block.remainingQuantity, releasedQuantity: block.releasedQuantity,
    status: block.status, reason: block.reason, createdAt: block.createdAt,
    createdBy: block.createdBy.toString(), lastReleasedAt: block.lastReleasedAt ?? null,
  })) });
}

export async function PATCH(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:manage" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Inventory management permission is required", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const blockId = readString(body.blockId, { min: 24, max: 24 });
  const quantity = body.quantity;
  const reason = readString(body.reason, { min: 3, max: 300 });
  if (!blockId || !mongoose.isValidObjectId(blockId) || !Number.isInteger(quantity) || Number(quantity) < 1 || !reason) {
    return fail("VALIDATION_ERROR", "A valid block ID, positive release quantity and reason are required", 422);
  }
  await dbConnect();
  const block = await InventoryBlock.findOne({
    _id: blockId, tenantId: access.tenantId, propertyId: access.propertyId,
  }).lean();
  if (!block) return fail("BLOCK_NOT_FOUND", "Inventory block was not found in this property", 404);
  if (block.status === "released" || Number(quantity) > block.remainingQuantity) {
    return fail("INVALID_RELEASE_QUANTITY", "Release quantity exceeds the remaining blocked quantity", 409);
  }
  const dates = dateKeys(block.startDate, block.endDate);
  const scope = { tenantId: access.tenantId, propertyId: access.propertyId, roomTypeId: block.roomTypeId };
  const sessionDb = await mongoose.startSession();
  try {
    let updatedBlock: Record<string, unknown> | null = null;
    await sessionDb.withTransaction(async () => {
      for (const date of dates) {
        const day = await InventoryDay.findOneAndUpdate(
          { ...scope, date, blockedRooms: { $gte: Number(quantity) } },
          { $inc: { availableRooms: Number(quantity), blockedRooms: -Number(quantity) } },
          { new: true, session: sessionDb }
        );
        if (!day) throw new Error("BLOCK_INVENTORY_INCONSISTENT");
      }
      const updated = await InventoryBlock.findOneAndUpdate(
        { _id: blockId, tenantId: access.tenantId, propertyId: access.propertyId, remainingQuantity: { $gte: Number(quantity) }, status: { $ne: "released" } },
        { $inc: { remainingQuantity: -Number(quantity), releasedQuantity: Number(quantity) },
          $set: { lastReleasedBy: new mongoose.Types.ObjectId(session.user.id), lastReleasedAt: new Date() } },
        { new: true, session: sessionDb }
      );
      if (!updated) throw new Error("BLOCK_ALREADY_CHANGED");
      updated.status = updated.remainingQuantity === 0 ? "released" : "partially_released";
      await updated.save({ session: sessionDb });
      updatedBlock = { id: updated._id.toString(), remainingQuantity: updated.remainingQuantity, releasedQuantity: updated.releasedQuantity, status: updated.status };
      await AuditLog.create([{
        tenantId: access.tenantId, propertyId: access.propertyId,
        actorUserId: new mongoose.Types.ObjectId(session.user.id),
        action: "inventory.block.partially_released", resourceType: "inventory_block",
        resourceId: blockId, outcome: "success",
        metadata: { quantity: Number(quantity), reason, startDate: block.startDate, endDate: block.endDate },
      }], { session: sessionDb });
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return NextResponse.json({ data: updatedBlock });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "BLOCK_INVENTORY_INCONSISTENT" || message === "BLOCK_ALREADY_CHANGED") return fail("BLOCK_CONFLICT", "This block changed or its inventory counters are inconsistent; refresh and retry", 409);
    if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) return fail("TRANSACTION_UNAVAILABLE", "Inventory changes require MongoDB transaction support", 503);
    console.error("Inventory block release failed", error);
    return fail("BLOCK_RELEASE_FAILED", "Unable to release this inventory block", 500);
  } finally { await sessionDb.endSession(); }
}

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return fail("UNAUTHENTICATED", "Authentication required", 401);
  }
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({
    userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:manage",
  });
  if (!access.ok || !access.propertyId) {
    return fail("FORBIDDEN", "Inventory management permission is required", 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return fail("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);

  const action = readString(body.action, { min: 5, max: 7 });
  const roomTypeId = readString(body.roomTypeId, { min: 24, max: 24 });
  const startDate = readString(body.startDate, { min: 10, max: 10 });
  const endDate = readString(body.endDate, { min: 10, max: 10 });
  const quantity = body.quantity;
  const reason = readString(body.reason, { min: 3, max: 300 });
  if (!action || !["block", "unblock"].includes(action) ||
      !roomTypeId || !mongoose.isValidObjectId(roomTypeId) ||
      !startDate || !isValidDateOnly(startDate) ||
      !endDate || !isValidDateOnly(endDate) ||
      !Number.isInteger(quantity) || Number(quantity) < 1 ||
      !reason) {
    return fail("VALIDATION_ERROR", "Provide action, room type, valid date range, positive quantity and reason", 422);
  }

  const dates = dateKeys(startDate, endDate);
  if (dates.length < 1 || dates.length > 31 || endDate < startDate) {
    return fail("INVALID_DATE_RANGE", "Inventory adjustments must cover between 1 and 31 days", 422);
  }
  await dbConnect();
  const scope = {
    tenantId: access.tenantId,
    propertyId: access.propertyId,
    roomTypeId: new mongoose.Types.ObjectId(roomTypeId),
  };
  const roomType = await RoomType.findOne({
    _id: scope.roomTypeId, tenantId: scope.tenantId, propertyId: scope.propertyId, status: "active",
  }).select("_id inventoryCount").lean();
  if (!roomType) return fail("ROOM_TYPE_NOT_FOUND", "Active room type was not found in this property", 404);
  if (Number(quantity) > roomType.inventoryCount) {
    return fail("INVALID_QUANTITY", "Quantity cannot exceed this room type inventory capacity", 422);
  }
  const rangeStart = new Date(startDate + "T00:00:00.000Z");
  const rangeEnd = new Date(endDate + "T00:00:00.000Z");
  const legacyBookings = await Booking.find({
    tenantId: access.tenantId, propertyId: access.propertyId, roomTypeId: scope.roomTypeId,
    status: { $in: ["pending", "confirmed", "checked_in"] },
    checkIn: { $lt: new Date(rangeEnd.getTime() + 86400000) }, checkOut: { $gt: rangeStart },
  }).select("checkIn checkOut").lean();
  const legacyReservedByDate = new Map<string, number>();
  for (const date of dates) {
    const dayStart = new Date(date + "T00:00:00.000Z");
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    legacyReservedByDate.set(date, legacyBookings.filter((booking) => booking.checkIn < dayEnd && booking.checkOut > dayStart).length);
  }

  for (const date of dates) {
    try {
      await InventoryDay.updateOne(
        { ...scope, date },
        { $setOnInsert: {
          ...scope, date, totalRooms: roomType.inventoryCount,
          availableRooms: Math.max(0, roomType.inventoryCount - (legacyReservedByDate.get(date) ?? 0)),
          reservedRooms: legacyReservedByDate.get(date) ?? 0, blockedRooms: 0,
        } },
        { upsert: true }
      );
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) throw error;
    }
  }

  const sessionDb = await mongoose.startSession();
  let createdBlockId = "";
  try {
    await sessionDb.withTransaction(async () => {
      if (action === "block") {
        for (const date of dates) {
          const updated = await InventoryDay.findOneAndUpdate(
            { ...scope, date, availableRooms: { $gte: Number(quantity) } },
            { $inc: { availableRooms: -Number(quantity), blockedRooms: Number(quantity) } },
            { new: true, session: sessionDb }
          );
          if (!updated) throw new Error("INSUFFICIENT_AVAILABLE_INVENTORY");
        }
        const [block] = await InventoryBlock.create([{
          ...scope,
          startDate,
          endDate,
          quantity: Number(quantity),
          remainingQuantity: Number(quantity),
          status: "active",
          reason,
          createdBy: new mongoose.Types.ObjectId(session.user.id),
          releasedQuantity: 0,
        }], { session: sessionDb });
        createdBlockId = block._id.toString();
      } else {
        // Legacy quantity-only unblocks remain supported for old records.
        for (const date of dates) {
          const updated = await InventoryDay.findOneAndUpdate(
            { ...scope, date, blockedRooms: { $gte: Number(quantity) } },
            { $inc: { availableRooms: Number(quantity), blockedRooms: -Number(quantity) } },
            { new: true, session: sessionDb }
          );
          if (!updated) throw new Error("INSUFFICIENT_BLOCKED_INVENTORY");
        }
      }
      await AuditLog.create([{
        tenantId: access.tenantId,
        propertyId: access.propertyId,
        actorUserId: new mongoose.Types.ObjectId(session.user.id),
        action: action === "block" ? "inventory.rooms.blocked" : "inventory.rooms.unblocked",
        resourceType: action === "block" ? "inventory_block" : "room_type",
        resourceId: createdBlockId || roomType._id.toString(),
        outcome: "success",
        metadata: { startDate, endDate, quantity: Number(quantity), reason },
      }], { session: sessionDb });
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return NextResponse.json({ data: { action, blockId: createdBlockId || null, roomTypeId, startDate, endDate, quantity: Number(quantity) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "INSUFFICIENT_AVAILABLE_INVENTORY") {
      return fail("INSUFFICIENT_INVENTORY", "Cannot block rooms that are already reserved or unavailable", 409);
    }
    if (message === "INSUFFICIENT_BLOCKED_INVENTORY") {
      return fail("INSUFFICIENT_BLOCKED_INVENTORY", "Cannot unblock more rooms than are currently blocked", 409);
    }
    if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) {
      return fail("TRANSACTION_UNAVAILABLE", "Inventory changes require MongoDB transaction support", 503);
    }
    console.error("Inventory adjustment failed", error);
    return fail("INVENTORY_ADJUSTMENT_FAILED", "Unable to update inventory for this date range", 500);
  } finally {
    await sessionDb.endSession();
  }
}
