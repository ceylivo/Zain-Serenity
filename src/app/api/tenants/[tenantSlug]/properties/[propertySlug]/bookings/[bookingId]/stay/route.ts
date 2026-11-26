import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import { BookingLifecycleError, transitionBookingStay } from "@/lib/bookingLifecycle";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string; bookingId: string }> };

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
  }
  const { tenantSlug, propertySlug, bookingId } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "booking:update" });
  if (!access.ok || !access.propertyId) {
    const status = access.reason === "tenant_not_found" || access.reason === "property_not_found" ? 404 : 403;
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "You cannot operate bookings for this property." } }, { status });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A JSON object is required." } }, { status: 422 });
  const action = readString(body.action, { min: 7, max: 8 });
  if (action !== "confirm" && action !== "check_in" && action !== "check_out") {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Action must be confirm, check_in or check_out." } }, { status: 422 });
  }
  try {
    const booking = await transitionBookingStay({
      tenantId: access.tenantId, propertyId: access.propertyId, bookingId,
      actorUserId: session.user.id, action,
    });
    return NextResponse.json({ data: booking });
  } catch (error) {
    if (error instanceof BookingLifecycleError) {
      const status = error.code === "BOOKING_NOT_FOUND" ? 404
        : error.code === "TRANSACTION_UNAVAILABLE" ? 503
        : error.code === "INVALID_BOOKING_STATE" || error.code === "ROOM_NOT_AVAILABLE" ? 409 : 500;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }
    console.error("Booking stay transition failed", error);
    return NextResponse.json({ error: { code: "BOOKING_STAY_TRANSITION_FAILED", message: "Unable to update booking stay." } }, { status: 500 });
  }
}
