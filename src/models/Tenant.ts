import mongoose, { Schema, type Model } from "mongoose";

export type TenantStatus = "active" | "suspended" | "pending" | "archived";

export interface ITenant {
  name: string;
  slug: string;
  status: TenantStatus;
  primaryOwnerId: mongoose.Types.ObjectId;
  defaultLocale: "en" | "ur";
  defaultCurrency: string;
  createdAt: Date;
  updatedAt: Date;
}

const TenantSchema = new Schema<ITenant>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 63,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    status: {
      type: String,
      enum: ["active", "suspended", "pending", "archived"],
      default: "pending",
      index: true,
    },
    primaryOwnerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    defaultLocale: { type: String, enum: ["en", "ur"], default: "en" },
    defaultCurrency: {
      type: String,
      uppercase: true,
      default: "PKR",
      minlength: 3,
      maxlength: 3,
    },
  },
  { timestamps: true, versionKey: false }
);

TenantSchema.index({ slug: 1 }, { unique: true });

const Tenant: Model<ITenant> =
  mongoose.models.Tenant || mongoose.model<ITenant>("Tenant", TenantSchema);

export default Tenant;
