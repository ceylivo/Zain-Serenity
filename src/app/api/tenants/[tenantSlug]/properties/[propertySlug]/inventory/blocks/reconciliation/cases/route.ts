import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import InventoryReconciliationCase from "@/models/InventoryReconciliationCase";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

async function authorized(request: Request, context: Context, permission: "inventory:read" | "inventory:manage") {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) {
    return { response: fail("UNAUTHENTICATED", "Authentication required", 401) } as const;
  }
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({
    userId: session.user.id, tenantSlug, propertySlug, permission,
  });
  if (!access.ok || !access.propertyId) {
    return { response: fail("FORBIDDEN", "Inventory review permission is required", 403) } as const;
  }
  return { session, access } as const;
}

export async function GET(request: Request, context: Context) {
  const auth = await authorized(request, context, "inventory:read");
  if ("response" in auth) return auth.response;
  await dbConnect();
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const filter: Record<string, unknown> = {
    tenantId: auth.access.tenantId, propertyId: auth.access.propertyId,
  };
  if (status && ["open", "resolved", "dismissed"].includes(status)) filter.status = status;
  const cases = await InventoryReconciliationCase.find(filter)
    .sort({ createdAt: -1 }).limit(100).lean();
  return NextResponse.json({ data: cases.map((item) => ({
    id: item._id.toString(), roomTypeId: item.roomTypeId.toString(), date: item.date,
    inventoryBlocked: item.inventoryBlocked, trackedBlocked: item.trackedBlocked,
    legacyUntracked: item.legacyUntracked, overtracked: item.overtracked,
    reason: item.reason, status: item.status, createdAt: item.createdAt,
    createdBy: item.createdBy.toString(), reviewedBy: item.reviewedBy?.toString() ?? null,
    reviewedAt: item.reviewedAt ?? null, resolutionNote: item.resolutionNote ?? null,
  })) });
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorized(request, context, "inventory:manage");
  if ("response" in auth) return auth.response;
  let body: unknown;
  try { body = await request.json(); } catch {
    return fail("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const caseId = readString(body.caseId, { min: 24, max: 24 });
  const status = body.status;
  const resolutionNote = readString(body.resolutionNote, { min: 3, max: 500 });
  if (!caseId || !mongoose.isValidObjectId(caseId) ||
      (status !== "resolved" && status !== "dismissed") || !resolutionNote) {
    return fail("VALIDATION_ERROR", "A valid case ID, resolved/dismissed status and resolution note are required", 422);
  }
  await dbConnect();
  const sessionDb = await mongoose.startSession();
  try {
    let updated: Record<string, unknown> | null = null;
    await sessionDb.withTransaction(async () => {
      const existingCase = await InventoryReconciliationCase.findOne({
        _id: caseId, tenantId: auth.access.tenantId, propertyId: auth.access.propertyId, status: "open",
      }).session(sessionDb);
      if (!existingCase) throw new Error("CASE_NOT_OPEN_OR_NOT_FOUND");
      if (existingCase.createdBy.toString() === auth.session.user.id) {
        throw new Error("CASE_CREATOR_CANNOT_REVIEW");
      }

      const item = await InventoryReconciliationCase.findOneAndUpdate(
        { _id: caseId, tenantId: auth.access.tenantId, propertyId: auth.access.propertyId, status: "open" },
        { $set: {
          status, resolutionNote,
          reviewedBy: new mongoose.Types.ObjectId(auth.session.user.id),
          reviewedAt: new Date(),
        } },
        { new: true, session: sessionDb, runValidators: true }
      );
      if (!item) throw new Error("CASE_NOT_OPEN_OR_NOT_FOUND");
      updated = { id: item._id.toString(), status: item.status, reviewedAt: item.reviewedAt };
      await AuditLog.create([{
        tenantId: auth.access.tenantId, propertyId: auth.access.propertyId,
        actorUserId: new mongoose.Types.ObjectId(auth.session.user.id),
        action: status === "resolved" ? "inventory.reconciliation_case.resolved" : "inventory.reconciliation_case.dismissed",
        resourceType: "inventory_reconciliation_case", resourceId: caseId, outcome: "success",
        metadata: { resolutionNote, inventoryChanged: false },
      }], { session: sessionDb });
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return NextResponse.json({ data: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "CASE_NOT_OPEN_OR_NOT_FOUND") return fail("CASE_NOT_OPEN", "Review case is already closed or not found in this property", 409);
    if (message === "CASE_CREATOR_CANNOT_REVIEW") return fail("INDEPENDENT_REVIEW_REQUIRED", "The person who opened this reconciliation case cannot resolve or dismiss it. A different authorized reviewer is required.", 403);
    if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) {
      return fail("TRANSACTION_UNAVAILABLE", "Review changes require MongoDB transaction support", 503);
    }
    console.error("Inventory reconciliation case update failed", error);
    return fail("REVIEW_UPDATE_FAILED", "Unable to update this review case", 500);
  } finally {
    await sessionDb.endSession();
  }
}
