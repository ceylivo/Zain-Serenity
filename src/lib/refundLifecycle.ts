import "server-only";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import Payment from "@/models/Payment";
import Booking from "@/models/Booking";
import Refund, { type RefundStatus } from "@/models/Refund";
import AuditLog from "@/models/AuditLog";

export class RefundLifecycleError extends Error {
  constructor(message: string, public readonly code:
    | "PAYMENT_NOT_FOUND" | "REFUND_NOT_FOUND" | "INVALID_REFUND_STATE"
    | "REFUND_AMOUNT_INVALID" | "REFUND_LIMIT_EXCEEDED" | "IDEMPOTENCY_CONFLICT"
    | "REFUND_REFERENCE_REQUIRED" | "TRANSACTION_UNAVAILABLE" | "REFUND_OPERATION_FAILED") {
    super(message);
    this.name = "RefundLifecycleError";
  }
}

function failTransaction(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) {
    throw new RefundLifecycleError("Refund operations require MongoDB transactions (replica set or sharded cluster).", "TRANSACTION_UNAVAILABLE");
  }
  throw new RefundLifecycleError("The refund operation could not be completed. Please retry.", "REFUND_OPERATION_FAILED");
}
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const money = (value: number) => cents(value) / 100;
const RESERVED: RefundStatus[] = ["requested", "approved", "processing", "completed"];

async function refreshBookingPaymentStatus(input: {
  tenantId: mongoose.Types.ObjectId; propertyId: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId; session: mongoose.ClientSession;
}) {
  const booking = await Booking.findOne({
    _id: input.bookingId, tenantId: input.tenantId, propertyId: input.propertyId,
  }).session(input.session);
  if (!booking) throw new RefundLifecycleError("Booking was not found.", "PAYMENT_NOT_FOUND");
  const successful = await Payment.find({
    tenantId: input.tenantId, propertyId: input.propertyId,
    bookingId: input.bookingId, status: { $in: ["succeeded", "refunded"] },
  }).session(input.session);
  const paymentIds = successful.map((payment) => payment._id);
  const completed = paymentIds.length ? await Refund.find({
    tenantId: input.tenantId, propertyId: input.propertyId,
    paymentId: { $in: paymentIds }, status: "completed",
  }).session(input.session) : [];
  const gross = successful.reduce((sum, payment) => sum + cents(payment.amount), 0);
  const refunded = completed.reduce((sum, refund) => sum + cents(refund.amount), 0);
  const net = Math.max(0, gross - refunded);
  booking.paymentStatus = net === 0 && gross > 0 ? "refunded"
    : refunded > 0 ? "partially_refunded"
    : gross >= cents(booking.totalPrice) ? "paid"
    : gross > 0 ? "partially_paid" : "unpaid";
  await booking.save({ session: input.session });
}

