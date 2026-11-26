import "server-only";
import mongoose, { type ClientSession } from "mongoose";
import PhysicalRoom from "@/models/PhysicalRoom";
import Booking from "@/models/Booking";
import HousekeepingTask from "@/models/HousekeepingTask";
import MaintenanceWorkOrder from "@/models/MaintenanceWorkOrder";
import AuditLog from "@/models/AuditLog";

export async function synchronizePhysicalRoomOperationalStatus(input: {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  physicalRoomId: mongoose.Types.ObjectId;
  actorUserId: mongoose.Types.ObjectId;
  session: ClientSession;
  source: "housekeeping_task" | "maintenance_work_order";
}) {
  const room = await PhysicalRoom.findOne({
    _id: input.physicalRoomId,
    tenantId: input.tenantId,
    propertyId: input.propertyId,
  }).session(input.session);
  if (!room || room.status === "occupied" || room.status === "out_of_service") return room;

  const checkedInBooking = await Booking.exists({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    physicalRoomId: room._id,
    status: "checked_in",
  }).session(input.session);
  if (checkedInBooking) return room;

  const [openMaintenance, openHousekeeping] = await Promise.all([
    MaintenanceWorkOrder.exists({
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      physicalRoomId: room._id,
      status: { $in: ["open", "in_progress", "blocked"] },
    }).session(input.session),
    HousekeepingTask.exists({
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      physicalRoomId: room._id,
      status: { $in: ["open", "in_progress"] },
    }).session(input.session),
  ]);

  const nextStatus = openMaintenance ? "maintenance" : openHousekeeping ? "cleaning"
    : room.status === "maintenance" || room.status === "cleaning" ? "ready" : room.status;
  if (nextStatus === room.status) return room;

  const updated = await PhysicalRoom.findOneAndUpdate({
    _id: room._id,
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    status: room.status,
  }, { $set: { status: nextStatus } }, { new: true, session: input.session });
  if (!updated) throw new Error("Room status changed concurrently. Refresh and retry.");

  await AuditLog.create([{
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    actorUserId: input.actorUserId,
    action: "physical_room.operational_status_synchronized",
    resourceType: "physical_room",
    resourceId: room._id.toString(),
    outcome: "success",
    metadata: {
      roomNumber: room.roomNumber,
      before: room.status,
      after: nextStatus,
      source: input.source,
      openMaintenance: Boolean(openMaintenance),
      openHousekeeping: Boolean(openHousekeeping),
    },
  }], { session: input.session });
  return updated;
}
