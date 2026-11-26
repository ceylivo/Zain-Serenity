import mongoose, { Schema, type Model } from "mongoose";

export type InventoryBlockStatus = "active" | "partially_released" | "released";

export interface IInventoryBlock {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  roomTypeId: mongoose.Types.ObjectId;
  startDate: string;
  endDate: string;
  quantity: number;
  remainingQuantity: number;
  status: InventoryBlockStatus;
  reason: string;
  createdBy: mongoose.Types.ObjectId;
  releasedQuantity: number;
  lastReleasedBy?: mongoose.Types.ObjectId;
  lastReleasedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InventoryBlockSchema = new Schema<IInventoryBlock>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true, index: true },
  roomTypeId: { type: Schema.Types.ObjectId, ref: "RoomType", required: true, immutable: true, index: true },
  startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, immutable: true },
  endDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, immutable: true },
  quantity: { type: Number, required: true, min: 1, immutable: true },
  remainingQuantity: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ["active", "partially_released", "released"], required: true, default: "active", index: true },
  reason: { type: String, required: true, trim: true, maxlength: 300, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  releasedQuantity: { type: Number, required: true, min: 0, default: 0 },
  lastReleasedBy: { type: Schema.Types.ObjectId, ref: "User" },
  lastReleasedAt: { type: Date },
}, { timestamps: true, versionKey: false });

InventoryBlockSchema.index({ tenantId: 1, propertyId: 1, roomTypeId: 1, createdAt: -1 });
InventoryBlockSchema.index({ tenantId: 1, propertyId: 1, status: 1, startDate: 1, endDate: 1 });

const InventoryBlock: Model<IInventoryBlock> =
  mongoose.models.InventoryBlock ||
  mongoose.model<IInventoryBlock>("InventoryBlock", InventoryBlockSchema);

export default InventoryBlock;
