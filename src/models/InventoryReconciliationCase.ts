import mongoose, { Schema, type Model } from "mongoose";

export type InventoryReconciliationCaseStatus = "open" | "resolved" | "dismissed";

export interface IInventoryReconciliationCase {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  roomTypeId: mongoose.Types.ObjectId;
  date: string;
  inventoryBlocked: number;
  trackedBlocked: number;
  legacyUntracked: number;
  overtracked: number;
  snapshotKey: string;
  reason: string;
  status: InventoryReconciliationCaseStatus;
  createdBy: mongoose.Types.ObjectId;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  resolutionNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InventoryReconciliationCaseSchema = new Schema<IInventoryReconciliationCase>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true, index: true },
  roomTypeId: { type: Schema.Types.ObjectId, ref: "RoomType", required: true, immutable: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, immutable: true },
  inventoryBlocked: { type: Number, required: true, min: 0, immutable: true },
  trackedBlocked: { type: Number, required: true, min: 0, immutable: true },
  legacyUntracked: { type: Number, required: true, min: 0, immutable: true },
  overtracked: { type: Number, required: true, min: 0, immutable: true },
  snapshotKey: { type: String, required: true, maxlength: 128, immutable: true },
  reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 500, immutable: true },
  status: { type: String, enum: ["open", "resolved", "dismissed"], default: "open", required: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  reviewedAt: { type: Date },
  resolutionNote: { type: String, trim: true, maxlength: 500 },
}, { timestamps: true, versionKey: false });

InventoryReconciliationCaseSchema.index(
  { tenantId: 1, propertyId: 1, roomTypeId: 1, date: 1, snapshotKey: 1 },
  { unique: true }
);
InventoryReconciliationCaseSchema.index({ tenantId: 1, propertyId: 1, status: 1, createdAt: -1 });

const InventoryReconciliationCase: Model<IInventoryReconciliationCase> =
  mongoose.models.InventoryReconciliationCase ||
  mongoose.model<IInventoryReconciliationCase>("InventoryReconciliationCase", InventoryReconciliationCaseSchema);

export default InventoryReconciliationCase;
