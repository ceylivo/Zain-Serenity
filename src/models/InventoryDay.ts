import mongoose, { Schema, type Model } from "mongoose";

export interface IInventoryDay {
  tenantId: mongoose.Types.ObjectId;
  propertyId: mongoose.Types.ObjectId;
  roomTypeId: mongoose.Types.ObjectId;
  date: string;
  totalRooms: number;
  availableRooms: number;
  reservedRooms: number;
  blockedRooms: number;
  createdAt: Date;
  updatedAt: Date;
}

const InventoryDaySchema = new Schema<IInventoryDay>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, immutable: true },
    propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, immutable: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: "RoomType", required: true, immutable: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    totalRooms: { type: Number, required: true, min: 0 },
    availableRooms: { type: Number, required: true, min: 0 },
    reservedRooms: { type: Number, required: true, min: 0, default: 0 },
    blockedRooms: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

InventoryDaySchema.index(
  { tenantId: 1, propertyId: 1, roomTypeId: 1, date: 1 },
  { unique: true }
);
InventoryDaySchema.index({ tenantId: 1, propertyId: 1, date: 1 });

const InventoryDay: Model<IInventoryDay> =
  mongoose.models.InventoryDay ||
  mongoose.model<IInventoryDay>("InventoryDay", InventoryDaySchema);

export default InventoryDay;
