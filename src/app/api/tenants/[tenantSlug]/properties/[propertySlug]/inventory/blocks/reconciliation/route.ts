import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, isValidDateOnly, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import InventoryDay from "@/models/InventoryDay";
import InventoryBlock from "@/models/InventoryBlock";
import RoomType from "@/models/RoomType";
import InventoryReconciliationCase from "@/models/InventoryReconciliationCase";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

function dateKeys(from: string, to: string): string[] {
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const dates: string[] = [];
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Read-only comparison between persisted daily blocked counters and the sum
 * represented by tracked InventoryBlock records. This deliberately never
 * mutates counters or fabricates missing block history.
 */
export async function GET(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return fail("UNAUTHENTICATED", "Authentication required", 401);
  }
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({
    userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:read",
  });
  if (!access.ok || !access.propertyId) {
    return fail("FORBIDDEN", "Inventory read permission is required", 403);
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isValidDateOnly(from) || !isValidDateOnly(to) || to < from) {
    return fail("INVALID_DATE_RANGE", "Provide valid from and to dates with from on or before to", 422);
  }
  const dates = dateKeys(from, to);
  if (dates.length > 31) return fail("INVALID_DATE_RANGE", "Reconciliation range cannot exceed 31 days", 422);

  await dbConnect();
  const [days, blocks] = await Promise.all([
    InventoryDay.find({
      tenantId: access.tenantId, propertyId: access.propertyId,
      date: { $gte: from, $lte: to },
    }).select("roomTypeId date totalRooms availableRooms reservedRooms blockedRooms").lean(),
    InventoryBlock.find({
      tenantId: access.tenantId, propertyId: access.propertyId,
      status: { $in: ["active", "partially_released"] },
      startDate: { $lte: to }, endDate: { $gte: from },
      remainingQuantity: { $gt: 0 },
    }).select("roomTypeId startDate endDate remainingQuantity status").lean(),
  ]);

  const roomTypeIds = [...new Set([
    ...days.map((day) => day.roomTypeId.toString()),
    ...blocks.map((block) => block.roomTypeId.toString()),
  ])];
  const roomTypes = roomTypeIds.length
    ? await RoomType.find({
        _id: { $in: roomTypeIds }, tenantId: access.tenantId, propertyId: access.propertyId,
      }).select("_id name").lean()
    : [];
  const names = new Map(roomTypes.map((roomType) => [roomType._id.toString(), roomType.name]));
  const dayMap = new Map(days.map((day) => [`${day.roomTypeId.toString()}:${day.date}`, day]));
  const discrepancies: Array<{
    roomTypeId: string; roomTypeName: string; date: string;
    inventoryBlocked: number; trackedBlocked: number;
    legacyUntracked: number; overtracked: number;
    inventoryDayMissing: boolean;
  }> = [];

  for (const roomTypeId of roomTypeIds) {
    for (const date of dates) {
      const day = dayMap.get(`${roomTypeId}:${date}`);
      const trackedBlocked = blocks.reduce((sum, block) => {
        return block.roomTypeId.toString() === roomTypeId &&
          block.startDate <= date && block.endDate >= date
          ? sum + block.remainingQuantity : sum;
      }, 0);
      const inventoryBlocked = day?.blockedRooms ?? 0;
      const legacyUntracked = Math.max(0, inventoryBlocked - trackedBlocked);
      const overtracked = Math.max(0, trackedBlocked - inventoryBlocked);
      if (legacyUntracked > 0 || overtracked > 0 || (!day && trackedBlocked > 0)) {
        discrepancies.push({
          roomTypeId, roomTypeName: names.get(roomTypeId) ?? "Unknown room type",
          date, inventoryBlocked, trackedBlocked, legacyUntracked, overtracked,
          inventoryDayMissing: !day,
        });
      }
    }
  }

  return NextResponse.json({
    data: {
      period: { from, to },
      summary: {
        datesChecked: dates.length,
        discrepancies: discrepancies.length,
        legacyUntrackedUnits: discrepancies.reduce((sum, item) => sum + item.legacyUntracked, 0),
        overtrackedUnits: discrepancies.reduce((sum, item) => sum + item.overtracked, 0),
        missingInventoryDays: discrepancies.filter((item) => item.inventoryDayMissing).length,
      },
      discrepancies,
      safeToAutoMigrate: false,
      message: "Read-only audit only. Legacy quantities do not contain enough history to safely infer original block records. No inventory counters or block records were changed.",
    },
  });
}


