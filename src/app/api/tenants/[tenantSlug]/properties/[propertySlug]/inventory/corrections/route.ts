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
  const reversalOf = body.reversalOf === undefined ? null : readString(body.reversalOf, { min: 24, max: 24 });
  if (!caseId || !mongoose.isValidObjectId(caseId) || !idempotencyKey || !reason ||
      !Number.isInteger(delta) || Number(delta) === 0 ||
      (body.reversalOf !== undefined && (!reversalOf || !mongoose.isValidObjectId(reversalOf)))) {
    return fail("VALIDATION_ERROR", "A valid case, idempotency key, reason and non-zero integer correction are required", 422);
  }
  await dbConnect();
  const scope = { tenantId: access.tenantId, propertyId: access.propertyId };
  const sessionDb = await mongoose.startSession();
  try {
    let response: Record<string, unknown> | null = null;
    let created = false;
    await sessionDb.withTransaction(async () => {
      const existing = await InventoryCorrection.findOne({ ...scope, idempotencyKey }).session(sessionDb);
      if (existing) {
        response = { id: existing._id.toString(), status: existing.status, duplicate: true };
        return;
      }
      const reviewCase = await InventoryReconciliationCase.findOne({
        _id: caseId, ...scope, status: "resolved",
      }).session(sessionDb);
      if (!reviewCase) throw new Error("REVIEW_REQUIRED");
      if (reversalOf) {
        const originalCorrection = await InventoryCorrection.findOne({
          _id: reversalOf, ...scope, status: "applied", reconciliationCaseId: reviewCase._id,
        }).session(sessionDb);
        if (!originalCorrection || Number(delta) !== -originalCorrection.deltaBlockedRooms) {
          throw new Error("REVERSAL_NOT_ELIGIBLE");
        }
        const priorReversal = await InventoryCorrection.findOne({ ...scope, reversalOf }).session(sessionDb);
        if (priorReversal) throw new Error("REVERSAL_ALREADY_REQUESTED");
      } else {
        const expectedDelta = reviewCase.legacyUntracked > 0
          ? -reviewCase.legacyUntracked
          : reviewCase.overtracked > 0 ? reviewCase.overtracked : 0;
        if (expectedDelta === 0 || Number(delta) !== expectedDelta) throw new Error("CORRECTION_OUT_OF_SCOPE");
      }
      const day = await InventoryDay.findOne({
        ...scope, roomTypeId: reviewCase.roomTypeId, date: reviewCase.date,
      }).select("blockedRooms availableRooms").session(sessionDb).lean();
      if (!day || (!reversalOf && day.blockedRooms !== reviewCase.inventoryBlocked)) throw new Error("SNAPSHOT_STALE");
      const trackedBlocks = await InventoryBlock.find({
        ...scope, roomTypeId: reviewCase.roomTypeId,
        status: { $in: ["active", "partially_released"] },
        startDate: { $lte: reviewCase.date }, endDate: { $gte: reviewCase.date }, remainingQuantity: { $gt: 0 },
      }).select("remainingQuantity").session(sessionDb).lean();
      const trackedBlocked = trackedBlocks.reduce((sum, item) => sum + item.remainingQuantity, 0);
      if (trackedBlocked !== reviewCase.trackedBlocked) throw new Error("SNAPSHOT_STALE");
      const [correction] = await InventoryCorrection.create([{
        ...scope, roomTypeId: reviewCase.roomTypeId, reconciliationCaseId: reviewCase._id,
        date: reviewCase.date, idempotencyKey, deltaBlockedRooms: Number(delta),
        beforeBlockedRooms: day.blockedRooms, beforeAvailableRooms: day.availableRooms,
        reason, status: "pending", requestedBy: new mongoose.Types.ObjectId(session.user.id),
        ...(reversalOf ? { reversalOf: new mongoose.Types.ObjectId(reversalOf) } : {}),
      }], { session: sessionDb });
      await AuditLog.create([{
        ...scope, actorUserId: new mongoose.Types.ObjectId(session.user.id),
        action: "inventory.correction.requested", resourceType: "inventory_correction",
        resourceId: correction._id.toString(), outcome: "success",
        metadata: { reconciliationCaseId: caseId, deltaBlockedRooms: Number(delta), reversalOf, inventoryChanged: false },
      }], { session: sessionDb });
      created = true;
      response = { id: correction._id.toString(), status: correction.status, inventoryChanged: false };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return NextResponse.json({ data: response }, { status: created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "REVIEW_REQUIRED") return fail("REVIEW_REQUIRED", "A resolved reconciliation case is required before requesting a correction", 409);
    if (message === "CORRECTION_OUT_OF_SCOPE") return fail("CORRECTION_OUT_OF_SCOPE", "Correction must exactly reconcile the discrepancy recorded in the reviewed case", 422);
    if (message === "REVERSAL_NOT_ELIGIBLE") return fail("REVERSAL_NOT_ELIGIBLE", "Only an applied correction can be reversed, using its exact inverse quantity", 409);
    if (message === "REVERSAL_ALREADY_REQUESTED") return fail("REVERSAL_ALREADY_REQUESTED", "A reversal request already exists for this correction", 409);
    if (message === "SNAPSHOT_STALE") return fail("SNAPSHOT_STALE", "Inventory no longer matches the reviewed snapshot. Run reconciliation again.", 409);
    if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
      const duplicate = await InventoryCorrection.findOne({ ...scope, idempotencyKey }).lean();
      if (duplicate) return NextResponse.json({ data: { id: duplicate._id.toString(), status: duplicate.status, duplicate: true } });
      if (reversalOf) {
        const priorReversal = await InventoryCorrection.findOne({ ...scope, reversalOf }).lean();
        if (priorReversal) return fail("REVERSAL_ALREADY_REQUESTED", "A reversal request already exists for this correction", 409);
      }
    }
    if (/Transaction numbers are only allowed|replica set|mongos|does not support transactions/i.test(message)) {
      return fail("TRANSACTION_UNAVAILABLE", "Inventory correction requests require MongoDB transaction support", 503);
    }
    console.error("Inventory correction request failed", error);
    return fail("CORRECTION_REQUEST_FAILED", "Unable to create this correction request", 500);
  } finally {
    await sessionDb.endSession();
  }
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
      if (correction.reversalOf) {
        const original = await InventoryCorrection.findOneAndUpdate({
          _id: correction.reversalOf, ...scope, status: "applied",
        }, { $set: { status: "reversed" } }, { new: true, session: sessionDb });
        if (!original) throw new Error("REVERSAL_ORIGINAL_NOT_APPLIED");
      }
      await AuditLog.create([{
        ...scope, actorUserId: new mongoose.Types.ObjectId(session.user.id),
        action: "inventory.correction.applied", resourceType: "inventory_correction",
        resourceId: correctionId, outcome: "success",
        metadata: { deltaBlockedRooms: delta, beforeBlockedRooms: day.blockedRooms,
          afterBlockedRooms: updatedDay.blockedRooms, beforeAvailableRooms: day.availableRooms,
          afterAvailableRooms: updatedDay.availableRooms, approvalNote, reversalOf: correction.reversalOf?.toString() ?? null },
      }], { session: sessionDb });
      response = { id: correctionId, status: "applied", inventoryChanged: true,
        before: { blockedRooms: day.blockedRooms, availableRooms: day.availableRooms },
        after: { blockedRooms: updatedDay.blockedRooms, availableRooms: updatedDay.availableRooms } };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
    return NextResponse.json({ data: response });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "CORRECTION_NOT_PENDING") return fail("CORRECTION_NOT_PENDING", "Correction is already decided or not found", 409);
    if (message === "REVERSAL_ORIGINAL_NOT_APPLIED") return fail("REVERSAL_NOT_ELIGIBLE", "The original correction is no longer eligible for reversal", 409);
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
