import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, isValidIanaTimezone, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import Property from "@/models/Property";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ tenantSlug: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
  }

  const { tenantSlug } = await context.params;
  const access = await resolveTenantAccess({
    userId: session.user.id,
    tenantSlug,
    permission: "property:read",
  });

  if (!access.ok) {
    const status = access.reason === "tenant_not_found" ? 404 : access.reason === "permission_denied" ? 403 : 403;
    return NextResponse.json({ error: { code: access.reason.toUpperCase(), message: "Tenant access denied" } }, { status });
  }

  await dbConnect();
  const propertyFilter: Record<string, unknown> = { tenantId: access.tenantId };
  if (access.role !== "tenant_owner") {
    const membership = await (await import("@/models/Membership")).default.findById(access.membershipId).select("propertyIds").lean();
    propertyFilter._id = { $in: membership?.propertyIds ?? [] };
  }

  const properties = await Property.find(propertyFilter)
    .select("name slug description status timezone locale currency address checkInTime checkOutTime createdAt")
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({ data: properties });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
  }

  const { tenantSlug } = await context.params;
  const access = await resolveTenantAccess({
    userId: session.user.id,
    tenantSlug,
    permission: "property:create",
  });

  if (!access.ok) {
    const status = access.reason === "tenant_not_found" ? 404 : 403;
    return NextResponse.json({ error: { code: access.reason.toUpperCase(), message: "Tenant access denied" } }, { status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } }, { status: 400 });
  }

  if (!isRecord(body) || !isRecord(body.address)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Property details and address are required" } }, { status: 422 });
  }

  const name = readString(body.name, { min: 2, max: 120 });
  const slug = readString(body.slug, { min: 2, max: 63 })?.toLowerCase();
  const city = readString(body.address.city, { min: 1, max: 100 });
  const countryCode = readString(body.address.countryCode, { min: 2, max: 2 })?.toUpperCase();
  const timezone = body.timezone === undefined ? "UTC" : body.timezone;
  const locale = body.locale === undefined ? "en" : body.locale;
  const currency = body.currency === undefined ? "PKR" : body.currency;

  if (!name || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !city || !countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Provide a valid property name, slug, city and two-letter country code" } }, { status: 422 });
  }
  if (!isValidIanaTimezone(timezone)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "A valid IANA timezone is required" } }, { status: 422 });
  }
  if (locale !== "en" && locale !== "ur") {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "locale must be en or ur" } }, { status: 422 });
  }
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "currency must be a three-letter ISO currency code" } }, { status: 422 });
  }

  await dbConnect();
  try {
    const property = await Property.create({
      tenantId: access.tenantId,
      name,
      slug,
      description: readString(body.description, { max: 5000 }) ?? "",
      timezone,
      locale,
      currency: currency.toUpperCase(),
      address: {
        line1: readString(body.address.line1, { max: 160 }) ?? undefined,
        line2: readString(body.address.line2, { max: 160 }) ?? undefined,
        city,
        region: readString(body.address.region, { max: 100 }) ?? undefined,
        countryCode,
        postalCode: readString(body.address.postalCode, { max: 24 }) ?? undefined,
      },
      checkInTime: readString(body.checkInTime, { min: 5, max: 5 }) ?? "14:00",
      checkOutTime: readString(body.checkOutTime, { min: 5, max: 5 }) ?? "11:00",
    });

    await AuditLog.create({
      tenantId: access.tenantId,
      propertyId: property._id,
      actorUserId: new mongoose.Types.ObjectId(session.user.id),
      action: "property.created",
      resourceType: "property",
      resourceId: property._id.toString(),
      outcome: "success",
    });

    return NextResponse.json({
      data: {
        id: property._id.toString(),
        tenantId: access.tenantId.toString(),
        name: property.name,
        slug: property.slug,
        status: property.status,
      },
    }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return NextResponse.json({ error: { code: "PROPERTY_CONFLICT", message: "This property URL is already in use within the tenant" } }, { status: 409 });
    }
    console.error("Property creation failed", error);
    return NextResponse.json({ error: { code: "PROPERTY_CREATE_FAILED", message: "Unable to create property" } }, { status: 500 });
  }
}
