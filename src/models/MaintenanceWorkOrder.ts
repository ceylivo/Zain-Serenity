import mongoose, { Schema, type Model } from "mongoose";

export const MAINTENANCE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const MAINTENANCE_STATUSES = ["open", "in_progress", "blocked", "completed", "cancelled"] as const;
export type MaintenancePriority = (typeof MAINTENANCE_PRIORITIES)[number];
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export interface IMaintenanceWorkOrder {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  physicalRoomId?: mongoose.Types.ObjectId;
  title: string;
  description: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  dueAt?: Date;
  assignedTo?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  completedAt?: Date;
  statusHistory: { status: MaintenanceStatus; changedBy: mongoose.Types.ObjectId; changedAt: Date; note?: string }[];
  createdAt: Date;
  updatedAt: Date;
}

const MaintenanceWorkOrderSchema = new Schema<IMaintenanceWorkOrder>({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
  propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
  physicalRoomId: { type: Schema.Types.ObjectId, ref: "PhysicalRoom" },
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 120 },
  description: { type: String, default: "", trim: true, maxlength: 2000 },
  priority: { type: String, enum: MAINTENANCE_PRIORITIES, default: "normal", required: true },
  status: { type: String, enum: MAINTENANCE_STATUSES, default: "open", required: true, index: true },
  dueAt: { type: Date },
  assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  completedAt: { type: Date },
  statusHistory: [{ status: { type: String, enum: MAINTENANCE_STATUSES, required: true }, changedBy: { type: Schema.Types.ObjectId, ref: "User", required: true }, changedAt: { type: Date, required: true }, note: { type: String, trim: true, maxlength: 500 } }],
}, { timestamps: true, versionKey: false });

MaintenanceWorkOrderSchema.index({ tenantId: 1, propertyId: 1, status: 1, priority: 1, dueAt: 1 });
MaintenanceWorkOrderSchema.index({ tenantId: 1, propertyId: 1, physicalRoomId: 1, createdAt: -1 });

const MaintenanceWorkOrder: Model<IMaintenanceWorkOrder> =
  mongoose.models.MaintenanceWorkOrder ||
  mongoose.model<IMaintenanceWorkOrder>("MaintenanceWorkOrder", MaintenanceWorkOrderSchema);

export default MaintenanceWorkOrder;
