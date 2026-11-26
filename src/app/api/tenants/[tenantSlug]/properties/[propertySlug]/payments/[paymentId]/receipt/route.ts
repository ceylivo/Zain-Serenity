import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolvePublicProperty } from "@/lib/publicProperty";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { submitPaymentProof, PaymentLifecycleError } from "@/lib/paymentLifecycle";
import Payment from "@/models/Payment";
import PaymentReceipt from "@/models/PaymentReceipt";
import dbConnect from "@/lib/dbConnect";

export const runtime = "nodejs";
export const maxDuration = 30;
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string; paymentId: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });
const MAX_FILE_SIZE = 5 * 1024 * 1024;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function detectImage(bytes: Uint8Array): { mime: string; format: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", format: "jpg" };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: "image/png", format: "png" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", format: "webp" };
  return null;
}

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug, paymentId } = await context.params;
  const property = await resolvePublicProperty({ tenantSlug, propertySlug });
  if (!property.ok) return fail(property.reason.toUpperCase(), "This property is not available.", property.reason === "tenant_unavailable" ? 403 : 404);
  if (!mongoose.isValidObjectId(paymentId)) return fail("PAYMENT_NOT_FOUND", "Payment was not found.", 404);

  await dbConnect();
  const payment = await Payment.findOne({
    _id: new mongoose.Types.ObjectId(paymentId), tenantId: property.tenantId,
    propertyId: property.propertyId, userId: new mongoose.Types.ObjectId(session.user.id),
    method: { $in: ["bank_transfer", "easypaisa", "jazzcash"] }, status: "pending",
  }).lean();
  if (!payment) return fail("INVALID_PAYMENT_STATE", "This payment is not awaiting a receipt from your account.", 409);

  const existing = await PaymentReceipt.findOne({ paymentId: payment._id }).select("_id").lean();
  if (existing) return fail("RECEIPT_ALREADY_SUBMITTED", "A receipt has already been submitted for this payment.", 409);

  let form: FormData;
  try { form = await request.formData(); } catch { return fail("INVALID_FORM", "A multipart form with a receipt file is required.", 400); }
  const file = form.get("file");
  if (!(file instanceof File)) return fail("FILE_REQUIRED", "Select a receipt image.", 422);
  if (file.size < 1 || file.size > MAX_FILE_SIZE) return fail("FILE_SIZE_INVALID", "Receipt images must be 5 MB or smaller.", 422);

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectImage(buffer);
  if (!detected || file.type !== detected.mime) return fail("FILE_TYPE_INVALID", "Only valid JPEG, PNG and WebP receipt images are accepted.", 422);
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return fail("RECEIPT_STORAGE_UNAVAILABLE", "Private receipt storage is not configured.", 503);
  }

  let uploaded: { public_id: string; resource_type: "image" | "raw" };
  try {
    uploaded = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({
        folder: `zain-serenity-private/${property.tenantId.toString()}/${property.propertyId.toString()}/payment-receipts`,
        resource_type: "image",
        type: "authenticated",
        access_mode: "authenticated",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
      }, (error, result) => {
        if (error || !result) reject(error ?? new Error("Cloudinary returned no upload result"));
        else resolve({ public_id: result.public_id, resource_type: result.resource_type as "image" | "raw" });
      }).end(buffer);
    });
  } catch (error) {
    console.error("Private payment receipt upload failed", error);
    return fail("RECEIPT_UPLOAD_FAILED", "Unable to upload receipt. Please retry.", 502);
  }

  let savedReceiptId: mongoose.Types.ObjectId | null = null;
  try {
    const savedReceipt = await PaymentReceipt.create({
      tenantId: property.tenantId, propertyId: property.propertyId,
      paymentId: payment._id, bookingId: payment.bookingId,
      uploadedBy: new mongoose.Types.ObjectId(session.user.id),
      storageProvider: "cloudinary", storageKey: uploaded.public_id,
      resourceType: uploaded.resource_type, mimeType: detected.mime,
      fileSize: file.size, originalName: file.name.slice(0, 180) || `receipt.${detected.format}`,
    });
    savedReceiptId = savedReceipt._id;
    const updated = await submitPaymentProof({
      tenantId: property.tenantId, propertyId: property.propertyId,
      paymentId, userId: session.user.id,
      reference: typeof form.get("reference") === "string" ? String(form.get("reference")).trim().slice(0, 120) : undefined,
    });
    return NextResponse.json({ data: { payment: updated, receiptSubmitted: true } }, { status: 201 });
  } catch (error) {
    await cloudinary.uploader.destroy(uploaded.public_id, { resource_type: "image", type: "authenticated" }).catch(() => undefined);
    if (savedReceiptId) await PaymentReceipt.deleteOne({ _id: savedReceiptId }).catch(() => undefined);
    if (error instanceof PaymentLifecycleError) return fail(error.code, error.message, 422);
    console.error("Payment receipt metadata save failed", error);
    return fail("RECEIPT_SAVE_FAILED", "Unable to save receipt details.", 500);
  }
}

export async function GET(_request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug, paymentId } = await context.params;
  const property = await resolvePublicProperty({ tenantSlug, propertySlug });
  if (!property.ok) return fail(property.reason.toUpperCase(), "This property is not available.", property.reason === "tenant_unavailable" ? 403 : 404);
  if (!mongoose.isValidObjectId(paymentId)) return fail("PAYMENT_NOT_FOUND", "Payment was not found.", 404);

  const staff = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "payment:read" });
  await dbConnect();
  const payment = await Payment.findOne({
    _id: new mongoose.Types.ObjectId(paymentId), tenantId: property.tenantId, propertyId: property.propertyId,
  }).select("userId").lean();
  if (!payment) return fail("PAYMENT_NOT_FOUND", "Payment was not found.", 404);
  const isOwner = payment.userId.toString() === session.user.id;
  const isStaff = staff.ok && Boolean(staff.propertyId?.equals(property.propertyId));
  if (!isOwner && !isStaff) return fail("FORBIDDEN", "You cannot access this receipt.", 403);

  const receipt = await PaymentReceipt.findOne({
    paymentId: new mongoose.Types.ObjectId(paymentId),
    tenantId: property.tenantId, propertyId: property.propertyId,
  }).lean();
  if (!receipt) return fail("RECEIPT_NOT_FOUND", "No receipt has been uploaded.", 404);
  try {
    const format = receipt.mimeType === "image/png" ? "png" : receipt.mimeType === "image/webp" ? "webp" : "jpg";
    const url = cloudinary.utils.private_download_url(receipt.storageKey, format, {
      expires_at: Math.floor(Date.now() / 1000) + 300,
      attachment: false,
    });
    return NextResponse.json({ data: { url, expiresInSeconds: 300, mimeType: receipt.mimeType } });
  } catch (error) {
    console.error("Private payment receipt URL generation failed", error);
    return fail("RECEIPT_ACCESS_FAILED", "Unable to generate secure receipt access.", 503);
  }
}
