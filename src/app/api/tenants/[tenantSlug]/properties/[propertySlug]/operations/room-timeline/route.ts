import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isValidDateOnly } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import PhysicalRoom from "@/models/PhysicalRoom";
import Booking from "@/models/Booking";
import HousekeepingTask from "@/models/HousekeepingTask";
import MaintenanceWorkOrder from "@/models/MaintenanceWorkOrder";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const plusDay = (value: Date) => new Date(value.getTime() + 86_400_000);

export async function GET(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:read" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Room timeline access denied", 403);

  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get("from") ?? today;
  const to = url.searchParams.get("to") ?? today;
  if (!isValidDateOnly(from) || !isValidDateOnly(to) || from > to) {
    return fail("INVALID_DATE_RANGE", "Use valid YYYY-MM-DD dates and ensure the start is not after the end.", 422);
  }
  const start = day(from);
  const end = plusDay(day(to));
  if ((end.getTime() - start.getTime()) / 86_400_000 > 90) {
    return fail("DATE_RANGE_TOO_LARGE", "Room timeline ranges cannot exceed 90 days.", 422);
  }

  await dbConnect();
  const scope = { tenantId: access.tenantId, propertyId: access.propertyId };
  const [rooms, bookings, tasks, workOrders] = await Promise.all([
    PhysicalRoom.find(scope).select("_id roomNumber roomTypeId floor status").sort({ roomNumber: 1 }).lean(),
    Booking.find({ ...scope, physicalRoomId: { $ne: null }, status: { $nin: ["cancelled", "no_show"] }, checkIn: { $lt: end }, checkOut: { $gt: start } })
      .select("_id physicalRoomId checkIn checkOut status paymentStatus").sort({ checkIn: 1 }).limit(1000).lean(),
    HousekeepingTask.find({ ...scope, createdAt: { $lt: end }, $or: [{ dueAt: { $gte: start, $lt: end } }, { createdAt: { $gte: start } }, { updatedAt: { $gte: start } }] })
      .select("_id physicalRoomId title description status assignedTo dueAt completedAt statusHistory createdAt updatedAt").sort({ dueAt: 1, createdAt: 1 }).limit(1000).lean(),
    MaintenanceWorkOrder.find({ ...scope, physicalRoomId: { $ne: null }, createdAt: { $lt: end }, $or: [{ dueAt: { $gte: start, $lt: end } }, { createdAt: { $gte: start } }, { updatedAt: { $gte: start } }] })
      .select("_id physicalRoomId title description priority status assignedTo dueAt completedAt statusHistory createdAt updatedAt").sort({ dueAt: 1, createdAt: 1 }).limit(1000).lean(),
  ]);

  const events: {
    id: string; roomId: string; type: string; title: string; description?: string;
    startAt: Date; endAt?: Date; status: string; priority?: string; assignedTo?: string;
    sourceId: string; activity?: boolean;
  }[] = [];
  for (const booking of bookings) {
    if (!booking.physicalRoomId) continue;
    events.push({
      id: `booking:${booking._id}`, sourceId: booking._id.toString(), roomId: booking.physicalRoomId.toString(),
      type: "booking", title: `Booking · ${booking._id.toString().slice(-8).toUpperCase()}`,
      startAt: booking.checkIn, endAt: booking.checkOut, status: booking.status,
    });
  }
  for (const task of tasks) {
    const roomId = task.physicalRoomId.toString();
    events.push({
      id: `housekeeping:${task._id}`, sourceId: task._id.toString(), roomId, type: "housekeeping",
      title: task.title, description: task.description, startAt: task.dueAt ?? task.createdAt,
      status: task.status, assignedTo: task.assignedTo?.toString(),
    });
    for (const [index, entry] of (task.statusHistory ?? []).entries()) {
      if (entry.changedAt >= start && entry.changedAt < end) events.push({
        id: `housekeeping-history:${task._id}:${index}`, sourceId: task._id.toString(), roomId,
        type: "housekeeping_activity", title: `${task.title} · ${entry.status.replaceAll("_", " ")}`,
        startAt: entry.changedAt, status: entry.status, activity: true,
      });
    }
  }
  for (const order of workOrders) {
    if (!order.physicalRoomId) continue;
    const roomId = order.physicalRoomId.toString();
    events.push({
      id: `maintenance:${order._id}`, sourceId: order._id.toString(), roomId, type: "maintenance",
      title: order.title, description: order.description, startAt: order.dueAt ?? order.createdAt,
      status: order.status, priority: order.priority, assignedTo: order.assignedTo?.toString(),
    });
    for (const [index, entry] of (order.statusHistory ?? []).entries()) {
      if (entry.changedAt >= start && entry.changedAt < end) events.push({
        id: `maintenance-history:${order._id}:${index}`, sourceId: order._id.toString(), roomId,
        type: "maintenance_activity", title: `${order.title} · ${entry.status.replaceAll("_", " ")}`,
        description: entry.note, startAt: entry.changedAt, status: entry.status, activity: true,
      });
    }
  }

  const allowedRoomIds = new Set(rooms.map((room) => room._id.toString()));
  const scopedEvents = events.filter((event) => allowedRoomIds.has(event.roomId))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return NextResponse.json({
    data: {
      range: { from, to },
      rooms: rooms.map((room) => ({
        id: room._id.toString(), roomNumber: room.roomNumber, roomTypeId: room.roomTypeId.toString(),
        floor: room.floor ?? "", status: room.status,
      })),
      events: scopedEvents,
      truncated: bookings.length >= 1000 || tasks.length >= 1000 || workOrders.length >= 1000,
    },
  });
}
