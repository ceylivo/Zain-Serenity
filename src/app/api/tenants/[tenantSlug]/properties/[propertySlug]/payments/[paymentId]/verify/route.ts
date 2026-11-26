import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import { PaymentLifecycleError, verifyManualPayment } from "@/lib/paymentLifecycle";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string; paymentId: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required.", 401);
  const { tenantSlug, propertySlug, paymentId } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "payment:verify" });
  if (!access.ok) {
    const status = access.reason === "tenant_not_found" || access.reason === "property_not_found" ? 404 : 403;
    return fail(access.reason.toUpperCase(), "You cannot verify payments for this property.", status);
  }
  if (!access.propertyId) return fail("PROPERTY_CONTEXT_REQUIRED", "A property context is required.", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON.", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required.", 422);
  const outcome = readString(body.outcome, { min: 1, max: 16 });
  if (outcome !== "succeeded" && outcome !== "failed") return fail("VALIDATION_ERROR", "Outcome must be succeeded or failed.", 422);
  try {
    const payment = await verifyManualPayment({
      tenantId: access.tenantId, propertyId: access.propertyId,
      paymentId, actorUserId: session.user.id, outcome,
    });
    return NextResponse.json({ data: payment });
  } catch (error) {
    if (error instanceof PaymentLifecycleError) {
      const status = error.code === "PAYMENT_NOT_FOUND" ? 404
        : error.code === "TRANSACTION_UNAVAILABLE" ? 503
        : error.code === "PAYMENT_OPERATION_FAILED" ? 500 : 409;
      return fail(error.code, error.message, status);
    }
    console.error("Manual payment verification failed", error);
    return fail("PAYMENT_VERIFY_FAILED", "Unable to verify payment.", 500);
  }
}
