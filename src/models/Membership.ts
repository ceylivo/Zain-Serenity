import mongoose, { Schema, type Model } from "mongoose";

export const TENANT_ROLES = [
  "tenant_owner",
  "property_manager",
  "booking_manager",
  "payment_verifier",
  "receptionist",
  "housekeeping",
  "analyst",
] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];
export type MembershipStatus = "invited" | "active" | "suspended" | "revoked";

export interface IMembership {
  tenantId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  role: TenantRole;
  status: MembershipStatus;
  propertyIds: mongoose.Types.ObjectId[];
  invitedBy?: mongoose.Types.ObjectId;
  acceptedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MembershipSchema = new Schema<IMembership>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    role: { type: String, enum: TENANT_ROLES, required: true },
    status: {
      type: String,
      enum: ["invited", "active", "suspended", "revoked"],
      default: "invited",
      index: true,
    },
    propertyIds: [{ type: Schema.Types.ObjectId, ref: "Property" }],
    invitedBy: { type: Schema.Types.ObjectId, ref: "User" },
    acceptedAt: { type: Date },
  },
  { timestamps: true, versionKey: false }
);

MembershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
MembershipSchema.index({ userId: 1, status: 1 });
MembershipSchema.index({ tenantId: 1, role: 1, status: 1 });

const Membership: Model<IMembership> =
  mongoose.models.Membership ||
  mongoose.model<IMembership>("Membership", MembershipSchema);

export default Membership;
