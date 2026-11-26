import mongoose, { Schema, type Model } from "mongoose";
export interface IRatePlan { tenantId: mongoose.Types.ObjectId; propertyId: mongoose.Types.ObjectId; roomTypeId: mongoose.Types.ObjectId; name: string; code: string; description: string; currency: string; nightlyRate: number; taxRatePercent: number; isRefundable: boolean; isActive: boolean; minimumNights: number; maximumNights?: number; createdAt: Date; updatedAt: Date; }
const RatePlanSchema = new Schema<IRatePlan>({
 tenantId:{type:Schema.Types.ObjectId,ref:"Tenant",required:true,immutable:true},
 propertyId:{type:Schema.Types.ObjectId,ref:"Property",required:true,immutable:true},
 roomTypeId:{type:Schema.Types.ObjectId,ref:"RoomType",required:true,immutable:true},
 name:{type:String,required:true,trim:true,maxlength:120},
 code:{type:String,required:true,uppercase:true,trim:true,maxlength:32},
 description:{type:String,default:"",maxlength:2000},
 currency:{type:String,required:true,uppercase:true,minlength:3,maxlength:3},
 nightlyRate:{type:Number,required:true,min:0},
 taxRatePercent:{type:Number,default:0,min:0,max:100},
 isRefundable:{type:Boolean,default:true},
 isActive:{type:Boolean,default:true,index:true},
 minimumNights:{type:Number,default:1,min:1,max:365},
 maximumNights:{type:Number,min:1,max:365}
},{timestamps:true,versionKey:false});
RatePlanSchema.index({tenantId:1,propertyId:1,code:1},{unique:true});
RatePlanSchema.index({tenantId:1,propertyId:1,roomTypeId:1,isActive:1});
const RatePlan:Model<IRatePlan>=mongoose.models.RatePlan||mongoose.model<IRatePlan>("RatePlan",RatePlanSchema);
export default RatePlan;
