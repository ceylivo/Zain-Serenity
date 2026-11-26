import "server-only";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import Booking from "@/models/Booking";
import Payment, { type PaymentMethod } from "@/models/Payment";
import AuditLog from "@/models/AuditLog";

export class PaymentLifecycleError extends Error {
  constructor(message: string, public readonly code:
    | "BOOKING_NOT_FOUND" | "PAYMENT_NOT_FOUND" | "INVALID_PAYMENT_STATE"
    | "PAYMENT_ALREADY_SETTLED" | "PAYMENT_METHOD_UNAVAILABLE"
    | "PAYMENT_AMOUNT_INVALID" | "PAYMENT_ATTEMPT_EXISTS"
    | "TRANSACTION_UNAVAILABLE" | "PAYMENT_OPERATION_FAILED") {
    super(message);
    this.name = "PaymentLifecycleError";
  }
}

function transactionError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) {
    throw new PaymentLifecycleError("Payment operations require MongoDB transactions (replica set or sharded cluster).", "TRANSACTION_UNAVAILABLE");
  }
  throw new PaymentLifecycleError("The payment operation could not be completed. Please retry.", "PAYMENT_OPERATION_FAILED");
}

function bookingFilter(input: { tenantId: mongoose.Types.ObjectId; propertyId: mongoose.Types.ObjectId; bookingId: string }) {
  if (!mongoose.isValidObjectId(input.bookingId)) throw new PaymentLifecycleError("Booking was not found.", "BOOKING_NOT_FOUND");
  return { _id: new mongoose.Types.ObjectId(input.bookingId), tenantId: input.tenantId, propertyId: input.propertyId };
}

