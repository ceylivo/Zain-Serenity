import "server-only";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import InventoryDay from "@/models/InventoryDay";
import RoomType from "@/models/RoomType";
import Booking from "@/models/Booking";
import RatePlan from "@/models/RatePlan";

export class InventoryReservationError extends Error {
  constructor(message: string, public readonly code: "INVALID_STAY" | "ROOM_TYPE_UNAVAILABLE" | "RATE_PLAN_UNAVAILABLE" | "INSUFFICIENT_INVENTORY" | "TRANSACTION_UNAVAILABLE" | "RESERVATION_FAILED") {
    super(message);
    this.name = "InventoryReservationError";
  }
}
export interface CreateInventoryBookingInput {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  userId: string;
  roomTypeId: string;
  ratePlanId: string;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  children: number;
  specialRequests?: string;
}
function dateKey(date: Date): string { return date.toISOString().slice(0, 10); }
function getNights(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  while (cursor.getTime() < last) { days.push(dateKey(cursor)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return days;
}

export async function createInventoryBooking(input: CreateInventoryBookingInput) {
  if (!mongoose.isValidObjectId(input.userId) || !mongoose.isValidObjectId(input.roomTypeId) || !mongoose.isValidObjectId(input.ratePlanId) ||
      !Number.isInteger(input.guests) || input.guests < 1 || !Number.isInteger(input.children) || input.children < 0 ||
      !Number.isFinite(input.checkIn.getTime()) || !Number.isFinite(input.checkOut.getTime()) || input.checkOut <= input.checkIn) {
    throw new InventoryReservationError("The requested stay or guest details are invalid.", "INVALID_STAY");
  }
  const nights = getNights(input.checkIn, input.checkOut);
  if (nights.length < 1 || nights.length > 90) throw new InventoryReservationError("Stays must be between 1 and 90 nights.", "INVALID_STAY");

  await dbConnect();
  const roomTypeId = new mongoose.Types.ObjectId(input.roomTypeId);
  const ratePlanId = new mongoose.Types.ObjectId(input.ratePlanId);
  const roomType = await RoomType.findOne({ _id: roomTypeId, tenantId: input.tenantId, propertyId: input.propertyId, status: "active" }).lean();
  if (!roomType) throw new InventoryReservationError("Room type is not available.", "ROOM_TYPE_UNAVAILABLE");
  if (input.guests > roomType.maxAdults || input.children > roomType.maxChildren) {
    throw new InventoryReservationError("Guest count exceeds this room type's occupancy limit.", "INVALID_STAY");
  }
  const rate = await RatePlan.findOne({ _id: ratePlanId, tenantId: input.tenantId, propertyId: input.propertyId, roomTypeId, isActive: true }).lean();
  if (!rate || nights.length < rate.minimumNights || (rate.maximumNights && nights.length > rate.maximumNights)) {
    throw new InventoryReservationError("Rate plan is unavailable for these dates.", "RATE_PLAN_UNAVAILABLE");
  }
  const subtotal = rate.nightlyRate * nights.length;
  const taxes = Math.round(subtotal * rate.taxRatePercent / 100);
  const total = subtotal + taxes;
  const session = await mongoose.startSession();
  let bookingId: mongoose.Types.ObjectId | null = null;

  try {
    await session.withTransaction(async () => {
      for (const date of nights) {
        await InventoryDay.updateOne(
          { tenantId: input.tenantId, propertyId: input.propertyId, roomTypeId, date },
          { $setOnInsert: {
            tenantId: input.tenantId, propertyId: input.propertyId, roomTypeId, date,
            totalRooms: roomType.inventoryCount, availableRooms: roomType.inventoryCount,
            reservedRooms: 0, blockedRooms: 0,
          } },
          { upsert: true, session }
        );
        const claimed = await InventoryDay.findOneAndUpdate(
          { tenantId: input.tenantId, propertyId: input.propertyId, roomTypeId, date, availableRooms: { $gt: 0 } },
          { $inc: { availableRooms: -1, reservedRooms: 1 } },
          { new: true, session }
        );
        if (!claimed) throw new InventoryReservationError("No inventory remains for one or more selected nights.", "INSUFFICIENT_INVENTORY");
      }

      const [booking] = await Booking.create([{
        tenantId: input.tenantId, propertyId: input.propertyId, userId: input.userId,
        roomId: roomTypeId.toString(), roomTypeId, ratePlanId,
        checkIn: input.checkIn, checkOut: input.checkOut, guests: input.guests, children: input.children,
        specialRequests: input.specialRequests ?? "", totalPrice: total, currency: rate.currency,
        pricing: { nights: nights.length, subtotal, taxes, discount: 0, total },
        paymentStatus: "unpaid", status: "pending",
      }], { session });
      bookingId = booking._id;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });

    if (!bookingId) throw new InventoryReservationError("Reservation was not created.", "RESERVATION_FAILED");
    return await Booking.findById(bookingId).lean();
  } catch (error) {
    if (error instanceof InventoryReservationError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) {
      throw new InventoryReservationError("Booking is unavailable because the database does not support safe inventory transactions.", "TRANSACTION_UNAVAILABLE");
    }
    throw new InventoryReservationError("Unable to reserve inventory. Please retry.", "RESERVATION_FAILED");
  } finally {
    await session.endSession();
  }
}
