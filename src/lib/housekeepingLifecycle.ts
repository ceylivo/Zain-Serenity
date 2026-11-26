import "server-only";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import PhysicalRoom, { type PhysicalRoomStatus } from "@/models/PhysicalRoom";
import AuditLog from "@/models/AuditLog";

export class HousekeepingError extends Error {
  constructor(message: string, public readonly code: "ROOM_NOT_FOUND" | "INVALID_ROOM_STATE" | "HOUSEKEEPING_FAILED") {
    super(message);
    this.name = "HousekeepingError";
  }
}

const transitions: Record<PhysicalRoomStatus, readonly PhysicalRoomStatus[]> = {
  ready: ["cleaning", "maintenance", "out_of_service"],
  occupied: ["cleaning"],
  cleaning: ["ready", "maintenance", "out_of_service"],
  maintenance: ["ready", "out_of_service"],
  out_of_service: ["maintenance", "ready"],
};

export async function updateHousekeepingStatus(input: {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  roomId: string;
  actorUserId: string;
  status: PhysicalRoomStatus;
}) {
  await dbConnect();
  if (!mongoose.isValidObjectId(input.roomId) || !mongoose.isValidObjectId(input.actorUserId)) {
    throw new HousekeepingError("Physical room was not found.", "ROOM_NOT_FOUND");
  }
  const session = await mongoose.startSession();
  let result: Record<string, unknown> | null = null;
  try {
    await session.withTransaction(async () => {
      const room = await PhysicalRoom.findOne({
        _id: new mongoose.Types.ObjectId(input.roomId),
        tenantId: input.tenantId,
        propertyId: input.propertyId,
      }).session(session);
      if (!room) throw new HousekeepingError("Physical room was not found.", "ROOM_NOT_FOUND");
      if (room.status === input.status) {
        result = room.toObject() as unknown as Record<string, unknown>;
        return;
      }
      if (!transitions[room.status].includes(input.status)) {
        throw new HousekeepingError(`Room cannot transition from ${room.status} to ${input.status}.`, "INVALID_ROOM_STATE");
      }
      if (input.status === "ready" || input.status === "maintenance" || input.status === "out_of_service") {
        const activeBooking = await (await import("@/models/Booking")).default.exists({
          tenantId: input.tenantId, propertyId: input.propertyId,
          physicalRoomId: room._id, status: "checked_in",
        }).session(session);
        if (activeBooking) throw new HousekeepingError("A room assigned to an in-house guest cannot be marked ready or unavailable.", "INVALID_ROOM_STATE");
      }
      const updated = await PhysicalRoom.findOneAndUpdate(
        { _id: room._id, tenantId: input.tenantId, propertyId: input.propertyId, status: room.status },
        { $set: { status: input.status } },
        { new: true, session }
      );
      if (!updated) throw new HousekeepingError("Room status changed. Refresh and retry.", "INVALID_ROOM_STATE");
      await AuditLog.create([{
        tenantId: input.tenantId, propertyId: input.propertyId,
        actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
        action: "inventory.housekeeping.status_changed", resourceType: "physical_room",
        resourceId: room._id.toString(), outcome: "success",
        metadata: { from: room.status, to: input.status, roomNumber: room.roomNumber },
      }], { session });
      result = updated.toObject() as unknown as Record<string, unknown>;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return result;
  } catch (error) {
    if (error instanceof HousekeepingError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) {
      throw new HousekeepingError("Housekeeping updates require MongoDB transactions.", "HOUSEKEEPING_FAILED");
    }
    throw new HousekeepingError("Unable to update room status.", "HOUSEKEEPING_FAILED");
  } finally {
    await session.endSession();
  }
}
