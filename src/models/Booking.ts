import mongoose, { Schema, type Model } from "mongoose";
export type BookingStatus="pending"|"confirmed"|"checked_in"|"checked_out"|"cancelled"|"no_show";
export type PaymentStatus="unpaid"|"pending"|"partially_paid"|"paid"|"partially_refunded"|"refunded"|"failed";
export interface IBooking {
 tenantId?:mongoose.Types.ObjectId; propertyId?:mongoose.Types.ObjectId; userId:string; roomId:string;
 roomTypeId?:mongoose.Types.ObjectId; physicalRoomId?:mongoose.Types.ObjectId|null; ratePlanId?:mongoose.Types.ObjectId;
 checkIn:Date; checkOut:Date; guests:number; children:number; totalPrice:number; currency?:string;
 pricing?:{nights:number;subtotal:number;taxes:number;discount:number;total:number};
 paymentStatus?:PaymentStatus; status:BookingStatus; specialRequests?:string; createdAt:Date; updatedAt:Date;
}
const BookingSchema=new Schema<IBooking>({
 tenantId:{type:Schema.Types.ObjectId,ref:"Tenant",index:true},propertyId:{type:Schema.Types.ObjectId,ref:"Property",index:true},
 userId:{type:String,required:true,index:true},roomId:{type:String,required:true,index:true},
 roomTypeId:{type:Schema.Types.ObjectId,ref:"RoomType",index:true},physicalRoomId:{type:Schema.Types.ObjectId,ref:"PhysicalRoom",default:null},
 ratePlanId:{type:Schema.Types.ObjectId,ref:"RatePlan"},checkIn:{type:Date,required:true},checkOut:{type:Date,required:true},
 guests:{type:Number,required:true,min:1,max:50},children:{type:Number,default:0,min:0,max:50},
 totalPrice:{type:Number,required:true,min:0},currency:{type:String,uppercase:true,minlength:3,maxlength:3},
 pricing:{nights:{type:Number,min:1},subtotal:{type:Number,min:0},taxes:{type:Number,min:0},discount:{type:Number,min:0},total:{type:Number,min:0}},
 paymentStatus:{type:String,enum:["unpaid","pending","partially_paid","paid","partially_refunded","refunded","failed"],default:"unpaid"},
 specialRequests:{type:String,default:"",maxlength:2000},
 status:{type:String,enum:["pending","confirmed","checked_in","checked_out","cancelled","no_show"],default:"pending",index:true}
},{timestamps:true});
BookingSchema.index({tenantId:1,propertyId:1,checkIn:1,checkOut:1,status:1});
BookingSchema.index({tenantId:1,propertyId:1,userId:1,createdAt:-1});
const Booking:Model<IBooking>=mongoose.models.Booking||mongoose.model<IBooking>("Booking",BookingSchema);
export default Booking;
