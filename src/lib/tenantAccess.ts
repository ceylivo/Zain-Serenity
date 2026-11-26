import "server-only";

import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import Membership, { type TenantRole } from "@/models/Membership";
import Tenant from "@/models/Tenant";
import Property from "@/models/Property";
import { hasPermission, type Permission } from "@/lib/permissions";

export type TenantAccessResult =
  | {
      ok: true;
      tenantId: mongoose.Types.ObjectId;
      membershipId: mongoose.Types.ObjectId;
      role: TenantRole;
      propertyId?: mongoose.Types.ObjectId;
    }
  | {
      ok: false;
      reason: "tenant_not_found" | "tenant_unavailable" | "membership_required" | "property_not_found" | "permission_denied";
    };

export async function resolveTenantAccess(input: {
  userId: string;
  tenantSlug: string;
  propertySlug?: string;
  permission?: Permission;
}): Promise<TenantAccessResult> {
  if (!mongoose.isValidObjectId(input.userId)) {
    return { ok: false, reason: "membership_required" };
  }

  await dbConnect();

  const tenant = await Tenant.findOne({ slug: input.tenantSlug })
    .select("_id status")
    .lean();

  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (tenant.status !== "active") {
    return { ok: false, reason: "tenant_unavailable" };
  }

  const membership = await Membership.findOne({
    tenantId: tenant._id,
    userId: new mongoose.Types.ObjectId(input.userId),
    status: "active",
  })
    .select("_id role propertyIds")
    .lean();

  if (!membership) return { ok: false, reason: "membership_required" };

  let propertyId: mongoose.Types.ObjectId | undefined;
  if (input.propertySlug) {
    const property = await Property.findOne({
      tenantId: tenant._id,
      slug: input.propertySlug,
      status: "active",
    })
      .select("_id")
      .lean();

    if (!property) return { ok: false, reason: "property_not_found" };

    const assignedProperties = membership.propertyIds ?? [];
    if (
      membership.role !== "tenant_owner" &&
      !assignedProperties.some((id) => id.equals(property._id))
    ) {
      return { ok: false, reason: "permission_denied" };
    }
    propertyId = property._id;
  }

  if (
    input.permission &&
    !hasPermission(membership.role as TenantRole, input.permission)
  ) {
    return { ok: false, reason: "permission_denied" };
  }

  return {
    ok: true,
    tenantId: tenant._id,
    membershipId: membership._id,
    role: membership.role as TenantRole,
    ...(propertyId ? { propertyId } : {}),
  };
}

export function tenantScopedFilter<T extends Record<string, unknown>>(
  tenantId: mongoose.Types.ObjectId,
  filter: T
): T & { tenantId: mongoose.Types.ObjectId } {
  return { ...filter, tenantId };
}
