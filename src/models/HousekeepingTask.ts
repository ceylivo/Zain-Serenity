import mongoose, { Schema, type Model } from "mongoose";

export const HOUSEKEEPING_TASK_STATUSES = ["open", "in_progress", "completed", "cancelled"] as const;
export type HousekeepingTaskStatus = (typeof HOUSEKEEPING_TASK_STATUSES)[number];

export interface IHousekeepingTask {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  physicalRoomId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  status: HousekeepingTaskStatus;
  assignedTo?: mongoose.Types.ObjectId;
  dueAt?: Date;
  createdBy: mongoose.Types.ObjectId;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const HousekeepingTaskSchema = new Schema<IHousekeepingTask>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
  physicalRoomId: { type: Schema.Types.ObjectId, ref: "PhysicalRoom", required: true, immutable: true },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
  description: { type: String, default: "", trim: true, maxlength: 2000 },
  status: { type: String, enum: HOUSEKEEPING_TASK_STATUSES, default: "open", required: true, index: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
  dueAt: { type: Date },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  completedAt: { type: Date },
}, { timestamps: true, versionKey: false });

HousekeepingTaskSchema.index({ tenantId: 1, propertyId: 1, status: 1, dueAt: 1 });
HousekeepingTaskSchema.index({ tenantId: 1, propertyId: 1, physicalRoomId: 1, createdAt: -1 });
HousekeepingTaskSchema.index({ tenantId: 1, propertyId: 1, assignedTo: 1, status: 1 });

const HousekeepingTask: Model<IHousekeepingTask> =
  mongoose.models.HousekeepingTask ||
  mongoose.model<IHousekeepingTask>("HousekeepingTask", HousekeepingTaskSchema);

export default HousekeepingTask;
