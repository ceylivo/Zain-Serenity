import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { resolvePublicProperty } from "@/lib/publicProperty";
import { isRecord, isValidDateOnly, readInteger, readString } from "@/lib/inputValidation";
import { createInventoryBooking, InventoryReservationError } from "@/lib/inventoryReservation";
import Booking from "@/models/Booking";
import dbConnect from "@/lib/dbConnect";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ tenantSlug: string; propertySlug: string }> };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}
function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function POST(request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return errorResponse("UNAUTHENTICATED", "Authentication required", 401);
  }

  const { tenantSlug, propertySlug } = await context.params;
  const property = await resolvePublicProperty({ tenantSlug, propertySlug });
  if (!property.ok) {
    const status = property.reason === "tenant_unavailable" ? 403 : 404;
    return errorResponse(property.reason.toUpperCase(), "This property is not available for booking.", status);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  if (!isRecord(body)) return errorResponse("VALIDATION_ERROR", "A JSON object is required", 422);

  const roomTypeId = readString(body.roomTypeId, { min: 24, max: 24 });
  const ratePlanId = readString(body.ratePlanId, { min: 24, max: 24 });
  const checkIn = body.checkIn;
  const checkOut = body.checkOut;
  const guests = readInteger(body.guests, { min: 1, max: 50 });
  const children = body.children === undefined ? 0 : readInteger(body.children, { min: 0, max: 50 });
  const specialRequests = body.specialRequests === undefined ? "" : readString(body.specialRequests, { max: 2000 });

  if (!roomTypeId || !mongoose.isValidObjectId(roomTypeId) || !ratePlanId || !mongoose.isValidObjectId(ratePlanId) ||
      !isValidDateOnly(checkIn) || !isValidDateOnly(checkOut) || guests === null || children === null || specialRequests === null) {
    return errorResponse("VALIDATION_ERROR", "Provide valid room type, rate plan, dates, guest counts and special requests.", 422);
  }

  const start = parseDateOnly(checkIn);
  const end = parseDateOnly(checkOut);
  if (end <= start) return errorResponse("INVALID_STAY", "Check-out must be after check-in.", 422);

  try {
    const booking = await createInventoryBooking({
      tenantId: property.tenantId,
      propertyId: property.propertyId,
      userId: session.user.id,
      roomTypeId,
      ratePlanId,
      checkIn: start,
      checkOut: end,
      guests,
      children,
      specialRequests,
    });
    return NextResponse.json({ data: booking }, { status: 201 });
  } catch (error) {
    if (error instanceof InventoryReservationError) {
      const status = error.code === "INSUFFICIENT_INVENTORY" ? 409
        : error.code === "TRANSACTION_UNAVAILABLE" ? 503
        : error.code === "RESERVATION_FAILED" ? 500
        : 422;
      return errorResponse(error.code, error.message, status);
    }
    console.error("Inventory booking creation failed", error);
    return errorResponse("BOOKING_CREATE_FAILED", "Unable to create booking.", 500);
  }
}

export async function GET(request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return errorResponse("UNAUTHENTICATED", "Authentication required", 401);
  }

  const { tenantSlug, propertySlug } = await context.params;
  const property = await resolvePublicProperty({ tenantSlug, propertySlug });
  if (!property.ok) {
    const status = property.reason === "tenant_unavailable" ? 403 : 404;
    return errorResponse(property.reason.toUpperCase(), "This property is not available.", status);
  }

  const staffAccess = await resolveTenantAccess({
    userId: session.user.id,
    tenantSlug,
    propertySlug,
    permission: "booking:read",
  });
  const canReadAll = staffAccess.ok && Boolean(staffAccess.propertyId?.equals(property.propertyId));

  const url = new URL(request.url);
  const page = Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
  await dbConnect();

  const filter: Record<string, unknown> = {
    tenantId: property.tenantId,
    propertyId: property.propertyId,
  };
  if (!canReadAll) filter.userId = session.user.id;

  const [items, total] = await Promise.all([
    Booking.find(filter)
      .select("userId roomId roomTypeId physicalRoomId ratePlanId checkIn checkOut guests children totalPrice currency pricing paymentStatus status specialRequests createdAt updatedAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);

  return NextResponse.json({
    data: items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}
