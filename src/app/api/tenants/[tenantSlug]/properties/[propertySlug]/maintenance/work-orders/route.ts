import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import PhysicalRoom from "@/models/PhysicalRoom";
import Membership from "@/models/Membership";
import MaintenanceWorkOrder, { MAINTENANCE_PRIORITIES } from "@/models/MaintenanceWorkOrder";
import AuditLog from "@/models/AuditLog";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status });

async function validAssignee(userId: string, tenantId: mongoose.Types.ObjectId, propertyId: mongoose.Types.ObjectId) {
  if (!mongoose.isValidObjectId(userId)) return false;
  const member = await Membership.findOne({
    tenantId, userId: new mongoose.Types.ObjectId(userId), status: "active",
    role: { $in: ["tenant_owner", "property_manager", "housekeeping"] },
    $or: [{ role: "tenant_owner" }, { propertyIds: propertyId }],
  }).select("_id").lean();
  return Boolean(member);
}

export async function GET(_request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:read" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Maintenance access denied", 403);
  await dbConnect();
  const orders = await MaintenanceWorkOrder.find({ tenantId: access.tenantId, propertyId: access.propertyId })
    .sort({ dueAt: 1, createdAt: -1 }).limit(200).lean();
  return NextResponse.json({ data: orders.map((order) => ({
    id: order._id.toString(), physicalRoomId: order.physicalRoomId?.toString() ?? null,
    title: order.title, description: order.description, priority: order.priority, status: order.status,
    dueAt: order.dueAt ?? null, assignedTo: order.assignedTo?.toString() ?? null,
    createdBy: order.createdBy.toString(), completedAt: order.completedAt ?? null,
    statusHistory: (order.statusHistory ?? []).map((entry) => ({ status: entry.status, changedBy: entry.changedBy.toString(), changedAt: entry.changedAt, note: entry.note ?? "" })),
    createdAt: order.createdAt, updatedAt: order.updatedAt,
  })) });
}

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:manage" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Maintenance management permission is required", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const title = readString(body.title, { min: 3, max: 120 });
  const description = body.description === undefined ? "" : readString(body.description, { max: 2000 });
  const physicalRoomId = body.physicalRoomId === undefined || body.physicalRoomId === "" ? undefined : readString(body.physicalRoomId, { min: 24, max: 24 });
  const assignedTo = body.assignedTo === undefined || body.assignedTo === "" ? undefined : readString(body.assignedTo, { min: 24, max: 24 });
  const priority = body.priority === undefined ? "normal" : readString(body.priority, { min: 3, max: 10 });
  const dueAt = body.dueAt === undefined || body.dueAt === "" ? undefined : typeof body.dueAt === "string" ? new Date(body.dueAt) : null;
  if (!title || description === null || (physicalRoomId && !mongoose.isValidObjectId(physicalRoomId)) ||
      (assignedTo && !mongoose.isValidObjectId(assignedTo)) || !priority || !MAINTENANCE_PRIORITIES.includes(priority as (typeof MAINTENANCE_PRIORITIES)[number]) ||
      (dueAt !== undefined && (dueAt === null || Number.isNaN(dueAt.getTime())))) {
    return fail("VALIDATION_ERROR", "Provide a title, valid priority and optional room, assignee and deadline", 422);
  }
  await dbConnect();
  if (physicalRoomId) {
    const room = await PhysicalRoom.findOne({ _id: physicalRoomId, tenantId: access.tenantId, propertyId: access.propertyId }).select("_id").lean();
    if (!room) return fail("ROOM_NOT_FOUND", "Physical room does not belong to this property", 404);
  }
  if (assignedTo && !(await validAssignee(assignedTo, access.tenantId, access.propertyId))) {
    return fail("INVALID_ASSIGNEE", "Assignee must be an active owner, property manager or housekeeping member assigned to this property", 422);
  }
  const order = await MaintenanceWorkOrder.create({
    tenantId: access.tenantId, propertyId: access.propertyId,
    physicalRoomId: physicalRoomId ? new mongoose.Types.ObjectId(physicalRoomId) : undefined,
    title, description: description ?? "", priority, dueAt,
    assignedTo: assignedTo ? new mongoose.Types.ObjectId(assignedTo) : undefined,
    createdBy: new mongoose.Types.ObjectId(session.user.id),
    statusHistory: [{ status: "open", changedBy: new mongoose.Types.ObjectId(session.user.id), changedAt: new Date(), note: "Work order created" }],
  });
  await AuditLog.create({
    tenantId: access.tenantId, propertyId: access.propertyId,
    actorUserId: new mongoose.Types.ObjectId(session.user.id),
    action: "maintenance.work_order.created", resourceType: "maintenance_work_order",
    resourceId: order._id.toString(), outcome: "success",
    metadata: { physicalRoomId: physicalRoomId ?? null, priority, assignedTo: assignedTo ?? null, dueAt: dueAt?.toISOString() ?? null },
  });
  return NextResponse.json({ data: order }, { status: 201 });
}
