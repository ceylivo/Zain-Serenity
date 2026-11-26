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

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });
const dayStart = (value: string) => new Date(`${value}T00:00:00.000Z`);
const nextDay = (value: string) => new Date(dayStart(value).getTime() + 86400000);

export async function GET(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "booking:read" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Dashboard access denied", 403);

  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!isValidDateOnly(date)) return fail("INVALID_DATE", "Date must use YYYY-MM-DD.", 422);
  const start = dayStart(date);
  const end = nextDay(date);
  const now = new Date();
  const sevenDays = new Date(start.getTime() + 7 * 86400000);
  await dbConnect();

  const scope = { tenantId: access.tenantId, propertyId: access.propertyId };
  const activeBooking = { ...scope, status: { $in: ["pending", "confirmed"] } };
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
    date, timezone: "UTC",
    bookings: { arrivals, departures, inHouse, newToday: newBookings, pendingPayments },
    rooms: { total: totalRooms, ready: roomReady, occupied: roomOccupied, cleaning: roomCleaning, maintenance: roomMaintenance, outOfService: roomOutOfService },
    operations: { openHousekeeping, overdueHousekeeping, openMaintenance, urgentMaintenance },
    upcoming: [...upcomingArrivals.map((item) => serialize(item, "arrival")), ...upcomingDepartures.map((item) => serialize(item, "departure"))]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(0, 12),
  } });
}
