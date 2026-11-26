import mongoose, { Schema, type Model } from "mongoose";

export interface IPaymentReceipt {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  paymentId: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  storageProvider: "cloudinary";
  storageKey: string;
  resourceType: "image" | "raw";
  mimeType: string;
  fileSize: number;
  originalName: string;
  createdAt: Date;
}

const PaymentReceiptSchema = new Schema<IPaymentReceipt>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true, index: true },
  paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true, immutable: true, index: true },
  bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true, immutable: true, index: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  storageProvider: { type: String, enum: ["cloudinary"], required: true },
  storageKey: { type: String, required: true, maxlength: 240 },
  resourceType: { type: String, enum: ["image", "raw"], required: true },
  mimeType: { type: String, required: true, maxlength: 100 },
  fileSize: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 },
  originalName: { type: String, required: true, maxlength: 180 },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

PaymentReceiptSchema.index({ paymentId: 1 }, { unique: true });
PaymentReceiptSchema.index({ tenantId: 1, propertyId: 1, createdAt: -1 });

const PaymentReceipt: Model<IPaymentReceipt> = mongoose.models.PaymentReceipt || mongoose.model<IPaymentReceipt>("PaymentReceipt", PaymentReceiptSchema);
export default PaymentReceipt;
