import mongoose, { Schema, type Model } from "mongoose";

export interface IAuditLog {
  tenantId?: mongoose.Types.ObjectId;
  propertyId?: mongoose.Types.ObjectId;
  actorUserId?: mongoose.Types.ObjectId;
  action: string;
  resourceType: string;
  resourceId?: string;
  outcome: "success" | "denied" | "failure";
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", index: true },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    action: { type: String, required: true, trim: true, maxlength: 120 },
    resourceType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    resourceId: { type: String, maxlength: 128 },
    outcome: {
      type: String,
      enum: ["success", "denied", "failure"],
      required: true,
    },
    requestId: { type: String, maxlength: 128 },
    ipAddress: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 512 },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
AuditLogSchema.index({ actorUserId: 1, createdAt: -1 });
AuditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });

const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog ||
  mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);

export default AuditLog;