/**
 * Opens an immutable review case for a discrepancy observed by the read-only
 * audit. Recomputes the snapshot before recording it and never changes stock.
 */
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
    return fail("FORBIDDEN", "Inventory management permission is required to open a review case", 403);
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return fail("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const roomTypeId = readString(body.roomTypeId, { min: 24, max: 24 });
  const date = readString(body.date, { min: 10, max: 10 });
  const reason = readString(body.reason, { min: 3, max: 500 });
  if (!roomTypeId || !mongoose.isValidObjectId(roomTypeId) || !date || !isValidDateOnly(date) || !reason) {
    return fail("VALIDATION_ERROR", "Room type, valid date and review reason are required", 422);
  }

  await dbConnect();
  const scope = {
    tenantId: access.tenantId,
    propertyId: access.propertyId,
    roomTypeId: new mongoose.Types.ObjectId(roomTypeId),
  };
  const sessionDb = await mongoose.startSession();
  let responseData: Record<string, unknown> | null = null;
  let created = false;
  try {
    await sessionDb.withTransaction(async () => {
      const day = await InventoryDay.findOne({ ...scope, date })
        .select("blockedRooms updatedAt").session(sessionDb).lean();
      const blocks = await InventoryBlock.find({
        ...scope, status: { $in: ["active", "partially_released"] },
        startDate: { $lte: date }, endDate: { $gte: date }, remainingQuantity: { $gt: 0 },
      }).select("_id remainingQuantity updatedAt").session(sessionDb).lean();
      const roomType = await RoomType.findOne({
        _id: scope.roomTypeId, tenantId: access.tenantId, propertyId: access.propertyId,
      }).select("_id").session(sessionDb).lean();
      if (!roomType) throw new Error("ROOM_TYPE_NOT_FOUND");

      const inventoryBlocked = day?.blockedRooms ?? 0;
      const trackedBlocked = blocks.reduce((sum, block) => sum + block.remainingQuantity, 0);
      const legacyUntracked = Math.max(0, inventoryBlocked - trackedBlocked);
      const overtracked = Math.max(0, trackedBlocked - inventoryBlocked);
      if (legacyUntracked === 0 && overtracked === 0 && day) throw new Error("DISCREPANCY_NO_LONGER_EXISTS");
      if (!day && trackedBlocked === 0) throw new Error("RECONCILIATION_SNAPSHOT_UNVERIFIABLE");

      // Conditional source-document writes create a conflict with concurrent
      // transactional inventory writers without changing any stock counters.
      const fenceAt = new Date();
      if (day) {
        const fencedDay = await InventoryDay.updateOne(
          { ...scope, date, blockedRooms: inventoryBlocked, updatedAt: day.updatedAt },
          { $set: { updatedAt: fenceAt } },
          { session: sessionDb, timestamps: false }
        );
        if (fencedDay.modifiedCount !== 1) throw new Error("RECONCILIATION_SNAPSHOT_CHANGED");
      } else {
        for (const block of blocks) {
          const fencedBlock = await InventoryBlock.updateOne(
            { _id: block._id, ...scope, remainingQuantity: block.remainingQuantity, updatedAt: block.updatedAt },
            { $set: { updatedAt: fenceAt } },
            { session: sessionDb, timestamps: false }
          );
          if (fencedBlock.modifiedCount !== 1) throw new Error("RECONCILIATION_SNAPSHOT_CHANGED");
        }
      }

      const snapshotKey = [inventoryBlocked, trackedBlocked, legacyUntracked, overtracked, day ? "present" : "missing"].join(":");
      const existingCase = await InventoryReconciliationCase.findOne({ ...scope, date, snapshotKey }).session(sessionDb);
      if (existingCase) {
        responseData = {
          id: existingCase._id.toString(), status: existingCase.status, createdAt: existingCase.createdAt,
          snapshot: { date, inventoryBlocked, trackedBlocked, legacyUntracked, overtracked, inventoryDayMissing: !day },
          message: "A review case for this exact snapshot already exists. No inventory quantities were changed.",
        };
        return;
      }
      const [reviewCase] = await InventoryReconciliationCase.create([{
        ...scope, date, inventoryBlocked, trackedBlocked, legacyUntracked, overtracked,
        snapshotKey, reason, status: "open", createdBy: new mongoose.Types.ObjectId(session.user.id),
      }], { session: sessionDb });
      created = true;
      responseData = {
        id: reviewCase._id.toString(), status: reviewCase.status, createdAt: reviewCase.createdAt,
        snapshot: { date, inventoryBlocked, trackedBlocked, legacyUntracked, overtracked, inventoryDayMissing: !day },
        message: "Review case recorded. Inventory quantities were not changed.",
      };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return NextResponse.json({ data: responseData }, { status: created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ROOM_TYPE_NOT_FOUND") return fail("ROOM_TYPE_NOT_FOUND", "Room type was not found in this property", 404);
    if (message === "DISCREPANCY_NO_LONGER_EXISTS") return fail("DISCREPANCY_NO_LONGER_EXISTS", "The inventory counters now match tracked blocks. Run the audit again.", 409);
    if (message === "RECONCILIATION_SNAPSHOT_CHANGED" || message === "RECONCILIATION_SNAPSHOT_UNVERIFIABLE") {
      return fail("RECONCILIATION_SNAPSHOT_CHANGED", "Inventory changed while this review case was being opened. Run the audit again and retry.", 409);
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      const duplicate = await InventoryReconciliationCase.findOne({ ...scope, date }).sort({ createdAt: -1 }).lean();
      if (duplicate) return NextResponse.json({ data: {
        id: duplicate._id.toString(), status: duplicate.status, createdAt: duplicate.createdAt,
        snapshot: { date, inventoryBlocked: duplicate.inventoryBlocked, trackedBlocked: duplicate.trackedBlocked,
          legacyUntracked: duplicate.legacyUntracked, overtracked: duplicate.overtracked },
        message: "A matching review case already exists. No inventory quantities were changed.",
      } });
    }
    if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) {
      return fail("TRANSACTION_UNAVAILABLE", "Opening review cases requires MongoDB transaction support", 503);
    }
    console.error("Inventory reconciliation case creation failed", error);
    return fail("RECONCILIATION_CASE_FAILED", "Unable to record this reconciliation case", 500);
  } finally {
    await sessionDb.endSession();
  }
}
