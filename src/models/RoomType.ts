import mongoose, { Schema, type Model } from "mongoose";

export interface IRoomType {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  description: string;
  baseNightlyRate: number;
  currency: string;
  maxAdults: number;
  maxChildren: number;
  inventoryCount: number;
  amenities: string[];
  images: string[];
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

const RoomTypeSchema = new Schema<IRoomType>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 80, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
    description: { type: String, default: "", maxlength: 5000 },
    baseNightlyRate: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    maxAdults: { type: Number, required: true, min: 1, max: 30, default: 2 },
    maxChildren: { type: Number, min: 0, max: 30, default: 0 },
    inventoryCount: { type: Number, required: true, min: 0, max: 10000 },
    amenities: [{ type: String, trim: true, maxlength: 80 }],
    images: [{ type: String, maxlength: 2048 }],
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
  },
  { timestamps: true, versionKey: false }
);

RoomTypeSchema.index({ tenantId: 1, propertyId: 1, slug: 1 }, { unique: true });
RoomTypeSchema.index({ tenantId: 1, propertyId: 1, status: 1 });

const RoomType: Model<IRoomType> =
  mongoose.models.RoomType || mongoose.model<IRoomType>("RoomType", RoomTypeSchema);

export default RoomType;
