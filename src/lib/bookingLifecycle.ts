import "server-only";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import Booking from "@/models/Booking";
import Payment from "@/models/Payment";
import InventoryDay from "@/models/InventoryDay";
import PhysicalRoom from "@/models/PhysicalRoom";
import AuditLog from "@/models/AuditLog";

export class BookingLifecycleError extends Error {
  constructor(message: string, public readonly code: "BOOKING_NOT_FOUND" | "INVALID_BOOKING_STATE" | "PAYMENT_ACTION_REQUIRED" | "INVENTORY_INCONSISTENT" | "ROOM_NOT_AVAILABLE" | "ROOM_TYPE_MISMATCH" | "ROOM_ASSIGNMENT_CONFLICT" | "LIFECYCLE_FAILED" | "TRANSACTION_UNAVAILABLE") {
    super(message);
    this.name = "BookingLifecycleError";
  }
}

function stayNights(checkIn: Date, checkOut: Date): string[] {
  const result: string[] = [];
  const cursor = new Date(Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate()));
  const end = Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate());
  while (cursor.getTime() < end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function transactionError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) {
    throw new BookingLifecycleError("This operation requires MongoDB transactions (replica set or sharded cluster).", "TRANSACTION_UNAVAILABLE");
  }
  throw new BookingLifecycleError("The booking operation could not be completed. Please retry.", "LIFECYCLE_FAILED");
}

