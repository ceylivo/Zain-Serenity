import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolvePublicProperty } from "@/lib/publicProperty";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import PaymentSettings from "@/models/PaymentSettings";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });
const METHODS = ["bank_transfer", "easypaisa", "jazzcash", "cash_on_arrival"] as const;


function publicSettings(settings: { enabledMethods: string[]; bankTransfer?: unknown; easypaisa?: unknown; jazzcash?: unknown; cashInstructions?: string } | null) {
  if (!settings) return { enabledMethods: [] as string[] };
  return {
    enabledMethods: settings.enabledMethods,
    ...(settings.enabledMethods.includes("bank_transfer") && settings.bankTransfer ? { bankTransfer: settings.bankTransfer } : {}),
    ...(settings.enabledMethods.includes("easypaisa") && settings.easypaisa ? { easypaisa: settings.easypaisa } : {}),
    ...(settings.enabledMethods.includes("jazzcash") && settings.jazzcash ? { jazzcash: settings.jazzcash } : {}),
    ...(settings.enabledMethods.includes("cash_on_arrival") && settings.cashInstructions ? { cashInstructions: settings.cashInstructions } : {}),
  };
}

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return readString(value, { max });
}
function section(value: unknown, fields: Record<string, number>) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const output: Record<string, string | undefined> = {};
  for (const [key, max] of Object.entries(fields)) {
    const parsed = optionalText(value[key], max);
    if (parsed === null) return null;
    output[key] = parsed;
  }
  return output;
}

export async function GET(_request: Request, context: Context) {
  const { tenantSlug, propertySlug } = await context.params;
  const property = await resolvePublicProperty({ tenantSlug, propertySlug });
  if (!property.ok) return fail(property.reason.toUpperCase(), "This property is not available.", property.reason === "tenant_unavailable" ? 403 : 404);
  await dbConnect();
  const settings = await PaymentSettings.findOne({ tenantId: property.tenantId, propertyId: property.propertyId })
    .select("enabledMethods bankTransfer easypaisa jazzcash cashInstructions")
    .lean();
  return NextResponse.json({ data: publicSettings(settings) });
}

export async function PUT(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required.", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({
    userId: session.user.id, tenantSlug, propertySlug, permission: "payment:manage",
  });
  if (!access.ok) {
    const status = access.reason === "tenant_not_found" || access.reason === "property_not_found" ? 404 : 403;
    return fail(access.reason.toUpperCase(), "Only an authorized tenant owner can configure payment methods.", status);
  }
  if (!access.propertyId) return fail("PROPERTY_CONTEXT_REQUIRED", "A property context is required.", 400);

  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON.", 400); }
  if (!isRecord(body) || !Array.isArray(body.enabledMethods)) return fail("VALIDATION_ERROR", "enabledMethods must be an array.", 422);
  if (body.enabledMethods.length > METHODS.length) return fail("VALIDATION_ERROR", "Too many payment methods were supplied.", 422);
  const enabledMethods = [...new Set(body.enabledMethods)];
  if (enabledMethods.some((method) => typeof method !== "string" || !METHODS.includes(method as typeof METHODS[number]))) {
    return fail("VALIDATION_ERROR", "One or more payment methods are unsupported.", 422);
  }

  const bankTransfer = section(body.bankTransfer, { bankName: 100, accountTitle: 120, accountNumber: 64, iban: 34, instructions: 1000 });
  const easypaisa = section(body.easypaisa, { accountTitle: 120, accountNumber: 32, instructions: 1000 });
  const jazzcash = section(body.jazzcash, { accountTitle: 120, accountNumber: 32, instructions: 1000 });
  const cashInstructions = optionalText(body.cashInstructions, 1000);
  if (bankTransfer === null || easypaisa === null || jazzcash === null || cashInstructions === null) {
    return fail("VALIDATION_ERROR", "Payment instruction fields must be valid text values within their limits.", 422);
  }
  if (enabledMethods.includes("bank_transfer") && (!bankTransfer?.bankName || !bankTransfer.accountTitle || (!bankTransfer.accountNumber && !bankTransfer.iban))) {
    return fail("BANK_DETAILS_REQUIRED", "Bank name, account title and account number or IBAN are required to enable bank transfer.", 422);
  }
  if (enabledMethods.includes("easypaisa") && (!easypaisa?.accountTitle || !easypaisa.accountNumber)) {
    return fail("EASYPAISA_DETAILS_REQUIRED", "Account title and number are required to enable Easypaisa.", 422);
  }
  if (enabledMethods.includes("jazzcash") && (!jazzcash?.accountTitle || !jazzcash.accountNumber)) {
    return fail("JAZZCASH_DETAILS_REQUIRED", "Account title and number are required to enable JazzCash.", 422);
  }

  await dbConnect();
  const update: Record<string, unknown> = { enabledMethods };
  if (bankTransfer !== undefined) update.bankTransfer = bankTransfer;
  if (easypaisa !== undefined) update.easypaisa = easypaisa;
  if (jazzcash !== undefined) update.jazzcash = jazzcash;
  if (cashInstructions !== undefined) update.cashInstructions = cashInstructions;
  const settings = await PaymentSettings.findOneAndUpdate(
    { tenantId: access.tenantId, propertyId: access.propertyId },
    { $set: update, $setOnInsert: { tenantId: access.tenantId, propertyId: access.propertyId } },
    { new: true, upsert: true, runValidators: true }
  ).select("enabledMethods bankTransfer easypaisa jazzcash cashInstructions").lean();

  await AuditLog.create({
    tenantId: access.tenantId, propertyId: access.propertyId,
    actorUserId: new mongoose.Types.ObjectId(session.user.id),
    action: "payment.settings.updated", resourceType: "payment_settings",
    resourceId: settings?._id?.toString(), outcome: "success",
    metadata: { enabledMethods },
  });
  return NextResponse.json({ data: publicSettings(settings) });
}
