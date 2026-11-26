import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import dbConnect from "@/lib/dbConnect";
import { isRecord, readString } from "@/lib/inputValidation";
import Tenant from "@/models/Tenant";
import Membership from "@/models/Membership";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return fail("UNAUTHENTICATED", "Authentication required", 401);
  }

  await dbConnect();
  const memberships = await Membership.find({
    userId: new mongoose.Types.ObjectId(session.user.id),
    status: "active",
  })
    .select("tenantId role")
    .sort({ createdAt: -1 })
    .lean();

  const tenantIds = memberships.map((membership) => membership.tenantId);
  const tenants = await Tenant.find({ _id: { $in: tenantIds }, status: "active" })
    .select("name slug status defaultLocale defaultCurrency")
    .lean();
  const tenantById = new Map(tenants.map((tenant) => [tenant._id.toString(), tenant]));

  const data = memberships.flatMap((membership) => {
    const tenant = tenantById.get(membership.tenantId.toString());
    return tenant ? [{ id: membership._id.toString(), role: membership.role, tenant }] : [];
  });

  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return fail("UNAUTHENTICATED", "Authentication required", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  if (!isRecord(body)) return fail("INVALID_BODY", "A JSON object is required", 400);

  const name = readString(body.name, { min: 2, max: 120 });
  const slug = readString(body.slug, { min: 3, max: 63 })?.toLowerCase();
  const defaultLocale = body.defaultLocale === undefined ? "en" : body.defaultLocale;
  const defaultCurrency = body.defaultCurrency === undefined ? "PKR" : body.defaultCurrency;

  if (!name || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return fail("VALIDATION_ERROR", "Provide a valid tenant name and URL slug", 422);
  }
  if (defaultLocale !== "en" && defaultLocale !== "ur") {
    return fail("VALIDATION_ERROR", "defaultLocale must be en or ur", 422);
  }
  if (typeof defaultCurrency !== "string" || !/^[A-Za-z]{3}$/.test(defaultCurrency)) {
    return fail("VALIDATION_ERROR", "defaultCurrency must be a three-letter ISO currency code", 422);
  }

  await dbConnect();
  const userId = new mongoose.Types.ObjectId(session.user.id);
  let tenantId: mongoose.Types.ObjectId | undefined;

  try {
    const tenant = await Tenant.create({
      name, slug, status: "pending", primaryOwnerId: userId,
      defaultLocale, defaultCurrency: defaultCurrency.toUpperCase(),
    });
    tenantId = tenant._id;

    await Membership.create({
      tenantId: tenant._id, userId, role: "tenant_owner", status: "active",
      propertyIds: [], acceptedAt: new Date(),
    });

    tenant.status = "active";
    await tenant.save();

    await AuditLog.create({
      tenantId: tenant._id, actorUserId: userId, action: "tenant.created",
      resourceType: "tenant", resourceId: tenant._id.toString(), outcome: "success",
    });

    return NextResponse.json({
      data: { id: tenant._id.toString(), name: tenant.name, slug: tenant.slug, status: tenant.status, role: "tenant_owner" },
    }, { status: 201 });
  } catch (error) {
    if (tenantId) {
      await Promise.allSettled([
        Membership.deleteOne({ tenantId, userId }),
        Tenant.deleteOne({ _id: tenantId, primaryOwnerId: userId, status: "pending" }),
      ]);
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      return fail("TENANT_CONFLICT", "This tenant URL is already in use", 409);
    }
    console.error("Tenant creation failed", error);
    return fail("TENANT_CREATE_FAILED", "Unable to create tenant", 500);
  }
}