export async function cancelTenantBooking(input: {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  bookingId: string;
  actorUserId: string;
}) {
  await dbConnect();
  if (!mongoose.isValidObjectId(input.bookingId) || !mongoose.isValidObjectId(input.actorUserId)) {
    throw new BookingLifecycleError("Booking was not found.", "BOOKING_NOT_FOUND");
  }
  const session = await mongoose.startSession();
  let result: Record<string, unknown> | null = null;

  try {
    await session.withTransaction(async () => {
      const booking = await Booking.findOne({
        _id: new mongoose.Types.ObjectId(input.bookingId),
        tenantId: input.tenantId,
        propertyId: input.propertyId,
      }).session(session);
      if (!booking) throw new BookingLifecycleError("Booking was not found.", "BOOKING_NOT_FOUND");
      if (booking.status === "cancelled") {
        result = booking.toObject() as unknown as Record<string, unknown>;
        return;
      }
      if (booking.status !== "pending" && booking.status !== "confirmed") {
        throw new BookingLifecycleError("Only pending or confirmed bookings can be cancelled.", "INVALID_BOOKING_STATE");
      }
      const paymentRecords = await Payment.find({
        tenantId: input.tenantId, propertyId: input.propertyId, bookingId: booking._id,
      }).session(session);
      if (
        paymentRecords.some((payment) => payment.status === "succeeded" || payment.status === "refunded" || payment.status === "pending_verification") ||
        (booking.paymentStatus && ["paid", "partially_paid", "partially_refunded", "refunded"].includes(booking.paymentStatus))
      ) {
        throw new BookingLifecycleError("A submitted, settled or refund-related payment requires staff review before cancellation.", "PAYMENT_ACTION_REQUIRED");
      }
      for (const payment of paymentRecords) {
        if (payment.status === "pending" && payment.isActive) {
          payment.status = "cancelled";
          payment.isActive = false;
          await payment.save({ session });
          await AuditLog.create([{
            tenantId: input.tenantId, propertyId: input.propertyId,
            actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
            action: "payment.attempt.cancelled_with_booking", resourceType: "payment",
            resourceId: payment._id.toString(), outcome: "success",
          }], { session });
        }
      }

      const updated = await Booking.findOneAndUpdate(
        { _id: booking._id, tenantId: input.tenantId, propertyId: input.propertyId, status: { $in: ["pending", "confirmed"] } },
        { $set: { status: "cancelled" } },
        { new: true, session }
      );
      if (!updated) throw new BookingLifecycleError("Booking state changed. Refresh and retry.", "INVALID_BOOKING_STATE");

      if (booking.roomTypeId) {
        for (const date of stayNights(booking.checkIn, booking.checkOut)) {
          const released = await InventoryDay.findOneAndUpdate(
            {
              tenantId: input.tenantId,
              propertyId: input.propertyId,
              roomTypeId: booking.roomTypeId,
              date,
              reservedRooms: { $gt: 0 },
              $expr: { $lt: ["$availableRooms", "$totalRooms"] },
            },
            { $inc: { reservedRooms: -1, availableRooms: 1 } },
            { new: true, session }
          );
          if (!released) {
            const exists = await InventoryDay.exists({
              tenantId: input.tenantId, propertyId: input.propertyId,
              roomTypeId: booking.roomTypeId, date,
            }).session(session);
            if (exists) throw new BookingLifecycleError("Inventory counters are inconsistent; cancellation was rolled back.", "INVENTORY_INCONSISTENT");
          }
        }
      }

      await AuditLog.create([{
        tenantId: input.tenantId, propertyId: input.propertyId,
        actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
        action: "booking.cancelled", resourceType: "booking",
        resourceId: booking._id.toString(), outcome: "success",
      }], { session });
      result = updated.toObject() as unknown as Record<string, unknown>;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return result;
  } catch (error) {
    if (error instanceof BookingLifecycleError) throw error;
    return transactionError(error);
  } finally {
    await session.endSession();
  }
}

export async function assignPhysicalRoom(input: {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  bookingId: string;
  physicalRoomId: string;
  actorUserId: string;
}) {
  await dbConnect();
  if (!mongoose.isValidObjectId(input.bookingId) || !mongoose.isValidObjectId(input.physicalRoomId) || !mongoose.isValidObjectId(input.actorUserId)) {
    throw new BookingLifecycleError("Booking or room was not found.", "BOOKING_NOT_FOUND");
  }
  const session = await mongoose.startSession();
  let result: Record<string, unknown> | null = null;

  try {
    await session.withTransaction(async () => {
      const booking = await Booking.findOne({
        _id: new mongoose.Types.ObjectId(input.bookingId),
        tenantId: input.tenantId,
        propertyId: input.propertyId,
      }).session(session);
      if (!booking) throw new BookingLifecycleError("Booking was not found.", "BOOKING_NOT_FOUND");
      if (!["pending", "confirmed"].includes(booking.status)) {
        throw new BookingLifecycleError("A room can only be assigned to a pending or confirmed booking.", "INVALID_BOOKING_STATE");
      }
      if (!booking.roomTypeId) throw new BookingLifecycleError("This legacy booking has no room type. Migrate it before assigning a physical room.", "ROOM_TYPE_MISMATCH");
      if (booking.physicalRoomId) throw new BookingLifecycleError("A physical room is already assigned. Unassign it before changing rooms.", "INVALID_BOOKING_STATE");

      // Touch the room document inside the transaction. Concurrent assignments to the
      // same room serialize on this write, while non-overlapping future stays remain valid.
      const room = await PhysicalRoom.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(input.physicalRoomId),
          tenantId: input.tenantId,
          propertyId: input.propertyId,
          roomTypeId: booking.roomTypeId,
          status: "ready",
        },
        { $inc: { assignmentVersion: 1 } },
        { new: true, session }
      );
      if (!room) {
        const exists = await PhysicalRoom.exists({
          _id: new mongoose.Types.ObjectId(input.physicalRoomId),
          tenantId: input.tenantId,
          propertyId: input.propertyId,
        }).session(session);
        if (!exists) throw new BookingLifecycleError("Physical room does not belong to this property.", "BOOKING_NOT_FOUND");
        const matchingType = await PhysicalRoom.exists({
          _id: new mongoose.Types.ObjectId(input.physicalRoomId),
          tenantId: input.tenantId, propertyId: input.propertyId,
          roomTypeId: booking.roomTypeId,
        }).session(session);
        if (!matchingType) throw new BookingLifecycleError("Physical room type does not match the booking.", "ROOM_TYPE_MISMATCH");
        throw new BookingLifecycleError("Physical room is not ready for assignment.", "ROOM_NOT_AVAILABLE");
      }

      const overlapping = await Booking.exists({
        _id: { $ne: booking._id },
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        physicalRoomId: room._id,
        status: { $in: ["pending", "confirmed", "checked_in"] },
        checkIn: { $lt: booking.checkOut },
        checkOut: { $gt: booking.checkIn },
      }).session(session);
      if (overlapping) throw new BookingLifecycleError("This physical room is assigned to an overlapping stay.", "ROOM_ASSIGNMENT_CONFLICT");

      booking.physicalRoomId = room._id;
      await booking.save({ session });
      await AuditLog.create([{
        tenantId: input.tenantId, propertyId: input.propertyId,
        actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
        action: "booking.physical_room.assigned", resourceType: "booking",
        resourceId: booking._id.toString(), outcome: "success",
        metadata: { physicalRoomId: room._id.toString(), roomNumber: room.roomNumber },
      }], { session });
      result = booking.toObject() as unknown as Record<string, unknown>;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return result;
  } catch (error) {
    if (error instanceof BookingLifecycleError) throw error;
    return transactionError(error);
  } finally {
    await session.endSession();
  }
}