export async function createPaymentAttempt(input: {
  tenantId: mongoose.Types.ObjectId; propertyId: mongoose.Types.ObjectId;
  bookingId: string; userId: string; method: PaymentMethod; idempotencyKey: string;
}) {
  await dbConnect();
  if (!mongoose.isValidObjectId(input.userId)) throw new PaymentLifecycleError("Booking was not found.", "BOOKING_NOT_FOUND");
  if (input.method === "stripe") {
    throw new PaymentLifecycleError("Stripe test checkout has not been configured yet. No live or simulated charge was created.", "PAYMENT_METHOD_UNAVAILABLE");
  }
  const session = await mongoose.startSession();
  let result: Record<string, unknown> | null = null;
  try {
    await session.withTransaction(async () => {
      const existing = await Payment.findOne({
        tenantId: input.tenantId, propertyId: input.propertyId, idempotencyKey: input.idempotencyKey,
      }).session(session);
      if (existing) {
        if (existing.userId.toString() !== input.userId || existing.bookingId.toString() !== input.bookingId || existing.method !== input.method) {
          throw new PaymentLifecycleError("Idempotency key was already used for a different payment request.", "PAYMENT_ATTEMPT_EXISTS");
        }
        result = existing.toObject() as unknown as Record<string, unknown>;
        return;
      }

      const booking = await Booking.findOne(bookingFilter(input)).session(session);
      if (!booking || booking.userId !== input.userId) throw new PaymentLifecycleError("Booking was not found.", "BOOKING_NOT_FOUND");
      if (booking.status === "cancelled" || booking.status === "checked_out" || booking.status === "no_show") {
        throw new PaymentLifecycleError("This booking cannot accept payments in its current state.", "INVALID_PAYMENT_STATE");
      }
      if (booking.paymentStatus === "paid" || booking.paymentStatus === "partially_paid" || booking.paymentStatus === "partially_refunded") {
        throw new PaymentLifecycleError("This booking is already paid or requires a refund workflow.", "PAYMENT_ALREADY_SETTLED");
      }
      const amount = Math.round(booking.totalPrice * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0) throw new PaymentLifecycleError("Booking amount is invalid.", "PAYMENT_AMOUNT_INVALID");

      const activeAttempt = await Payment.findOne({
        tenantId: input.tenantId, propertyId: input.propertyId, bookingId: booking._id,
        status: { $in: ["pending", "pending_verification"] },
      }).session(session);
      if (activeAttempt) throw new PaymentLifecycleError("A payment attempt is already awaiting completion or verification.", "PAYMENT_ATTEMPT_EXISTS");

      const [payment] = await Payment.create([{
        tenantId: input.tenantId, propertyId: input.propertyId, bookingId: booking._id,
        userId: new mongoose.Types.ObjectId(input.userId), method: input.method,
        status: "pending", isActive: true, amount, currency: booking.currency || "PKR",
        idempotencyKey: input.idempotencyKey,
      }], { session });
      booking.paymentStatus = "pending";
      await booking.save({ session });
      await AuditLog.create([{
        tenantId: input.tenantId, propertyId: input.propertyId,
        actorUserId: new mongoose.Types.ObjectId(input.userId),
        action: "payment.attempt.created", resourceType: "payment",
        resourceId: payment._id.toString(), outcome: "success",
        metadata: { method: input.method, amount, currency: payment.currency },
      }], { session });
      result = payment.toObject() as unknown as Record<string, unknown>;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return result;
  } catch (error) {
    if (error instanceof PaymentLifecycleError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      throw new PaymentLifecycleError("A payment attempt is already active for this booking.", "PAYMENT_ATTEMPT_EXISTS");
    }
    return transactionError(error);
  } finally {
    await session.endSession();
  }
}

export async function submitPaymentProof(input: {
  tenantId: mongoose.Types.ObjectId; propertyId: mongoose.Types.ObjectId;
  paymentId: string; userId: string; reference?: string;
}) {
  await dbConnect();
  if (!mongoose.isValidObjectId(input.paymentId) || !mongoose.isValidObjectId(input.userId)) {
    throw new PaymentLifecycleError("Payment was not found.", "PAYMENT_NOT_FOUND");
  }
  const payment = await Payment.findOneAndUpdate({
    _id: new mongoose.Types.ObjectId(input.paymentId),
    tenantId: input.tenantId, propertyId: input.propertyId,
    userId: new mongoose.Types.ObjectId(input.userId),
    method: { $in: ["bank_transfer", "easypaisa", "jazzcash"] },
    status: "pending",
  }, {
    $set: { status: "pending_verification", submittedAt: new Date(), ...(input.reference ? { reference: input.reference } : {}) },
  }, { new: true });
  if (!payment) throw new PaymentLifecycleError("Payment is not awaiting proof submission or does not belong to this account.", "INVALID_PAYMENT_STATE");
  return payment.toObject();
}

async function settlePayment(input: {
  tenantId: mongoose.Types.ObjectId; propertyId: mongoose.Types.ObjectId;
  paymentId: string; actorUserId: string; outcome: "succeeded" | "failed";
  expectedMethods?: PaymentMethod[];
  requireSubmittedProof?: boolean;
  requirePendingOnly?: boolean;
}) {
  await dbConnect();
  if (!mongoose.isValidObjectId(input.paymentId) || !mongoose.isValidObjectId(input.actorUserId)) {
    throw new PaymentLifecycleError("Payment was not found.", "PAYMENT_NOT_FOUND");
  }
  const session = await mongoose.startSession();
  let result: Record<string, unknown> | null = null;
  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findOne({
        _id: new mongoose.Types.ObjectId(input.paymentId),
        tenantId: input.tenantId, propertyId: input.propertyId,
      }).session(session);
      if (!payment) throw new PaymentLifecycleError("Payment was not found.", "PAYMENT_NOT_FOUND");
      if (payment.status === input.outcome) {
        result = payment.toObject() as unknown as Record<string, unknown>;
        return;
      }
      if (input.requireSubmittedProof ? payment.status !== "pending_verification" : input.requirePendingOnly ? payment.status !== "pending" : payment.status !== "pending" && payment.status !== "pending_verification") {
        throw new PaymentLifecycleError("Payment is not in the required state for this action.", "INVALID_PAYMENT_STATE");
      }
      if (input.expectedMethods && !input.expectedMethods.includes(payment.method)) {
        throw new PaymentLifecycleError("Payment method is not eligible for this action.", "PAYMENT_METHOD_UNAVAILABLE");
      }
      const booking = await Booking.findOne({
        _id: payment.bookingId, tenantId: input.tenantId, propertyId: input.propertyId,
      }).session(session);
      if (!booking) throw new PaymentLifecycleError("Booking was not found.", "BOOKING_NOT_FOUND");
      if (input.outcome === "succeeded" && booking.status === "cancelled") {
        throw new PaymentLifecycleError("Cancelled bookings cannot be marked as paid. Resolve the payment manually.", "INVALID_PAYMENT_STATE");
      }

      payment.status = input.outcome;
      payment.isActive = false;
      payment.verifiedAt = new Date();
      payment.verifiedBy = new mongoose.Types.ObjectId(input.actorUserId);
      if (input.outcome === "failed") payment.failureReason = "Rejected or not received by property staff";
      await payment.save({ session });

      if (input.outcome === "succeeded") {
        const successful = await Payment.find({
          tenantId: input.tenantId, propertyId: input.propertyId,
          bookingId: booking._id, status: "succeeded",
        }).session(session);
        const paidAmount = successful.reduce((sum, item) => sum + item.amount, 0);
        booking.paymentStatus = paidAmount >= booking.totalPrice ? "paid" : "partially_paid";
      } else {
        const otherPending = await Payment.exists({
          _id: { $ne: payment._id }, tenantId: input.tenantId, propertyId: input.propertyId,
          bookingId: booking._id, status: { $in: ["pending", "pending_verification"] },
        }).session(session);
        const successful = await Payment.exists({
          tenantId: input.tenantId, propertyId: input.propertyId, bookingId: booking._id, status: "succeeded",
        }).session(session);
        booking.paymentStatus = successful ? "partially_paid" : otherPending ? "pending" : "failed";
      }
      await booking.save({ session });
      await AuditLog.create([{
        tenantId: input.tenantId, propertyId: input.propertyId,
        actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
        action: input.outcome === "succeeded" ? "payment.verified" : "payment.rejected",
        resourceType: "payment", resourceId: payment._id.toString(), outcome: "success",
        metadata: { method: payment.method, amount: payment.amount, currency: payment.currency },
      }], { session });
      result = payment.toObject() as unknown as Record<string, unknown>;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return result;
  } catch (error) {
    if (error instanceof PaymentLifecycleError) throw error;
    return transactionError(error);
  } finally {
    await session.endSession();
  }
}

export function verifyManualPayment(input: {
  tenantId: mongoose.Types.ObjectId; propertyId: mongoose.Types.ObjectId;
  paymentId: string; actorUserId: string; outcome: "succeeded" | "failed";
}) {
  return settlePayment({ ...input, expectedMethods: ["bank_transfer", "easypaisa", "jazzcash"], requireSubmittedProof: true });
}

export function collectCashPayment(input: {
  tenantId: mongoose.Types.ObjectId; propertyId: mongoose.Types.ObjectId;
  paymentId: string; actorUserId: string;
}) {
  return settlePayment({ ...input, outcome: "succeeded", expectedMethods: ["cash_on_arrival"], requirePendingOnly: true });
}
