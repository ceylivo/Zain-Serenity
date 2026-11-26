import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { resolvePublicProperty } from "@/lib/publicProperty";
import { cancelTenantBooking, BookingLifecycleError } from "@/lib/bookingLifecycle";
import Booking from "@/models/Booking";
import dbConnect from "@/lib/dbConnect";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string; bookingId: string }> };

export async function POST(_request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
  }

  const { tenantSlug, propertySlug, bookingId } = await context.params;
  const property = await resolvePublicProperty({ tenantSlug, propertySlug });
  if (!property.ok) {
    const status = property.reason === "tenant_unavailable" ? 403 : 404;
    return NextResponse.json({ error: { code: property.reason.toUpperCase(), message: "This property is not available." } }, { status });
  }

  const staffAccess = await resolveTenantAccess({
    userId: session.user.id,
    tenantSlug,
    propertySlug,
    permission: "booking:cancel",
  });
  const canCancelAny = staffAccess.ok && Boolean(staffAccess.propertyId?.equals(property.propertyId));

  // Guests may cancel only their own booking. Staff with the explicit permission
  // may cancel any booking in the resolved tenant/property scope.
  if (!canCancelAny) {
    await dbConnect();
    const ownedBooking = await Booking.exists({
      _id: mongoose.isValidObjectId(bookingId) ? new mongoose.Types.ObjectId(bookingId) : null,
      tenantId: property.tenantId,
      propertyId: property.propertyId,
      userId: session.user.id,
    });
    if (!ownedBooking) {
      return NextResponse.json({ error: { code: "BOOKING_NOT_FOUND", message: "Booking was not found." } }, { status: 404 });
    }
  }

  try {
    const booking = await cancelTenantBooking({
      tenantId: property.tenantId,
      propertyId: property.propertyId,
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
