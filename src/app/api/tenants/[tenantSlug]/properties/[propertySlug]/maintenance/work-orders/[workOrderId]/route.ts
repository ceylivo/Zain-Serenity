import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import Membership from "@/models/Membership";
import MaintenanceWorkOrder, { MAINTENANCE_PRIORITIES, MAINTENANCE_STATUSES } from "@/models/MaintenanceWorkOrder";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string; workOrderId: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });

export async function PATCH(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug, workOrderId } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:manage" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Maintenance management permission is required", 403);
  if (!mongoose.isValidObjectId(workOrderId)) return fail("INVALID_WORK_ORDER_ID", "A valid work order ID is required", 422);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const status = body.status === undefined ? undefined : readString(body.status, { min: 3, max: 16 });
  const priority = body.priority === undefined ? undefined : readString(body.priority, { min: 3, max: 10 });
  const assignedTo = body.assignedTo === undefined ? undefined : body.assignedTo === "" || body.assignedTo === null ? null : readString(body.assignedTo, { min: 24, max: 24 });
  const dueAt = body.dueAt === undefined ? undefined : body.dueAt === "" || body.dueAt === null ? null : typeof body.dueAt === "string" ? new Date(body.dueAt) : undefined;
  const note = body.note === undefined ? "" : readString(body.note, { max: 500 });
  if ((status !== undefined && (!status || !MAINTENANCE_STATUSES.includes(status as (typeof MAINTENANCE_STATUSES)[number]))) ||
      (priority !== undefined && (!priority || !MAINTENANCE_PRIORITIES.includes(priority as (typeof MAINTENANCE_PRIORITIES)[number]))) ||
      (body.assignedTo !== undefined && assignedTo !== null && (!assignedTo || !mongoose.isValidObjectId(assignedTo))) ||
      (body.dueAt !== undefined && dueAt !== null && (!dueAt || Number.isNaN(dueAt.getTime()))) || note === null) {
    return fail("VALIDATION_ERROR", "Provide valid work order status, priority, assignee, deadline and note", 422);
  }
  if (status === undefined && priority === undefined && body.assignedTo === undefined && body.dueAt === undefined) return fail("EMPTY_UPDATE", "At least one work order field must be updated", 422);
  await dbConnect();
  const order = await MaintenanceWorkOrder.findOne({ _id: workOrderId, tenantId: access.tenantId, propertyId: access.propertyId });
  if (!order) return fail("WORK_ORDER_NOT_FOUND", "Work order was not found in this property", 404);
  if (assignedTo) {
    const member = await Membership.findOne({
      tenantId: access.tenantId, userId: new mongoose.Types.ObjectId(assignedTo), status: "active",
      role: { $in: ["tenant_owner", "property_manager", "housekeeping"] },
      $or: [{ role: "tenant_owner" }, { propertyIds: access.propertyId }],
    }).select("_id").lean();
    if (!member) return fail("INVALID_ASSIGNEE", "Assignee must be an active member assigned to this property", 422);
  }
  const before = { status: order.status, priority: order.priority, assignedTo: order.assignedTo?.toString() ?? null, dueAt: order.dueAt?.toISOString() ?? null };
  let statusChanged = false;
  if (status !== undefined && status !== order.status) { order.status = status as (typeof MAINTENANCE_STATUSES)[number]; statusChanged = true; }
  if (priority !== undefined) order.priority = priority as (typeof MAINTENANCE_PRIORITIES)[number];
  if (body.assignedTo !== undefined) order.assignedTo = assignedTo ? new mongoose.Types.ObjectId(assignedTo) : undefined;
  if (body.dueAt !== undefined) order.dueAt = dueAt ?? undefined;
  order.completedAt = order.status === "completed" ? order.completedAt ?? new Date() : undefined;
  if (statusChanged) order.statusHistory.push({ status: order.status, changedBy: new mongoose.Types.ObjectId(session.user.id), changedAt: new Date(), note: note ?? "" });
  await order.save();
  await AuditLog.create({
    tenantId: access.tenantId, propertyId: access.propertyId,
    actorUserId: new mongoose.Types.ObjectId(session.user.id),
    action: "maintenance.work_order.updated", resourceType: "maintenance_work_order",
    resourceId: order._id.toString(), outcome: "success",
    metadata: { before, after: { status: order.status, priority: order.priority, assignedTo: order.assignedTo?.toString() ?? null, dueAt: order.dueAt?.toISOString() ?? null }, note: note ?? "" },
  });
  return NextResponse.json({ data: order });
}
