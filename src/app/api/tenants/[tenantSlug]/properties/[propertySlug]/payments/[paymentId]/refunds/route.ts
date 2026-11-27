import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import { requestPaymentRefund, transitionPaymentRefund, RefundLifecycleError } from "@/lib/refundLifecycle";
import Refund from "@/models/Refund";
import dbConnect from "@/lib/dbConnect";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string; paymentId: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });
function errorResponse(error: unknown) {
  if (error instanceof RefundLifecycleError) {
    const status = error.code === "PAYMENT_NOT_FOUND" || error.code === "REFUND_NOT_FOUND" ? 404
      : error.code === "TRANSACTION_UNAVAILABLE" ? 503
      : error.code === "REFUND_OPERATION_FAILED" ? 500
      : error.code === "REFUND_LIMIT_EXCEEDED" || error.code === "INVALID_REFUND_STATE" || error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 422;
    return fail(error.code, error.message, status);
  }
  console.error("Refund operation failed", error);
  return fail("REFUND_OPERATION_FAILED", "Unable to complete the refund operation.", 500);
}

export async function GET(_request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required.", 401);
  const { tenantSlug, propertySlug, paymentId } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "payment:read" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Payment read permission is required.", 403);
  if (!mongoose.isValidObjectId(paymentId)) return fail("PAYMENT_NOT_FOUND", "Payment was not found.", 404);
  await dbConnect();
  const refunds = await Refund.find({
    tenantId: access.tenantId, propertyId: access.propertyId, paymentId,
  }).sort({ createdAt: -1 }).limit(100).lean();
  return NextResponse.json({ data: refunds });
}

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required.", 401);
  const { tenantSlug, propertySlug, paymentId } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "payment:refund" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Refund permission is required.", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON.", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required.", 422);
  const amount = typeof body.amount === "number" ? body.amount : Number.NaN;
  const reason = readString(body.reason, { min: 3, max: 500 });
  const idempotencyKey = readString(request.headers.get("idempotency-key"), { min: 8, max: 128 });
  if (!reason || !idempotencyKey || !Number.isFinite(amount) || amount <= 0) return fail("VALIDATION_ERROR", "A positive amount, reason and Idempotency-Key header are required.", 422);
  try {
    const refund = await requestPaymentRefund({
      tenantId: access.tenantId, propertyId: access.propertyId, paymentId,
      actorUserId: session.user.id, amount, reason, idempotencyKey,
    });
    return NextResponse.json({ data: refund }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required.", 401);
  const { tenantSlug, propertySlug, paymentId } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "payment:refund" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Refund approval permission is required.", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON.", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required.", 422);
  const refundId = readString(body.refundId, { min: 24, max: 24 });
  const action = readString(body.action, { min: 5, max: 10 });
  const note = body.note === undefined ? undefined : readString(body.note, { min: 1, max: 500 });
  const externalReference = body.externalReference === undefined ? undefined : readString(body.externalReference, { min: 3, max: 160 });
  if (!refundId || !mongoose.isValidObjectId(refundId) || !["approve", "reject", "processing", "complete", "fail"].includes(action ?? "") ||
      (body.note !== undefined && !note) || (body.externalReference !== undefined && !externalReference)) {
    return fail("VALIDATION_ERROR", "Provide a valid refundId, action, optional note and settlement reference.", 422);
  }
  try {
    await dbConnect();
    const refund = await Refund.findOne({ _id: refundId, tenantId: access.tenantId, propertyId: access.propertyId }).select("_id").lean();
    if (!refund) return fail("REFUND_NOT_FOUND", "Refund was not found in this property.", 404);
    const result = await transitionPaymentRefund({
      tenantId: access.tenantId, propertyId: access.propertyId, refundId,
      actorUserId: session.user.id, action: action as "approve" | "reject" | "processing" | "complete" | "fail",
      note: note ?? undefined, externalReference: externalReference ?? undefined,
    });
    return NextResponse.json({ data: result });
  } catch (error) { return errorResponse(error); }
}
