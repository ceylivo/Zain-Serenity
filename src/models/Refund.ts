import mongoose, { Schema, type Model } from "mongoose";

export const REFUND_STATUSES = ["requested", "approved", "processing", "completed", "rejected", "failed", "cancelled"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export interface IRefund {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  paymentId: mongoose.Types.ObjectId;
  requestedBy: mongoose.Types.ObjectId;
  reviewedBy?: mongoose.Types.ObjectId;
  completedBy?: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  reason: string;
  status: RefundStatus;
  idempotencyKey: string;
  externalReference?: string;
  reviewNote?: string;
  requestedAt: Date;
  reviewedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RefundSchema = new Schema<IRefund>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
  bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true, immutable: true, index: true },
  paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true, immutable: true, index: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  completedBy: { type: Schema.Types.ObjectId, ref: "User" },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3, immutable: true },
  reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
  status: { type: String, enum: REFUND_STATUSES, required: true, default: "requested", index: true },
  idempotencyKey: { type: String, required: true, maxlength: 128, immutable: true },
  externalReference: { type: String, trim: true, maxlength: 160 },
  reviewNote: { type: String, trim: true, maxlength: 500 },
  requestedAt: { type: Date, required: true, default: Date.now, immutable: true },
  reviewedAt: { type: Date },
  completedAt: { type: Date },
}, { timestamps: true, versionKey: false });

RefundSchema.index({ tenantId: 1, propertyId: 1, idempotencyKey: 1 }, { unique: true });
RefundSchema.index({ tenantId: 1, propertyId: 1, paymentId: 1, status: 1, createdAt: -1 });
RefundSchema.index({ tenantId: 1, propertyId: 1, bookingId: 1, createdAt: -1 });

const Refund: Model<IRefund> = mongoose.models.Refund || mongoose.model<IRefund>("Refund", RefundSchema);
export default Refund;
