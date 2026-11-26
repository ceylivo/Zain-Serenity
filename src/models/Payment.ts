import mongoose, { Schema, type Model } from "mongoose";

export const PAYMENT_METHODS = [
  "bank_transfer",
  "easypaisa",
  "jazzcash",
  "cash_on_arrival",
  "stripe",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentRecordStatus = "pending" | "pending_verification" | "succeeded" | "failed" | "cancelled" | "refunded";

export interface IPayment {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  method: PaymentMethod;
  status: PaymentRecordStatus;
  amount: number;
  currency: string;
  reference?: string;
  providerPaymentId?: string;
  idempotencyKey: string;
  submittedAt?: Date;
  verifiedAt?: Date;
  verifiedBy?: mongoose.Types.ObjectId;
  failureReason?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
  bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true, immutable: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  method: { type: String, enum: PAYMENT_METHODS, required: true },
  status: { type: String, enum: ["pending", "pending_verification", "succeeded", "failed", "cancelled", "refunded"], required: true, default: "pending", index: true },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  reference: { type: String, trim: true, maxlength: 120 },
  providerPaymentId: { type: String, trim: true, maxlength: 160 },
  idempotencyKey: { type: String, required: true, maxlength: 128 },
  submittedAt: { type: Date },
  verifiedAt: { type: Date },
  verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
  failureReason: { type: String, maxlength: 500 },
  metadata: { type: Schema.Types.Mixed },
}, { timestamps: true, versionKey: false });

PaymentSchema.index({ tenantId: 1, propertyId: 1, idempotencyKey: 1 }, { unique: true });
PaymentSchema.index({ tenantId: 1, propertyId: 1, status: 1, createdAt: -1 });
PaymentSchema.index({ tenantId: 1, propertyId: 1, bookingId: 1, createdAt: -1 });
PaymentSchema.index({ providerPaymentId: 1 }, { unique: true, sparse: true });

const Payment: Model<IPayment> = mongoose.models.Payment || mongoose.model<IPayment>("Payment", PaymentSchema);
export default Payment;
