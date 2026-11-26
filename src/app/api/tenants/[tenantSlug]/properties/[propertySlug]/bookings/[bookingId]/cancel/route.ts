import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { cancelTenantBooking, BookingLifecycleError } from "@/lib/bookingLifecycle";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string; bookingId: string }> };

export async function POST(_request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
  }

  const { tenantSlug, propertySlug, bookingId } = await context.params;
  const access = await resolveTenantAccess({
    userId: session.user.id,
    tenantSlug,
    propertySlug,
    permission: "booking:cancel",
  });
  if (!access.ok) {
    const status = access.reason === "tenant_not_found" || access.reason === "property_not_found" ? 404 : 403;
    return NextResponse.json({ error: { code: access.reason.toUpperCase(), message: "You do not have permission to cancel bookings for this property." } }, { status });
  }
  if (!access.propertyId) {
    return NextResponse.json({ error: { code: "PROPERTY_CONTEXT_REQUIRED", message: "A property context is required." } }, { status: 400 });
  }

  try {
    const booking = await cancelTenantBooking({
      tenantId: access.tenantId,
      propertyId: access.propertyId,
      bookingId,
      actorUserId: session.user.id,
    });
    return NextResponse.json({ data: booking });
  } catch (error) {
    if (error instanceof BookingLifecycleError) {
      const status = error.code === "BOOKING_NOT_FOUND" ? 404
        : error.code === "ROOM_NOT_AVAILABLE" || error.code === "ROOM_ASSIGNMENT_CONFLICT" ? 409
        : error.code === "TRANSACTION_UNAVAILABLE" ? 503
        : error.code === "LIFECYCLE_FAILED" ? 500
        : 422;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }
    console.error("Tenant booking cancellation failed", error);
    return NextResponse.json({ error: { code: "BOOKING_CANCEL_FAILED", message: "Unable to cancel booking." } }, { status: 500 });
  }
}
