import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isValidDateOnly, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import RoomType from "@/models/RoomType";
import InventoryDay from "@/models/InventoryDay";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return fail("UNAUTHENTICATED", "Authentication required", 401);
  }
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({
    userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:read",
  });
  if (!access.ok) {
    const status = access.reason === "tenant_not_found" || access.reason === "property_not_found" ? 404 : 403;
    return fail("FORBIDDEN", "Inventory access denied", status);
  }
  if (!access.propertyId) return fail("PROPERTY_REQUIRED", "A property is required", 400);

  const url = new URL(request.url);
  const startDate = readString(url.searchParams.get("startDate"), { min: 10, max: 10 });
  const endDate = readString(url.searchParams.get("endDate"), { min: 10, max: 10 });
  if (!startDate || !endDate || !isValidDateOnly(startDate) || !isValidDateOnly(endDate)) {
    return fail("VALIDATION_ERROR", "Valid startDate and endDate (YYYY-MM-DD) are required", 422);
  }
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (days < 1 || days > 31) return fail("INVALID_DATE_RANGE", "Availability ranges must contain between 1 and 31 days", 422);

  await dbConnect();
  const scope = { tenantId: access.tenantId, propertyId: access.propertyId };
  const [roomTypes, inventory] = await Promise.all([
    RoomType.find({ ...scope, status: "active" })
      .select("_id name inventoryCount currency")
      .sort({ name: 1 })
      .lean(),
    InventoryDay.find({ ...scope, date: { $gte: startDate, $lte: endDate } })
      .select("roomTypeId date totalRooms availableRooms reservedRooms blockedRooms")
      .lean(),
  ]);

  const inventoryByKey = new Map(inventory.map((item) => [
    `${item.roomTypeId.toString()}:${item.date}`,
    item,
  ]));
  const dates = Array.from({ length: days }, (_, index) => addDays(startDate, index));
  const data = roomTypes.map((roomType) => ({
    roomTypeId: roomType._id.toString(),
    name: roomType.name,
    currency: roomType.currency,
    inventory: dates.map((date) => {
      const day = inventoryByKey.get(`${roomType._id.toString()}:${date}`);
      const totalRooms = day?.totalRooms ?? roomType.inventoryCount;
      const reservedRooms = day?.reservedRooms ?? 0;
      const blockedRooms = day?.blockedRooms ?? 0;
      const availableRooms = day?.availableRooms ?? Math.max(0, totalRooms - reservedRooms - blockedRooms);
      return { date, totalRooms, availableRooms, reservedRooms, blockedRooms };
    }),
  }));
  return NextResponse.json({ data: { startDate, endDate, dates, roomTypes: data } });
}
