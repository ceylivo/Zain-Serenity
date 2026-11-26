import "server-only";
import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import Tenant from "@/models/Tenant";
import Property from "@/models/Property";

export type PublicPropertyResult =
  | {
      ok: true;
      tenantId: mongoose.Types.ObjectId;
      propertyId: mongoose.Types.ObjectId;
      currency: string;
      locale: "en" | "ur";
      timezone: string;
    }
  | {
      ok: false;
      reason: "tenant_not_found" | "tenant_unavailable" | "property_not_found";
    };

export async function resolvePublicProperty(input: {
  tenantSlug: string;
  propertySlug: string;
}): Promise<PublicPropertyResult> {
  await dbConnect();

  const tenant = await Tenant.findOne({ slug: input.tenantSlug })
    .select("_id status defaultCurrency defaultLocale")
    .lean();
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (tenant.status !== "active") return { ok: false, reason: "tenant_unavailable" };

  const property = await Property.findOne({
    tenantId: tenant._id,
    slug: input.propertySlug,
    status: "active",
  })
    .select("_id currency locale timezone")
    .lean();
  if (!property) return { ok: false, reason: "property_not_found" };

  return {
    ok: true,
    tenantId: tenant._id,
    propertyId: property._id,
    currency: property.currency || tenant.defaultCurrency,
    locale: property.locale || tenant.defaultLocale,
    timezone: property.timezone || "UTC",
  };
}
