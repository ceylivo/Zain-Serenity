import mongoose, { Schema, type Model } from "mongoose";

export type InventoryCorrectionStatus = "pending" | "applied" | "rejected" | "reversed";

/**
 * Append-only inventory correction ledger.
 * Snapshot fields are immutable; reversals must be separate compensating entries.
 */
export interface IInventoryCorrection {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  roomTypeId: mongoose.Types.ObjectId;
  reconciliationCaseId: mongoose.Types.ObjectId;
  date: string;
  idempotencyKey: string;
  deltaBlockedRooms: number;
  beforeBlockedRooms: number;
  beforeAvailableRooms: number;
  afterBlockedRooms?: number;
  afterAvailableRooms?: number;
  reason: string;
  status: InventoryCorrectionStatus;
  requestedBy: mongoose.Types.ObjectId;
  approvedBy?: mongoose.Types.ObjectId;
  approvalNote?: string;
  appliedAt?: Date;
  rejectedAt?: Date;
  reversalOf?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const InventoryCorrectionSchema = new Schema<IInventoryCorrection>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true, index: true },
  propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true, index: true },
  roomTypeId: { type: Schema.Types.ObjectId, ref: "RoomType", required: true, immutable: true },
  reconciliationCaseId: { type: Schema.Types.ObjectId, ref: "InventoryReconciliationCase", required: true, immutable: true },
  date: { type: String, required: true, match: /^\\d{4}-\\d{2}-\\d{2}$/, immutable: true },
  idempotencyKey: { type: String, required: true, maxlength: 128, immutable: true },
  deltaBlockedRooms: { type: Number, required: true, validate: Number.isInteger, immutable: true },
  beforeBlockedRooms: { type: Number, required: true, min: 0, immutable: true },
  beforeAvailableRooms: { type: Number, required: true, min: 0, immutable: true },
  afterBlockedRooms: { type: Number, min: 0 },
  afterAvailableRooms: { type: Number, min: 0 },
  reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 500, immutable: true },
  status: { type: String, enum: ["pending", "applied", "rejected", "reversed"], default: "pending", required: true, index: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  approvalNote: { type: String, trim: true, maxlength: 500 },
  appliedAt: { type: Date },
  rejectedAt: { type: Date },
  reversalOf: { type: Schema.Types.ObjectId, ref: "InventoryCorrection", immutable: true },
}, { timestamps: true, versionKey: false });

InventoryCorrectionSchema.index(
  { tenantId: 1, propertyId: 1, idempotencyKey: 1 },
  { unique: true }
);
InventoryCorrectionSchema.index(
  { tenantId: 1, propertyId: 1, reconciliationCaseId: 1, status: 1 }
);
InventoryCorrectionSchema.index(
  { tenantId: 1, propertyId: 1, roomTypeId: 1, date: 1, createdAt: -1 }
);

const InventoryCorrection: Model<IInventoryCorrection> =
  mongoose.models.InventoryCorrection ||
  mongoose.model<IInventoryCorrection>("InventoryCorrection", InventoryCorrectionSchema);

export default InventoryCorrection;
