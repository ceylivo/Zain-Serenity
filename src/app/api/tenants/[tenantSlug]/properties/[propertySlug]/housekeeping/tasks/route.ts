import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { resolveTenantAccess } from "@/lib/tenantAccess";
import { isRecord, readString } from "@/lib/inputValidation";
import dbConnect from "@/lib/dbConnect";
import PhysicalRoom from "@/models/PhysicalRoom";
import Membership from "@/models/Membership";
import HousekeepingTask from "@/models/HousekeepingTask";
import AuditLog from "@/models/AuditLog";
import { synchronizePhysicalRoomOperationalStatus } from "@/lib/roomOperationalSync";

export const runtime = "nodejs";
type Context = { params: Promise<{ tenantSlug: string; propertySlug: string }> };
const fail = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status });

function parseDueAt(value: unknown): Date | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

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
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Housekeeping task access denied", 403);
  await dbConnect();
  const tasks = await HousekeepingTask.find({ tenantId: access.tenantId, propertyId: access.propertyId })
    .sort({ dueAt: 1, createdAt: -1 }).limit(200).lean();
  return NextResponse.json({ data: tasks.map((task) => ({
    id: task._id.toString(), physicalRoomId: task.physicalRoomId.toString(),
    title: task.title, description: task.description, status: task.status,
    assignedTo: task.assignedTo?.toString() ?? null, dueAt: task.dueAt ?? null,
    createdBy: task.createdBy.toString(), completedAt: task.completedAt ?? null,
    statusHistory: task.statusHistory.map((entry) => ({ status: entry.status, changedBy: entry.changedBy.toString(), changedAt: entry.changedAt })),
    createdAt: task.createdAt, updatedAt: task.updatedAt,
  })) });
}

export async function POST(request: Request, context: Context) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !mongoose.isValidObjectId(session.user.id)) return fail("UNAUTHENTICATED", "Authentication required", 401);
  const { tenantSlug, propertySlug } = await context.params;
  const access = await resolveTenantAccess({ userId: session.user.id, tenantSlug, propertySlug, permission: "inventory:housekeeping" });
  if (!access.ok || !access.propertyId) return fail("FORBIDDEN", "Housekeeping task management permission is required", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("INVALID_JSON", "Request body must be valid JSON", 400); }
  if (!isRecord(body)) return fail("VALIDATION_ERROR", "A JSON object is required", 422);
  const physicalRoomId = readString(body.physicalRoomId, { min: 24, max: 24 });
  const title = readString(body.title, { min: 3, max: 120 });
  const description = body.description === undefined ? "" : readString(body.description, { max: 2000 });
  const assignedTo = body.assignedTo === undefined || body.assignedTo === "" ? undefined : readString(body.assignedTo, { min: 24, max: 24 });
  const dueAt = parseDueAt(body.dueAt);
  if (!physicalRoomId || !mongoose.isValidObjectId(physicalRoomId) || !title || description === null ||
      (body.assignedTo !== undefined && body.assignedTo !== "" && (!assignedTo || !mongoose.isValidObjectId(assignedTo))) || dueAt === null) {
    return fail("VALIDATION_ERROR", "Provide a valid room, task title, optional assignee and valid deadline", 422);
  }
  await dbConnect();
  const room = await PhysicalRoom.findOne({ _id: physicalRoomId, tenantId: access.tenantId, propertyId: access.propertyId }).select("_id").lean();
  if (!room) return fail("ROOM_NOT_FOUND", "Physical room does not belong to this property", 404);
  if (assignedTo && !(await validAssignee(assignedTo, access.tenantId, access.propertyId))) {
    return fail("INVALID_ASSIGNEE", "Assignee must be an active owner, property manager or housekeeping member assigned to this property", 422);
  }
  if (!room._id) return fail("ROOM_NOT_FOUND", "Physical room was not found in this property", 404);
  const sessionDb = await mongoose.startSession();
  let createdTask: Record<string, unknown> | null = null;
  try {
    await sessionDb.withTransaction(async () => {
      const [task] = await HousekeepingTask.create([{
        tenantId: access.tenantId, propertyId: access.propertyId as mongoose.Types.ObjectId, physicalRoomId: room._id,
        title, description: description ?? "", assignedTo: assignedTo ? new mongoose.Types.ObjectId(assignedTo) : undefined,
        dueAt, createdBy: new mongoose.Types.ObjectId(session.user.id),
        statusHistory: [{ status: "open", changedBy: new mongoose.Types.ObjectId(session.user.id), changedAt: new Date() }],
      }], { session: sessionDb });
      await synchronizePhysicalRoomOperationalStatus({
        tenantId: access.tenantId, propertyId: access.propertyId as mongoose.Types.ObjectId,
        physicalRoomId: room._id, actorUserId: new mongoose.Types.ObjectId(session.user.id),
        session: sessionDb, source: "housekeeping_task",
      });
      await AuditLog.create([{
        tenantId: access.tenantId, propertyId: access.propertyId as mongoose.Types.ObjectId,
        actorUserId: new mongoose.Types.ObjectId(session.user.id),
        action: "housekeeping.task.created", resourceType: "housekeeping_task",
        resourceId: task._id.toString(), outcome: "success",
        metadata: { physicalRoomId, assignedTo: assignedTo ?? null, dueAt: dueAt?.toISOString() ?? null },
      }], { session: sessionDb });
      createdTask = task.toObject() as unknown as Record<string, unknown>;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" });
  } catch (error) {
    console.error("Housekeeping task creation failed", error);
    return fail("TASK_CREATE_FAILED", "Unable to create the task and update room state atomically. Refresh and retry.", 503);
  } finally {
    await sessionDb.endSession();
  }
  return NextResponse.json({ data: createdTask }, { status: 201 });
}
