import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import { HousekeepingError, updateHousekeepingStatus } from "@/lib/housekeepingLifecycle";
import type { PhysicalRoomStatus } from "@/models/PhysicalRoom";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string; roomId: string }> };
const allowed = ["ready", "occupied", "cleaning", "maintenance", "out_of_service"];

export async function PATCH(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required." } }, { status: 401 });
  }
  const { tenantSlug, propertySlug, roomId } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:housekeeping" });
  if (!access.ok || !access.propertyId) {
    const status = access.reason === "tenant_not_found" || access.reason === "property_not_found" ? 404 : 403;
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Housekeeping permission is required for this property." } }, { status });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!isRecord(body)) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A JSON object is required." } }, { status: 422 });
  const status = readString(body.status, { min: 4, max: 16 });
  if (!status || !allowed.includes(status)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A valid housekeeping status is required." } }, { status: 422 });
  }
  try {
    const room = await updateHousekeepingStatus({
      tenantId: access.tenantId, propertyId: access.propertyId,
      roomId, actorUserId: session.user.id, status: status as PhysicalRoomStatus,
    });
    return NextResponse.json({ data: room });
  } catch (error) {
    if (error instanceof HousekeepingError) {
      const httpStatus = error.code === "ROOM_NOT_FOUND" ? 404 : error.code === "INVALID_ROOM_STATE" ? 409 : 500;
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: httpStatus });
    }
    console.error("Housekeeping status update failed", error);
    return NextResponse.json({ error: { code: "HOUSEKEEPING_FAILED", message: "Unable to update room status." } }, { status: 500 });
  }
}
