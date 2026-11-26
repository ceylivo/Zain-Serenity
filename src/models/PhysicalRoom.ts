import mongoose, { Schema, type Model } from "mongoose";

export type PhysicalRoomStatus = "ready" | "occupied" | "cleaning" | "maintenance" | "out_of_service";

export interface IPhysicalRoom {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  roomTypeId: mongoose.Types.ObjectId;
  roomNumber: string;
  floor?: string;
  status: PhysicalRoomStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PhysicalRoomSchema = new Schema<IPhysicalRoom>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: "RoomType", required: true, immutable: true },
    roomNumber: { type: String, required: true, trim: true, maxlength: 24 },
    floor: { type: String, trim: true, maxlength: 24 },
    status: {
      type: String,
      enum: ["ready", "occupied", "cleaning", "maintenance", "out_of_service"],
      default: "ready",
      index: true,
    },
    notes: { type: String, default: "", maxlength: 1000 },
  },
  { timestamps: true, versionKey: false }
);

PhysicalRoomSchema.index({ tenantId: 1, propertyId: 1, roomNumber: 1 }, { unique: true });
PhysicalRoomSchema.index({ tenantId: 1, propertyId: 1, roomTypeId: 1, status: 1 });

const PhysicalRoom: Model<IPhysicalRoom> =
  mongoose.models.PhysicalRoom ||
  mongoose.model<IPhysicalRoom>("PhysicalRoom", PhysicalRoomSchema);

export default PhysicalRoom;