export async function requestPaymentRefund(input: {
  tenantId: mongoose.Types.ObjectId; propertyId: mongoose.Types.ObjectId;
  paymentId: string; actorUserId: string; amount: number; reason: string; idempotencyKey: string;
}) {
  await dbConnect();
  if (!mongoose.isValidObjectId(input.paymentId) || !mongoose.isValidObjectId(input.actorUserId) ||
      !Number.isFinite(input.amount) || input.amount <= 0 || !input.reason.trim() || !input.idempotencyKey.trim()) {
    throw new RefundLifecycleError("A valid payment, positive amount, reason and idempotency key are required.", "REFUND_AMOUNT_INVALID");
  }
  const session = await mongoose.startSession();
  let result: Record<string, unknown> | null = null;
  try {
    await session.withTransaction(async () => {
      const existing = await Refund.findOne({
        tenantId: input.tenantId, propertyId: input.propertyId, idempotencyKey: input.idempotencyKey,
      }).session(session);
      if (existing) {
        if (existing.paymentId.toString() !== input.paymentId || cents(existing.amount) !== cents(input.amount) ||
            existing.requestedBy.toString() !== input.actorUserId) {
          throw new RefundLifecycleError("Idempotency key was already used for another refund request.", "IDEMPOTENCY_CONFLICT");
        }
        result = existing.toObject() as unknown as Record<string, unknown>;
        return;
      }
      const payment = await Payment.findOne({
        _id: input.paymentId, tenantId: input.tenantId, propertyId: input.propertyId,
      }).session(session);
      if (!payment || !["succeeded", "refunded"].includes(payment.status)) {
        throw new RefundLifecycleError("Only collected or settled payments can be refunded.", "PAYMENT_NOT_FOUND");
      }
      const amount = cents(input.amount);
      const reserve = await Payment.updateOne({
        _id: payment._id, tenantId: input.tenantId, propertyId: input.propertyId,
        $expr: {
          $lte: [
            { $add: [{ $ifNull: ["$refundReservedAmount", 0] }, amount / 100] },
            "$amount",
          ],
        },
      }, { $inc: { refundReservedAmount: amount / 100 } }, { session });
      if (reserve.modifiedCount !== 1) {
        throw new RefundLifecycleError("Requested refunds cannot exceed the payment's remaining refundable amount.", "REFUND_LIMIT_EXCEEDED");
      }
      const [refund] = await Refund.create([{
        tenantId: input.tenantId, propertyId: input.propertyId, bookingId: payment.bookingId,
        paymentId: payment._id, requestedBy: new mongoose.Types.ObjectId(input.actorUserId),
        amount: money(amount), currency: payment.currency, reason: input.reason.trim(),
        status: "requested", idempotencyKey: input.idempotencyKey,
      }], { session });
      await AuditLog.create([{
        tenantId: input.tenantId, propertyId: input.propertyId,
        actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
        action: "payment.refund.requested", resourceType: "refund", resourceId: refund._id.toString(),
        outcome: "success", metadata: { paymentId: payment._id.toString(), amount: refund.amount, currency: refund.currency, reason: refund.reason },
      }], { session });
      result = refund.toObject() as unknown as Record<string, unknown>;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return result;
  } catch (error) {
    if (error instanceof RefundLifecycleError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      throw new RefundLifecycleError("Refund request already exists.", "IDEMPOTENCY_CONFLICT");
    }
    return failTransaction(error);
  } finally { await session.endSession(); }
}

export async function transitionPaymentRefund(input: {
  tenantId: mongoose.Types.ObjectId; propertyId: mongoose.Types.ObjectId;
  refundId: string; actorUserId: string;
  action: "approve" | "reject" | "processing" | "complete" | "fail";
  note?: string; externalReference?: string;
}) {
  await dbConnect();
  if (!mongoose.isValidObjectId(input.refundId) || !mongoose.isValidObjectId(input.actorUserId)) {
    throw new RefundLifecycleError("Refund was not found.", "REFUND_NOT_FOUND");
  }
  if (input.action === "complete" && !input.externalReference?.trim()) {
    throw new RefundLifecycleError("A bank/provider transaction reference is required before recording a completed refund.", "REFUND_REFERENCE_REQUIRED");
  }
  if ((input.action === "reject" || input.action === "fail") && !input.note?.trim()) {
    throw new RefundLifecycleError("A reason is required when rejecting or failing a refund.", "INVALID_REFUND_STATE");
  }
  const session = await mongoose.startSession();
  let result: Record<string, unknown> | null = null;
  try {
    await session.withTransaction(async () => {
      const refund = await Refund.findOne({
        _id: input.refundId, tenantId: input.tenantId, propertyId: input.propertyId,
      }).session(session);
      if (!refund) throw new RefundLifecycleError("Refund was not found.", "REFUND_NOT_FOUND");
      const transitions: Record<typeof input.action, RefundStatus> = {
        approve: "approved", reject: "rejected", processing: "processing", complete: "completed", fail: "failed",
      };
      const next = transitions[input.action];
      if ((input.action === "approve" || input.action === "reject") &&
          refund.requestedBy.toString() === input.actorUserId) {
        throw new RefundLifecycleError("A different authorized owner must review the refund request.", "INVALID_REFUND_STATE");
      }
      const allowed: Record<typeof input.action, RefundStatus[]> = {
        approve: ["requested"], reject: ["requested"],
        processing: ["approved"], complete: ["approved", "processing"], fail: ["approved", "processing"],
      };
      if (!allowed[input.action].includes(refund.status)) {
        if (refund.status === next) { result = refund.toObject() as unknown as Record<string, unknown>; return; }
        throw new RefundLifecycleError("This refund cannot make that state transition.", "INVALID_REFUND_STATE");
      }
      refund.status = next;
      if (input.action === "reject" || input.action === "fail") {
        const released = await Payment.updateOne({
          _id: refund.paymentId, tenantId: input.tenantId, propertyId: input.propertyId,
          refundReservedAmount: { $gte: refund.amount },
        }, { $inc: { refundReservedAmount: -refund.amount } }, { session });
        if (released.modifiedCount !== 1) throw new RefundLifecycleError("Refund reservation could not be released safely.", "REFUND_OPERATION_FAILED");
      }
      if (input.action === "approve" || input.action === "reject") {
        refund.reviewedBy = new mongoose.Types.ObjectId(input.actorUserId);
        refund.reviewedAt = new Date();
      }
      if (input.action === "complete") {
        refund.completedBy = new mongoose.Types.ObjectId(input.actorUserId);
        refund.completedAt = new Date();
        refund.externalReference = input.externalReference!.trim();
      }
      if (input.note?.trim()) refund.reviewNote = input.note.trim();
      await refund.save({ session });
      if (input.action === "complete") {
        const payment = await Payment.findOne({
          _id: refund.paymentId, tenantId: input.tenantId, propertyId: input.propertyId,
        }).session(session);
        if (!payment) throw new RefundLifecycleError("Payment was not found.", "PAYMENT_NOT_FOUND");
        const completed = await Refund.find({
          tenantId: input.tenantId, propertyId: input.propertyId,
          paymentId: payment._id, status: "completed",
        }).session(session);
        const refunded = completed.reduce((sum, item) => sum + cents(item.amount), 0);
        if (refunded > cents(payment.amount)) throw new RefundLifecycleError("Completed refunds exceed the captured payment.", "REFUND_LIMIT_EXCEEDED");
        if (refunded === cents(payment.amount)) {
          payment.status = "refunded";
          payment.isActive = false;
          await payment.save({ session });
        }
        await refreshBookingPaymentStatus({
          tenantId: input.tenantId, propertyId: input.propertyId,
          bookingId: refund.bookingId, session,
        });
      }
      await AuditLog.create([{
        tenantId: input.tenantId, propertyId: input.propertyId,
        actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
        action: `payment.refund.${next}`, resourceType: "refund", resourceId: refund._id.toString(),
        outcome: "success", metadata: {
          paymentId: refund.paymentId.toString(), amount: refund.amount, currency: refund.currency,
          note: input.note?.trim() ?? "", externalReference: input.action === "complete" ? refund.externalReference : undefined,
        },
      }], { session });
      result = refund.toObject() as unknown as Record<string, unknown>;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return result;
  } catch (error) {
    if (error instanceof RefundLifecycleError) throw error;
    return failTransaction(error);
  } finally { await session.endSession(); }
}
