import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isValidDateOnly } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import Booking from "@/models/Booking";
import PhysicalRoom from "@/models/PhysicalRoom";
import HousekeepingTask from "@/models/HousekeepingTask";
import MaintenanceWorkOrder from "@/models/MaintenanceWorkOrder";
import Property from "@/models/Property";
import { getDateInTimeZoneStart, getDateKeyInTimeZone, getNextDateKey } from "@/lib/propertyTime";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });

export async function GET(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "booking:read" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Dashboard access denied", 403);

  await dbConnect();
  const property = await Property.findOne({ _id: access.propertyId, tenantId: access.tenantId }).select("timezone").lean();
  if (!property) return fail("PROPERTY_NOT_FOUND", "Property was not found in this workspace.", 404);
  const timezone = property.timezone || "UTC";
  const now = new Date();
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? getDateKeyInTimeZone(now, timezone);
  if (!isValidDateOnly(date)) return fail("INVALID_DATE", "Date must use YYYY-MM-DD.", 422);
  let start: Date;
  let end: Date;
  let sevenDays: Date;
  try {
    start = getDateInTimeZoneStart(date, timezone);
    const nextDate = getNextDateKey(date);
    end = getDateInTimeZoneStart(nextDate, timezone);
    let seventhDate = date;
    for (let day = 0; day < 7; day += 1) seventhDate = getNextDateKey(seventhDate);
    sevenDays = getDateInTimeZoneStart(seventhDate, timezone);
  } catch {
    return fail("INVALID_PROPERTY_TIMEZONE", "The property's configured timezone is invalid.", 422);
  }

  const scope = { tenantId: access.tenantId as mongoose.Types.ObjectId, propertyId: access.propertyId as mongoose.Types.ObjectId };
  const activeBooking = { ...scope, status: { $in: ["pending", "confirmed"] as const } };
  const [
    totalRooms, roomReady, roomOccupied, roomCleaning, roomMaintenance, roomOutOfService,
    arrivals, departures, inHouse, newBookings, pendingPayments,
    openHousekeeping, overdueHousekeeping, openMaintenance, urgentMaintenance,
    upcomingArrivals, upcomingDepartures,
  ] = await Promise.all([
    PhysicalRoom.countDocuments(scope),
    PhysicalRoom.countDocuments({ ...scope, status: "ready" }),
    PhysicalRoom.countDocuments({ ...scope, status: "occupied" }),
    PhysicalRoom.countDocuments({ ...scope, status: "cleaning" }),
    PhysicalRoom.countDocuments({ ...scope, status: "maintenance" }),
    PhysicalRoom.countDocuments({ ...scope, status: "out_of_service" }),
    Booking.countDocuments({ ...activeBooking, checkIn: { $gte: start, $lt: end } }),
    Booking.countDocuments({ ...scope, status: "checked_in", checkOut: { $gte: start, $lt: end } }),
    Booking.countDocuments({ ...scope, status: "checked_in", checkIn: { $lte: now }, checkOut: { $gt: now } }),
    Booking.countDocuments({ ...scope, createdAt: { $gte: start, $lt: end } }),
    Booking.countDocuments({ ...scope, status: { $nin: ["cancelled", "checked_out", "no_show"] }, paymentStatus: { $in: ["unpaid", "pending", "failed"] } }),
    HousekeepingTask.countDocuments({ ...scope, status: { $in: ["open", "in_progress"] } }),
    HousekeepingTask.countDocuments({ ...scope, status: { $in: ["open", "in_progress"] }, dueAt: { $lt: now } }),
    MaintenanceWorkOrder.countDocuments({ ...scope, status: { $in: ["open", "in_progress", "blocked"] } }),
    MaintenanceWorkOrder.countDocuments({ ...scope, status: { $in: ["open", "in_progress", "blocked"] }, priority: "urgent" }),
    Booking.find({ ...activeBooking, checkIn: { $gte: start, $lt: sevenDays } }).select("_id checkIn checkOut guests status physicalRoomId roomTypeId").sort({ checkIn: 1 }).limit(10).lean(),
    Booking.find({ ...scope, status: "checked_in", checkOut: { $gte: start, $lt: sevenDays } }).select("_id checkIn checkOut guests status physicalRoomId roomTypeId").sort({ checkOut: 1 }).limit(10).lean(),
  ]);

  const roomIds = [...new Set([...upcomingArrivals, ...upcomingDepartures].map((booking) => booking.physicalRoomId?.toString()).filter((id): id is string => Boolean(id)))];
  const rooms = roomIds.length ? await PhysicalRoom.find({ ...scope, _id: { $in: roomIds } }).select("_id roomNumber").lean() : [];
  const roomNames = new Map(rooms.map((room) => [room._id.toString(), room.roomNumber]));
  const serialize = (booking: (typeof upcomingArrivals)[number], kind: "arrival" | "departure") => ({
    id: booking._id.toString(), kind, date: kind === "arrival" ? booking.checkIn : booking.checkOut,
    guests: booking.guests, status: booking.status, roomNumber: booking.physicalRoomId ? roomNames.get(booking.physicalRoomId.toString()) ?? null : null,
  });

  return NextResponse.json({ data: {
    date, timezone,
    bookings: { arrivals, departures, inHouse, newToday: newBookings, pendingPayments },
    rooms: { total: totalRooms, ready: roomReady, occupied: roomOccupied, cleaning: roomCleaning, maintenance: roomMaintenance, outOfService: roomOutOfService },
    operations: { openHousekeeping, overdueHousekeeping, openMaintenance, urgentMaintenance },
    upcoming: [...upcomingArrivals.map((item) => serialize(item, "arrival")), ...upcomingDepartures.map((item) => serialize(item, "departure"))]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 12),
  } });
}
