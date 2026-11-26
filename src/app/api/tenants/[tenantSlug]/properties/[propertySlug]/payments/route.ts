import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolvePublicProperty } from "@/lib/publicProperty";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import { createPaymentAttempt, PaymentLifecycleError } from "@/lib/paymentLifecycle";
import { PAYMENT_METHODS, type PaymentMethod } from "@/models/Payment";
import Payment from "@/models/Payment";
import PaymentSettings from "@/models/PaymentSettings";
import Booking from "@/models/Booking";
import dbConnect from "@/lib/dbConnect";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const property = await resolvePublicProperty({ tenantSlug, propertySlug });
  if (!property.ok) return fail(property.reason.toUpperCase(), "This property is not available.", property.reason === "tenant_unavailable" ? 403 : 404);

  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON.", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required.", 422);
  const bookingId = readString(body.bookingId, { min: 24, max: 24 });
  const method = readString(body.method, { min: 1, max: 32 }) as PaymentMethod | null;
  const idempotencyKey = readString(request.headers.get("idempotency-key"), { min: 8, max: 128 });
  if (!bookingId || !mongoose.isValidObjectId(bookingId) || !method || !PAYMENT_METHODS.includes(method) || !idempotencyKey) {
    return fail("VALIDATION_ERROR", "Provide a valid bookingId, payment method and Idempotency-Key header.", 422);
  }

  await dbConnect();
  const settings = await PaymentSettings.findOne({ tenantId: property.tenantId, propertyId: property.propertyId }).select("enabledMethods").lean();
  if (!settings?.enabledMethods.includes(method as Exclude<PaymentMethod, "stripe">)) {
    return fail("PAYMENT_METHOD_DISABLED", "This payment method is not enabled for this property.", 422);
  }

  try {
    const payment = await createPaymentAttempt({
      tenantId: property.tenantId, propertyId: property.propertyId,
      bookingId, userId: session.user.id, method, idempotencyKey,
    });
    return NextResponse.json({ data: payment }, { status: 201 });
  } catch (error) {
    if (error instanceof PaymentLifecycleError) {
      const status = error.code === "BOOKING_NOT_FOUND" || error.code === "PAYMENT_NOT_FOUND" ? 404
        : error.code === "PAYMENT_ATTEMPT_EXISTS" || error.code === "PAYMENT_ALREADY_SETTLED" ? 409
        : error.code === "TRANSACTION_UNAVAILABLE" ? 503
        : error.code === "PAYMENT_OPERATION_FAILED" ? 500 : 422;
      return fail(error.code, error.message, status);
    }
    console.error("Payment attempt creation failed", error);
    return fail("PAYMENT_CREATE_FAILED", "Unable to create payment attempt.", 500);
  }
}

export async function GET(_request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const property = await resolvePublicProperty({ tenantSlug, propertySlug });
  if (!property.ok) return fail(property.reason.toUpperCase(), "This property is not available.", property.reason === "tenant_unavailable" ? 403 : 404);

  const staff = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "payment:read" });
  const canReadAll = staff.ok && Boolean(staff.propertyId?.equals(property.propertyId));
  await dbConnect();
  const filter: Record<string, unknown> = { tenantId: property.tenantId, propertyId: property.propertyId };
  if (!canReadAll) filter.userId = new mongoose.Types.ObjectId(session.user.id);
  const payments = await Payment.find(filter)
    .select("bookingId method status amount currency reference submittedAt verifiedAt createdAt updatedAt")
    .sort({ createdAt: -1 }).limit(100).lean();
  return NextResponse.json({ data: payments });
}
