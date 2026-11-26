import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { collectCashPayment, PaymentLifecycleError } from "@/lib/paymentLifecycle";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string; paymentId: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });

export async function POST(_request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required.", 401);
  const { tenantSlug, propertySlug, paymentId } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "payment:verify" });
  if (!access.ok) {
    const status = access.reason === "tenant_not_found" || access.reason === "property_not_found" ? 404 : 403;
    return fail(access.reason.toUpperCase(), "You cannot record cash collection for this property.", status);
  }
  if (!access.propertyId) return fail("PROPERTY_CONTEXT_REQUIRED", "A property context is required.", 400);
  try {
    const payment = await collectCashPayment({
      tenantId: access.tenantId, propertyId: access.propertyId,
      paymentId, actorUserId: session.user.id,
    });
    return NextResponse.json({ data: payment });
  } catch (error) {
    if (error instanceof PaymentLifecycleError) {
      const status = error.code === "PAYMENT_NOT_FOUND" ? 404
        : error.code === "TRANSACTION_UNAVAILABLE" ? 503
        : error.code === "PAYMENT_OPERATION_FAILED" ? 500 : 409;
      return fail(error.code, error.message, status);
    }
    console.error("Cash collection recording failed", error);
    return fail("CASH_COLLECTION_FAILED", "Unable to record cash collection.", 500);
  }
}
