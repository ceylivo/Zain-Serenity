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

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
  }

  await dbConnect();
  const memberships = await Membership.find({
    userId: new mongoose.Types.ObjectId(session.user.id),
    status: "active",
  })
    .select("tenantId role status")
    .populate({ path: "tenantId", select: "name slug status defaultLocale defaultCurrency" })
    .sort({ createdAt: -1 })
    .lean();

  const data = memberships
    .filter((membership) => membership.tenantId && typeof membership.tenantId === "object" && "status" in membership.tenantId && membership.tenantId.status === "active")
    .map((membership) => ({
      id: String(membership._id),
      role: membership.role,
      tenant: membership.tenantId,
    }));

  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: { code: "INVALID_BODY", message: "A JSON object is required" } }, { status: 400 });
  }

  const name = readString(body.name, { min: 2, max: 120 });
  const slug = readString(body.slug, { min: 3, max: 63 })?.toLowerCase();
  const defaultLocale = body.defaultLocale === undefined ? "en" : body.defaultLocale;
  const defaultCurrency = body.defaultCurrency === undefined ? "PKR" : body.defaultCurrency;

  if (!name || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Provide a valid tenant name and URL slug" } }, { status: 422 });
  }
  if (defaultLocale !== "en" && defaultLocale !== "ur") {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "defaultLocale must be en or ur" } }, { status: 422 });
  }
  if (typeof defaultCurrency !== "string" || !/^[A-Za-z]{3}$/.test(defaultCurrency)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "defaultCurrency must be a three-letter ISO currency code" } }, { status: 422 });
  }

  await dbConnect();
  const userId = new mongoose.Types.ObjectId(session.user.id);
  let tenantId: mongoose.Types.ObjectId | undefined;

  try {
    const tenant = await Tenant.create({
      name,
      slug,
      status: "pending",
      primaryOwnerId: userId,
      defaultLocale,
      defaultCurrency: defaultCurrency.toUpperCase(),
    });
    tenantId = tenant._id;

    await Membership.create({
      tenantId: tenant._id,
      userId,
      role: "tenant_owner",
      status: "active",
      propertyIds: [],
      acceptedAt: new Date(),
    });

    tenant.status = "active";
    await tenant.save();

    await AuditLog.create({
      tenantId: tenant._id,
      actorUserId: userId,
      action: "tenant.created",
      resourceType: "tenant",
      resourceId: tenant._id.toString(),
      outcome: "success",
    });

    return NextResponse.json({
      data: {
        id: tenant._id.toString(),
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        role: "tenant_owner",
      },
    }, { status: 201 });
  } catch (error) {
    if (tenantId) {
      await Promise.allSettled([
        Membership.deleteOne({ tenantId, userId }),
        Tenant.deleteOne({ _id: tenantId, primaryOwnerId: userId, status: "pending" }),
      ]);
    }

    if (error instanceof mongoose.Error || (typeof error === "object" && error !== null && "code" in error && error.code === 11000)) {
      return NextResponse.json({ error: { code: "TENANT_CONFLICT", message: "This tenant URL is already in use or the request conflicts with an existing record" } }, { status: 409 });
    }

    console.error("Tenant creation failed", error);
    return NextResponse.json({ error: { code: "TENANT_CREATE_FAILED", message: "Unable to create tenant" } }, { status: 500 });
  }
}
