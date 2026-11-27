import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import InventoryDay from "@/models/InventoryDay";
import InventoryBlock from "@/models/InventoryBlock";
import InventoryReconciliationCase from "@/models/InventoryReconciliationCase";
import InventoryCorrection from "@/models/InventoryCorrection";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

async function authorize(context: Context, userId: string, permission: "inventory:read" | "inventory:manage" | "inventory:correct_approve") {
  const { tenantSlug, propertySlug } = await context.params;
  return resolveTenantAccess({ userId, tenantSlug, propertySlug, permission });
}

export async function GET(_request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const access = await authorize(context, session.user.id, "inventory:read");
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Inventory read permission is required", 403);
  await dbConnect();
  const items = await InventoryCorrection.find({
    tenantId: access.tenantId, propertyId: access.propertyId,
  }).sort({ createdAt: -1 }).limit(100).lean();
  return NextResponse.json({ data: items.map((item) => ({
    id: item._id.toString(), reconciliationCaseId: item.reconciliationCaseId.toString(),
    roomTypeId: item.roomTypeId.toString(), date: item.date, deltaBlockedRooms: item.deltaBlockedRooms,
    beforeBlockedRooms: item.beforeBlockedRooms, beforeAvailableRooms: item.beforeAvailableRooms,
    afterBlockedRooms: item.afterBlockedRooms ?? null, afterAvailableRooms: item.afterAvailableRooms ?? null,
    reason: item.reason, status: item.status, requestedBy: item.requestedBy.toString(),
    approvedBy: item.approvedBy?.toString() ?? null, approvalNote: item.approvalNote ?? null,
    appliedAt: item.appliedAt ?? null, reversalOf: item.reversalOf?.toString() ?? null,
    createdAt: item.createdAt,
  })) });
}

/** Create a pending correction request. This endpoint never changes inventory. */
export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const access = await authorize(context, session.user.id, "inventory:manage");
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Inventory management permission is required", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const caseId = readString(body.caseId, { min: 24, max: 24 });
  const idempotencyKey = readString(body.idempotencyKey, { min: 8, max: 128 });
  const reason = readString(body.reason, { min: 3, max: 500 });
  const delta = body.deltaBlockedRooms;
  if (!caseId || !mongoose.isValidObjectId(caseId) || !idempotencyKey || !reason ||
      !Number.isInteger(delta) || Number(delta) === 0) {
    return fail("VALIDATION_ERROR", "A valid case, idempotency key, reason and non-zero integer correction are required", 422);
  }
  await dbConnect();
  const scope = { tenantId: access.tenantId, propertyId: access.propertyId };
  const existing = await InventoryCorrection.findOne({ ...scope, idempotencyKey }).lean();
  if (existing) return NextResponse.json({ data: { id: existing._id.toString(), status: existing.status, duplicate: true } });
  const reviewCase = await InventoryReconciliationCase.findOne({
    _id: caseId, ...scope, status: "resolved",
  }).lean();
  if (!reviewCase) return fail("REVIEW_REQUIRED", "A resolved reconciliation case is required before requesting a correction", 409);
  const expectedDelta = reviewCase.legacyUntracked > 0
    ? -reviewCase.legacyUntracked
    : reviewCase.overtracked > 0 ? reviewCase.overtracked : 0;
  if (expectedDelta === 0 || Number(delta) !== expectedDelta) {
    return fail("CORRECTION_OUT_OF_SCOPE", "Correction must exactly reconcile the discrepancy recorded in the reviewed case", 422);
  }
  const day = await InventoryDay.findOne({
    ...scope, roomTypeId: reviewCase.roomTypeId, date: reviewCase.date,
  }).select("blockedRooms availableRooms").lean();
  if (!day || day.blockedRooms !== reviewCase.inventoryBlocked) {
    return fail("SNAPSHOT_STALE", "Inventory no longer matches the reviewed snapshot. Run reconciliation again.", 409);
  }
  const trackedBlocks = await InventoryBlock.find({
    ...scope, roomTypeId: reviewCase.roomTypeId,
    status: { $in: ["active", "partially_released"] },
    startDate: { $lte: reviewCase.date }, endDate: { $gte: reviewCase.date }, remainingQuantity: { $gt: 0 },
  }).select("remainingQuantity").lean();
  const trackedBlocked = trackedBlocks.reduce((sum, item) => sum + item.remainingQuantity, 0);
  if (trackedBlocked !== reviewCase.trackedBlocked) return fail("SNAPSHOT_STALE", "Tracked block history changed after review. Run reconciliation again.", 409);
  const correction = await InventoryCorrection.create({
    ...scope, roomTypeId: reviewCase.roomTypeId, reconciliationCaseId: reviewCase._id,
    date: reviewCase.date, idempotencyKey, deltaBlockedRooms: Number(delta),
    beforeBlockedRooms: day.blockedRooms, beforeAvailableRooms: day.availableRooms,
    reason, status: "pending", requestedBy: new mongoose.Types.ObjectId(session.user.id),
  });
  await AuditLog.create({
    ...scope, actorUserId: new mongoose.Types.ObjectId(session.user.id),
    action: "inventory.correction.requested", resourceType: "inventory_correction",
    resourceId: correction._id.toString(), outcome: "success",
    metadata: { reconciliationCaseId: caseId, deltaBlockedRooms: Number(delta), inventoryChanged: false },
  });
  return NextResponse.json({ data: { id: correction._id.toString(), status: correction.status, inventoryChanged: false } }, { status: 201 });
}

