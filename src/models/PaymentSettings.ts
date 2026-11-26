import mongoose, { Schema, type Model } from "mongoose";

export interface IPaymentSettings {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  enabledMethods: Array<"bank_transfer" | "easypaisa" | "jazzcash" | "cash_on_arrival">;
  bankTransfer?: { bankName?: string; accountTitle?: string; accountNumber?: string; iban?: string; instructions?: string };
  easypaisa?: { accountTitle?: string; accountNumber?: string; instructions?: string };
  jazzcash?: { accountTitle?: string; accountNumber?: string; instructions?: string };
  cashInstructions?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSettingsSchema = new Schema<IPaymentSettings>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
  enabledMethods: {
    type: [{ type: String, enum: ["bank_transfer", "easypaisa", "jazzcash", "cash_on_arrival"] }],
    default: [],
  },
  bankTransfer: {
    bankName: { type: String, trim: true, maxlength: 100 },
    accountTitle: { type: String, trim: true, maxlength: 120 },
    accountNumber: { type: String, trim: true, maxlength: 64 },
    iban: { type: String, trim: true, uppercase: true, maxlength: 34 },
    instructions: { type: String, trim: true, maxlength: 1000 },
  },
  easypaisa: {
    accountTitle: { type: String, trim: true, maxlength: 120 },
    accountNumber: { type: String, trim: true, maxlength: 32 },
    instructions: { type: String, trim: true, maxlength: 1000 },
  },
  jazzcash: {
    accountTitle: { type: String, trim: true, maxlength: 120 },
    accountNumber: { type: String, trim: true, maxlength: 32 },
    instructions: { type: String, trim: true, maxlength: 1000 },
  },
  cashInstructions: { type: String, trim: true, maxlength: 1000 },
}, { timestamps: true, versionKey: false });

PaymentSettingsSchema.index({ tenantId: 1, propertyId: 1 }, { unique: true });

const PaymentSettings: Model<IPaymentSettings> =
  mongoose.models.PaymentSettings || mongoose.model<IPaymentSettings>("PaymentSettings", PaymentSettingsSchema);
export default PaymentSettings;
