import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isValidDateOnly } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import InventoryDay from "@/models/InventoryDay";
import InventoryBlock from "@/models/InventoryBlock";
import RoomType from "@/models/RoomType";

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
