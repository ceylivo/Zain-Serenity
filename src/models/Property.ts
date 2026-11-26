import mongoose, { Schema, type Model } from "mongoose";

export type PropertyStatus = "active" | "inactive" | "maintenance";

export interface IProperty {
  tenantId: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  description: string;
  status: PropertyStatus;
  timezone: string;
  locale: "en" | "ur";
  currency: string;
  address: {
    line1?: string;
    line2?: string;
    city: string;
    region?: string;
    countryCode: string;
    postalCode?: string;
  };
  checkInTime: string;
  checkOutTime: string;
  createdAt: Date;
  updatedAt: Date;
}

const PropertySchema = new Schema<IProperty>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      minlength: 2,
      maxlength: 63,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    description: { type: String, default: "", maxlength: 5000 },
    status: {
      type: String,
      enum: ["active", "inactive", "maintenance"],
      default: "active",
      index: true,
    },
    timezone: { type: String, required: true, default: "UTC" },
    locale: { type: String, enum: ["en", "ur"], default: "en" },
    currency: {
      type: String,
      uppercase: true,
      default: "PKR",
      minlength: 3,
      maxlength: 3,
    },
    address: {
      line1: { type: String, trim: true, maxlength: 160 },
      line2: { type: String, trim: true, maxlength: 160 },
      city: { type: String, required: true, trim: true, maxlength: 100 },
      region: { type: String, trim: true, maxlength: 100 },
      countryCode: {
        type: String,
        required: true,
        uppercase: true,
        minlength: 2,
        maxlength: 2,
      },
      postalCode: { type: String, trim: true, maxlength: 24 },
    },
    checkInTime: {
      type: String,
      default: "14:00",
      match: /^(?:[01]\d|2[0-3]):[0-5]\d$/,
    },
    checkOutTime: {
      type: String,
      default: "11:00",
      match: /^(?:[01]\d|2[0-3]):[0-5]\d$/,
    },
  },
  { timestamps: true, versionKey: false }
);

PropertySchema.index({ tenantId: 1, slug: 1 }, { unique: true });
PropertySchema.index({ tenantId: 1, status: 1 });

const Property: Model<IProperty> =
  mongoose.models.Property ||
  mongoose.model<IProperty>("Property", PropertySchema);

export default Property;
