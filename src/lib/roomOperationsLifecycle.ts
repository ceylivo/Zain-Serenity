import "server-only";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import PhysicalRoom from "@/models/PhysicalRoom";
import HousekeepingTask from "@/models/HousekeepingTask";
import MaintenanceWorkOrder from "@/models/MaintenanceWorkOrder";
import AuditLog from "@/models/AuditLog";

export class RoomOperationsError extends Error {
  constructor(message: string, public readonly code: "INVALID_INPUT" | "ROOM_NOT_FOUND" | "ROOM_STATE_CONFLICT" | "ACTIVE_STAY" | "OPEN_MAINTENANCE" | "ACTIVE_HOUSEKEEPING" | "TRANSACTION_UNAVAILABLE" | "OPERATION_FAILED") {
    super(message);
    this.name = "RoomOperationsError";
  }
}

function rethrow(error: unknown): never {
  if (error instanceof RoomOperationsError) throw error;
  const message = error instanceof Error ? error.message : "";
  if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) {
    throw new RoomOperationsError("Room operations require MongoDB transactions.", "TRANSACTION_UNAVAILABLE");
  }
  throw new RoomOperationsError("Room state could not be updated. Refresh and retry.", "OPERATION_FAILED");
}

export async function transitionPhysicalRoom(input: {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  roomId: string;
  actorUserId: string;
  status: "ready" | "cleaning" | "maintenance" | "out_of_service";
  note?: string;
}) {
  if (![input.roomId, input.actorUserId].every(mongoose.isValidObjectId)) {
    throw new RoomOperationsError("A valid room and actor are required.", "INVALID_INPUT");
  }
  await dbConnect();
  const session = await mongoose.startSession();
  let result: Record<string, unknown> | null = null;
  try {
    await session.withTransaction(async () => {
      const room = await PhysicalRoom.findOne({
        _id: new mongoose.Types.ObjectId(input.roomId),
        tenantId: input.tenantId,
        propertyId: input.propertyId,
      }).session(session);
      if (!room) throw new RoomOperationsError("Physical room was not found in this property.", "ROOM_NOT_FOUND");
      const previousStatus = room.status;
      if (previousStatus === "occupied") throw new RoomOperationsError("An occupied room can only change state through its booking check-in/check-out workflow.", "ACTIVE_STAY");
      if (previousStatus === input.status) {
        result = room.toObject() as unknown as Record<string, unknown>;
        return;
      }
      if (input.status === "ready") {
        const activeStay = await mongoose.model("Booking").exists({
          tenantId: input.tenantId, propertyId: input.propertyId,
          physicalRoomId: room._id, status: "checked_in",
        }).session(session);
        if (activeStay) throw new RoomOperationsError("A checked-in booking still occupies this room.", "ACTIVE_STAY");
        const openMaintenance = await MaintenanceWorkOrder.exists({
          tenantId: input.tenantId, propertyId: input.propertyId, physicalRoomId: room._id,
          status: { $in: ["open", "in_progress", "blocked"] },
        }).session(session);
        if (openMaintenance) throw new RoomOperationsError("Complete or cancel open maintenance work orders before marking this room ready.", "OPEN_MAINTENANCE");
        const openHousekeeping = await HousekeepingTask.exists({
          tenantId: input.tenantId, propertyId: input.propertyId, physicalRoomId: room._id,
          status: { $in: ["open", "in_progress"] },
        }).session(session);
        if (openHousekeeping) throw new RoomOperationsError("Complete or cancel active housekeeping tasks before marking this room ready.", "ACTIVE_HOUSEKEEPING");
      }
      if (input.status === "maintenance") {
        const activeStay = await mongoose.model("Booking").exists({
          tenantId: input.tenantId, propertyId: input.propertyId,
          physicalRoomId: room._id, status: "checked_in",
        }).session(session);
        if (activeStay) throw new RoomOperationsError("A checked-in guest cannot be displaced by a maintenance status change.", "ACTIVE_STAY");
      }
      const updated = await PhysicalRoom.findOneAndUpdate({
        _id: room._id, tenantId: input.tenantId, propertyId: input.propertyId, status: previousStatus,
      }, { $set: { status: input.status } }, { new: true, session });
      if (!updated) throw new RoomOperationsError("Room status changed concurrently. Refresh and retry.", "ROOM_STATE_CONFLICT");
      await AuditLog.create([{
        tenantId: input.tenantId, propertyId: input.propertyId,
        actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
        action: "physical_room.status_changed", resourceType: "physical_room",
        resourceId: room._id.toString(), outcome: "success",
        metadata: { roomNumber: room.roomNumber, before: previousStatus, after: input.status, note: input.note ?? "" },
      }], { session });
      result = updated.toObject() as unknown as Record<string, unknown>;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return result;
  } catch (error) {
    return rethrow(error);
  } finally {
    await session.endSession();
  }
}

export async function synchronizeRoomFromWorkOrder(input: {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  roomId: mongoose.Types.ObjectId;
  actorUserId: mongoose.Types.ObjectId;
  workOrderId: mongoose.Types.ObjectId;
  completed: boolean;
}) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const room = await PhysicalRoom.findOne({
        _id: input.roomId, tenantId: input.tenantId, propertyId: input.propertyId,
      }).session(session);
      if (!room) return;
      const hasOtherOpenOrders = await MaintenanceWorkOrder.exists({
        _id: { $ne: input.workOrderId },
        tenantId: input.tenantId, propertyId: input.propertyId, physicalRoomId: room._id,
        status: { $in: ["open", "in_progress", "blocked"] },
      }).session(session);
      if (input.completed && !hasOtherOpenOrders && room.status === "maintenance") {
        const activeStay = await mongoose.model("Booking").exists({
          tenantId: input.tenantId, propertyId: input.propertyId,
          physicalRoomId: room._id, status: "checked_in",
        }).session(session);
        if (!activeStay) {
          const openHousekeeping = await HousekeepingTask.exists({
            tenantId: input.tenantId, propertyId: input.propertyId, physicalRoomId: room._id,
            status: { $in: ["open", "in_progress"] },
          }).session(session);
          await PhysicalRoom.updateOne(
            { _id: room._id, tenantId: input.tenantId, propertyId: input.propertyId, status: "maintenance" },
            { $set: { status: openHousekeeping ? "cleaning" : "ready" } },
            { session }
          );
        }
      }
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
  } catch (error) {
    rethrow(error);
  } finally {
    await session.endSession();
  }
}
