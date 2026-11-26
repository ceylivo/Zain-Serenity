import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { resolvePublicProperty } from "@/lib/publicProperty";
import { isRecord, readInteger, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import RoomType from "@/models/RoomType";
import RatePlan from "@/models/RatePlan";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });

export async function GET(_request: Request, context: Context) {
  const { tenantSlug, propertySlug } = await context.params;
  const property = await resolvePublicProperty({ tenantSlug, propertySlug });
  if (!property.ok) {
    const status = property.reason === "tenant_unavailable" ? 403 : 404;
    return fail(property.reason.toUpperCase(), "This property is not available.", status);
  }
  await dbConnect();
  const items = await RatePlan.find({
    tenantId: property.tenantId,
    propertyId: property.propertyId,
    isActive: true,
  })
    .select("roomTypeId name code description currency nightlyRate taxRatePercent isRefundable minimumNights maximumNights")
    .sort({ name: 1 })
    .lean();
  return NextResponse.json({ data: items });
}

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:manage" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Rate plan management access denied", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const roomTypeId = readString(body.roomTypeId, { min: 24, max: 24 });
  const name = readString(body.name, { min: 2, max: 120 });
  const code = readString(body.code, { min: 2, max: 32 })?.toUpperCase();
  const currency = readString(body.currency, { min: 3, max: 3 })?.toUpperCase();
  const nightlyRate = typeof body.nightlyRate === "number" && Number.isFinite(body.nightlyRate) && body.nightlyRate >= 0 ? body.nightlyRate : null;
  const taxRatePercent = body.taxRatePercent === undefined ? 0 : typeof body.taxRatePercent === "number" && body.taxRatePercent >= 0 && body.taxRatePercent <= 100 ? body.taxRatePercent : null;
  const minimumNights = body.minimumNights === undefined ? 1 : readInteger(body.minimumNights, { min: 1, max: 365 });
  const maximumNights = body.maximumNights === undefined ? undefined : readInteger(body.maximumNights, { min: 1, max: 365 });
  if (!roomTypeId || !mongoose.isValidObjectId(roomTypeId) || !name || !code || !currency || !/^[A-Z]{3}$/.test(currency) || nightlyRate === null || taxRatePercent === null || minimumNights === null || (body.maximumNights !== undefined && maximumNights === null) || (typeof maximumNights === "number" && typeof minimumNights === "number" && maximumNights < minimumNights)) return fail("VALIDATION_ERROR", "Provide valid room type, name, code, currency, rate, tax and stay limits", 422);
  await dbConnect();
  const roomTypeExists = await RoomType.exists({ _id: new mongoose.Types.ObjectId(roomTypeId), tenantId: access.tenantId, propertyId: access.propertyId });
  if (!roomTypeExists) return fail("ROOM_TYPE_NOT_FOUND", "Room type does not belong to this property", 404);
  try {
    const ratePlan = await RatePlan.create({
      tenantId: access.tenantId, propertyId: access.propertyId, roomTypeId: new mongoose.Types.ObjectId(roomTypeId),
      name, code, currency, nightlyRate, taxRatePercent, minimumNights: minimumNights ?? 1, maximumNights: maximumNights ?? undefined,
      description: readString(body.description, { max: 2000 }) ?? "",
      isRefundable: body.isRefundable !== false, isActive: true,
    });
    await AuditLog.create({ tenantId: access.tenantId, propertyId: access.propertyId, actorUserId: new mongoose.Types.ObjectId(session.user.id), action: "inventory.rate_plan.created", resourceType: "rate_plan", resourceId: ratePlan._id.toString(), outcome: "success" });
    return NextResponse.json({ data: ratePlan }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) return fail("RATE_PLAN_CONFLICT", "Rate plan code already exists in this property", 409);
    console.error("Rate plan creation failed", error);
    return fail("RATE_PLAN_CREATE_FAILED", "Unable to create rate plan", 500);
  }
}