/** Only a tenant owner can approve/reject; approval applies the correction atomically. */
export async function PATCH(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const access = await authorize(context, session.user.id, "inventory:correct_approve");
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Tenant-owner correction approval permission is required", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const correctionId = readString(body.correctionId, { min: 24, max: 24 });
  const decision = body.decision;
  const approvalNote = readString(body.approvalNote, { min: 3, max: 500 });
  if (!correctionId || !mongoose.isValidObjectId(correctionId) ||
      (decision !== "approve" && decision !== "reject") || !approvalNote) {
    return fail("VALIDATION_ERROR", "A valid correction ID, decision and approval note are required", 422);
  }
  await dbConnect();
  const scope = { tenantId: access.tenantId, propertyId: access.propertyId };
  const sessionDb = await mongoose.startSession();
  try {
    let response: Record<string, unknown> | null = null;
    await sessionDb.withTransaction(async () => {
      const correction = await InventoryCorrection.findOne({
        _id: correctionId, ...scope, status: "pending",
      }).session(sessionDb);
      if (!correction) throw new Error("CORRECTION_NOT_PENDING");
      if (correction.requestedBy.toString() === session.user.id) throw new Error("INDEPENDENT_APPROVAL_REQUIRED");
      if (decision === "reject") {
        correction.status = "rejected";
        correction.approvedBy = new mongoose.Types.ObjectId(session.user.id);
        correction.approvalNote = approvalNote;
        correction.rejectedAt = new Date();
        await correction.save({ session: sessionDb });
        await AuditLog.create([{
          ...scope, actorUserId: new mongoose.Types.ObjectId(session.user.id),
          action: "inventory.correction.rejected", resourceType: "inventory_correction",
          resourceId: correctionId, outcome: "success",
          metadata: { approvalNote, inventoryChanged: false },
        }], { session: sessionDb });
        response = { id: correctionId, status: "rejected", inventoryChanged: false };
        return;
      }

      const day = await InventoryDay.findOne({
        ...scope, roomTypeId: correction.roomTypeId, date: correction.date,
        blockedRooms: correction.beforeBlockedRooms, availableRooms: correction.beforeAvailableRooms,
      }).session(sessionDb);
      if (!day) throw new Error("CORRECTION_SNAPSHOT_STALE");
      const blocks = await InventoryBlock.find({
        ...scope, roomTypeId: correction.roomTypeId,
        status: { $in: ["active", "partially_released"] },
        startDate: { $lte: correction.date }, endDate: { $gte: correction.date }, remainingQuantity: { $gt: 0 },
      }).select("remainingQuantity").session(sessionDb).lean();
      const trackedNow = blocks.reduce((sum, item) => sum + item.remainingQuantity, 0);
      const reviewCase = await InventoryReconciliationCase.findOne({
        _id: correction.reconciliationCaseId, ...scope, status: "resolved",
      }).session(sessionDb);
      if (!reviewCase || trackedNow !== reviewCase.trackedBlocked) throw new Error("CORRECTION_SNAPSHOT_STALE");
      const delta = correction.deltaBlockedRooms;
      if (day.blockedRooms + delta < 0 || day.availableRooms - delta < 0) throw new Error("CORRECTION_WOULD_OVERDRAW");
      const updatedDay = await InventoryDay.findOneAndUpdate({
        _id: day._id, ...scope, blockedRooms: correction.beforeBlockedRooms,
        availableRooms: correction.beforeAvailableRooms,
      }, { $inc: { blockedRooms: delta, availableRooms: -delta } }, { new: true, session: sessionDb });
      if (!updatedDay) throw new Error("CORRECTION_SNAPSHOT_STALE");
      correction.status = "applied";
      correction.approvedBy = new mongoose.Types.ObjectId(session.user.id);
      correction.approvalNote = approvalNote;
      correction.appliedAt = new Date();
      correction.afterBlockedRooms = updatedDay.blockedRooms;
      correction.afterAvailableRooms = updatedDay.availableRooms;
      await correction.save({ session: sessionDb });
      await AuditLog.create([{
        ...scope, actorUserId: new mongoose.Types.ObjectId(session.user.id),
        action: "inventory.correction.applied", resourceType: "inventory_correction",
        resourceId: correctionId, outcome: "success",
        metadata: { deltaBlockedRooms: delta, beforeBlockedRooms: day.blockedRooms,
          afterBlockedRooms: updatedDay.blockedRooms, beforeAvailableRooms: day.availableRooms,
          afterAvailableRooms: updatedDay.availableRooms, approvalNote },
      }], { session: sessionDb });
      response = { id: correctionId, status: "applied", inventoryChanged: true,
        before: { blockedRooms: day.blockedRooms, availableRooms: day.availableRooms },
        after: { blockedRooms: updatedDay.blockedRooms, availableRooms: updatedDay.availableRooms } };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return NextResponse.json({ data: response });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "CORRECTION_NOT_PENDING") return fail("CORRECTION_NOT_PENDING", "Correction is already decided or not found", 409);
    if (message === "INDEPENDENT_APPROVAL_REQUIRED") return fail("INDEPENDENT_APPROVAL_REQUIRED", "The correction requester cannot approve or reject their own request", 403);
    if (message === "CORRECTION_SNAPSHOT_STALE") return fail("SNAPSHOT_STALE", "Inventory or tracked block history changed after the correction request. Reconcile again.", 409);
    if (message === "CORRECTION_WOULD_OVERDRAW") return fail("INVALID_CORRECTION", "Correction would make blocked or available inventory negative", 409);
    if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) return fail("TRANSACTION_UNAVAILABLE", "Inventory correction approval requires MongoDB transaction support", 503);
    console.error("Inventory correction decision failed", error);
    return fail("CORRECTION_FAILED", "Unable to process this correction", 500);
  } finally {
    await sessionDb.endSession();
  }
}
