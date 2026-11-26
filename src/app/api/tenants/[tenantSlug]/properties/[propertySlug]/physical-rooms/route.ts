import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import RoomType from "@/models/RoomType";
import PhysicalRoom from "@/models/PhysicalRoom";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });

export async function GET(_request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:read" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Physical room access denied", 403);
  await dbConnect();
  const items = await PhysicalRoom.find({ tenantId: access.tenantId, propertyId: access.propertyId }).sort({ roomNumber: 1 }).lean();
  return NextResponse.json({ data: items });
}

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:manage" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Physical room management access denied", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const roomTypeId = readString(body.roomTypeId, { min: 24, max: 24 });
  const roomNumber = readString(body.roomNumber, { min: 1, max: 24 });
  if (!roomTypeId || !mongoose.isValidObjectId(roomTypeId) || !roomNumber) return fail("VALIDATION_ERROR", "A valid room type and room number are required", 422);
  await dbConnect();
  const roomType = await RoomType.findOne({ _id: roomTypeId, tenantId: access.tenantId, propertyId: access.propertyId }).select("_id").lean();
  if (!roomType) return fail("ROOM_TYPE_NOT_FOUND", "Room type does not belong to this property", 404);
  try {
    const room = await PhysicalRoom.create({
      tenantId: access.tenantId, propertyId: access.propertyId, roomTypeId: roomType._id,
      roomNumber, floor: readString(body.floor, { max: 24 }) ?? undefined,
      notes: readString(body.notes, { max: 1000 }) ?? "",
    });
    await AuditLog.create({ tenantId: access.tenantId, propertyId: access.propertyId, actorUserId: new mongoose.Types.ObjectId(session.user.id), action: "inventory.physical_room.created", resourceType: "physical_room", resourceId: room._id.toString(), outcome: "success" });
    return NextResponse.json({ data: room }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) return fail("PHYSICAL_ROOM_CONFLICT", "Room number already exists in this property", 409);
    console.error("Physical room creation failed", error);
    return fail("PHYSICAL_ROOM_CREATE_FAILED", "Unable to create physical room", 500);
  }
}
