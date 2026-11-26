import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import Membership from "@/models/Membership";
import HousekeepingTask, { HOUSEKEEPING_TASK_STATUSES } from "@/models/HousekeepingTask";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string; taskId: string }> };
const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

export async function PATCH(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug, taskId } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:housekeeping" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Housekeeping task management permission is required", 403);
  if (!mongoose.isValidObjectId(taskId)) return fail("INVALID_TASK_ID", "A valid task ID is required", 422);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const allowed = ["open", "in_progress", "completed", "cancelled"];
  const status = body.status === undefined ? undefined : readString(body.status, { min: 4, max: 16 });
  const assignedTo = body.assignedTo === undefined ? undefined : body.assignedTo === "" || body.assignedTo === null ? null : readString(body.assignedTo, { min: 24, max: 24 });
  const dueAt = body.dueAt === undefined ? undefined : body.dueAt === "" || body.dueAt === null ? null : typeof body.dueAt === "string" ? new Date(body.dueAt) : undefined;
  if ((status !== undefined && (!status || !allowed.includes(status))) ||
      (body.assignedTo !== undefined && assignedTo !== null && (!assignedTo || !mongoose.isValidObjectId(assignedTo))) ||
      (body.dueAt !== undefined && dueAt !== null && (!dueAt || Number.isNaN(dueAt.getTime())))) {
    return fail("VALIDATION_ERROR", "Provide a valid task status, assignee or deadline", 422);
  }
  if (status === undefined && body.assignedTo === undefined && body.dueAt === undefined) {
    return fail("EMPTY_UPDATE", "At least one task field must be updated", 422);
  }
  await dbConnect();
  const task = await HousekeepingTask.findOne({ _id: taskId, tenantId: access.tenantId, propertyId: access.propertyId });
  if (!task) return fail("TASK_NOT_FOUND", "Housekeeping task was not found in this property", 404);
  if (assignedTo) {
    const member = await Membership.findOne({
      tenantId: access.tenantId, userId: new mongoose.Types.ObjectId(assignedTo), status: "active",
      role: { $in: ["tenant_owner", "property_manager", "housekeeping"] },
      $or: [{ role: "tenant_owner" }, { propertyIds: access.propertyId }],
    }).select("_id").lean();
    if (!member) return fail("INVALID_ASSIGNEE", "Assignee must be an active member assigned to this property", 422);
  }
  const before = { status: task.status, assignedTo: task.assignedTo?.toString() ?? null, dueAt: task.dueAt?.toISOString() ?? null };
  if (status !== undefined) task.status = status as (typeof HOUSEKEEPING_TASK_STATUSES)[number];
  if (body.assignedTo !== undefined) task.assignedTo = assignedTo ? new mongoose.Types.ObjectId(assignedTo) : undefined;
  if (body.dueAt !== undefined) task.dueAt = dueAt ?? undefined;
  task.completedAt = task.status === "completed" ? task.completedAt ?? new Date() : undefined;
  await task.save();
  await AuditLog.create({
    tenantId: access.tenantId, propertyId: access.propertyId,
    actorUserId: new mongoose.Types.ObjectId(session.user.id),
    action: "housekeeping.task.updated", resourceType: "housekeeping_task",
    resourceId: task._id.toString(), outcome: "success",
    metadata: { before, after: { status: task.status, assignedTo: task.assignedTo?.toString() ?? null, dueAt: task.dueAt?.toISOString() ?? null } },
  });
  return NextResponse.json({ data: task });
}
