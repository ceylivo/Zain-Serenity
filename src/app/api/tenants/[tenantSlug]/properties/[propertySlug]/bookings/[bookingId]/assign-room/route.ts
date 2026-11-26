import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import { assignPhysicalRoom, BookingLifecycleError } from "@/lib/bookingLifecycle";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string; bookingId: string }> };

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
  }

  const { tenantSlug, propertySlug, bookingId } = await context.params;
  const access = await resolveTenantAccess({
    userId: session.user.id,
    tenantSlug,
    propertySlug,
    permission: "booking:update",
  });
  if (!access.ok) {
    const status = access.reason === "tenant_not_found" || access.reason === "property_not_found" ? 404 : 403;
    return NextResponse.json({ error: { code: access.reason.toUpperCase(), message: "You do not have permission to assign rooms for this property." } }, { status });
  }
  if (!access.propertyId) {
    return NextResponse.json({ error: { code: "PROPERTY_CONTEXT_REQUIRED", message: "A property context is required." } }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A JSON object is required." } }, { status: 422 });
  }
  const physicalRoomId = readString(body.physicalRoomId, { min: 24, max: 24 });
  if (!physicalRoomId || !mongoose.isValidObjectId(physicalRoomId)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A valid physicalRoomId is required." } }, { status: 422 });
  }

  try {
    const booking = await assignPhysicalRoom({
      tenantId: access.tenantId,
      propertyId: access.propertyId,
      bookingId,
      physicalRoomId,
      actorUserId: session.user.id,
    });
    return NextResponse.json({ data: booking });
  } catch (error) {
    if (error instanceof BookingLifecycleError) {
      const status = error.code === "BOOKING_NOT_FOUND" ? 404
        : error.code === "ROOM_NOT_AVAILABLE" || error.code === "ROOM_ASSIGNMENT_CONFLICT" || error.code === "INVALID_BOOKING_STATE" ? 409
        : error.code === "TRANSACTION_UNAVAILABLE" ? 503
        : error.code === "LIFECYCLE_FAILED" ? 500
        : 422;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
    }
    console.error("Physical room assignment failed", error);
    return NextResponse.json({ error: { code: "ROOM_ASSIGNMENT_FAILED", message: "Unable to assign physical room." } }, { status: 500 });
  }
}
