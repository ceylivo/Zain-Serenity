import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { resolvePublicProperty } from "@/lib/publicProperty";
import { isRecord, readInteger, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import RoomType from "@/models/RoomType";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });

export async function GET(_request: Request, context: Context) {
  const { tenantSlug, propertySlug } = await context.params;
  const property = await resolvePublicProperty({ tenantSlug, propertySlug });
  if (!property.ok) {
    const status = property.reason === "tenant_unavailable" ? 403 : 404;
    return fail(property.reason.toUpperCase(), "This property is not available.", status);
  }
  await dbConnect();
  const items = await RoomType.find({
    tenantId: property.tenantId,
    propertyId: property.propertyId,
    status: "active",
  })
    .select("name slug description baseNightlyRate currency maxAdults maxChildren inventoryCount amenities images status")
    .sort({ name: 1 })
    .lean();
  return NextResponse.json({ data: items });
}

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:manage" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Inventory management access denied", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const name = readString(body.name, { min: 2, max: 120 });
  const slug = readString(body.slug, { min: 2, max: 80 })?.toLowerCase();
  const currency = readString(body.currency, { min: 3, max: 3 })?.toUpperCase();
  const baseNightlyRate = typeof body.baseNightlyRate === "number" && Number.isFinite(body.baseNightlyRate) && body.baseNightlyRate >= 0 ? body.baseNightlyRate : null;
  const inventoryCount = readInteger(body.inventoryCount, { min: 0, max: 10000 });
  const maxAdults = body.maxAdults === undefined ? 2 : readInteger(body.maxAdults, { min: 1, max: 30 });
  const maxChildren = body.maxChildren === undefined ? 0 : readInteger(body.maxChildren, { min: 0, max: 30 });
  if (!name || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !currency || !/^[A-Z]{3}$/.test(currency) || baseNightlyRate === null || inventoryCount === null || maxAdults === null || maxChildren === null) return fail("VALIDATION_ERROR", "Provide valid name, slug, currency, price, inventory and occupancy values", 422);
  await dbConnect();
  try {
    const roomType = await RoomType.create({
      tenantId: access.tenantId, propertyId: access.propertyId, name, slug,
      description: readString(body.description, { max: 5000 }) ?? "",
      baseNightlyRate, currency, inventoryCount, maxAdults, maxChildren,
      amenities: Array.isArray(body.amenities) ? body.amenities.filter((v): v is string => typeof v === "string").slice(0, 50).map((v) => v.trim().slice(0, 80)) : [],
      images: Array.isArray(body.images) ? body.images.filter((v): v is string => typeof v === "string" && v.length <= 2048).slice(0, 20) : [],
    });
    await AuditLog.create({ tenantId: access.tenantId, propertyId: access.propertyId, actorUserId: new mongoose.Types.ObjectId(session.user.id), action: "inventory.room_type.created", resourceType: "room_type", resourceId: roomType._id.toString(), outcome: "success" });
    return NextResponse.json({ data: roomType }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) return fail("ROOM_TYPE_CONFLICT", "Room type slug already exists in this property", 409);
    console.error("Room type creation failed", error);
    return fail("ROOM_TYPE_CREATE_FAILED", "Unable to create room type", 500);
  }
}
