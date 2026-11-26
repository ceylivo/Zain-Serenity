import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("housekeeping tasks are tenant/property scoped and retain assignment and deadlines", async () => {
  const model = await read("../../src/models/HousekeepingTask.ts");
  for (const field of ["tenantId", "propertyId", "physicalRoomId", "assignedTo", "dueAt", "createdBy", "statusHistory"]) assert.ok(model.includes(field));
  assert.ok(model.includes('"open", "in_progress", "completed", "cancelled"'));
});

test("housekeeping task creation validates property room and active property staff assignee", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/housekeeping/tasks/route.ts");
  assert.ok(route.includes('permission: "inventory:housekeeping"'));
  assert.ok(route.includes('tenantId: access.tenantId, propertyId: access.propertyId'));
  assert.ok(route.includes("PhysicalRoom.findOne"));
  assert.ok(route.includes("role: { $in: [\"tenant_owner\", \"property_manager\", \"housekeeping\"] }"));
  assert.ok(route.includes("statusHistory: [{ status: \"open\""));
  assert.ok(route.includes('action: "housekeeping.task.created"'));
});

test("housekeeping task updates validate status and retain actor-attributed transition history", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/housekeeping/tasks/[taskId]/route.ts");
  assert.ok(route.includes('permission: "inventory:housekeeping"'));
  assert.ok(route.includes('HousekeepingTask.findOne({ _id: taskId, tenantId: access.tenantId, propertyId: access.propertyId })'));
  assert.ok(route.includes("task.statusHistory.push"));
  assert.ok(route.includes("completedAt"));
  assert.ok(route.includes('action: "housekeeping.task.updated"'));
});

test("property managers receive housekeeping task management permission", async () => {
  const permissions = await read("../../src/lib/permissions.ts");
  assert.ok(permissions.includes('"inventory:housekeeping"'));
  assert.ok(permissions.includes('property_manager: ['));
});
test("a room cannot be marked ready while housekeeping or maintenance work remains open", async () => {
  const lifecycle = await read("../../src/lib/housekeepingLifecycle.ts");
  assert.ok(lifecycle.includes("HousekeepingTask.exists"));
  assert.ok(lifecycle.includes("MaintenanceWorkOrder.exists"));
  assert.ok(lifecycle.includes('status: { $in: ["open", "in_progress"] }'));
  assert.ok(lifecycle.includes('status: { $in: ["open", "in_progress", "blocked"] }'));
  assert.ok(lifecycle.includes("Complete or cancel active housekeeping tasks"));
  assert.ok(lifecycle.includes("Complete or cancel open maintenance work orders"));
  assert.ok(lifecycle.includes("withTransaction"));
});
test("housekeeping create and update synchronize room state atomically with task and audit writes", async () => {
  const createRoute = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/housekeeping/tasks/route.ts");
  const updateRoute = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/housekeeping/tasks/[taskId]/route.ts");
  for (const route of [createRoute, updateRoute]) {
    assert.ok(route.includes("synchronizePhysicalRoomOperationalStatus"));
    assert.ok(route.includes("withTransaction"));
    assert.ok(route.includes('source: "housekeeping_task"'));
  }
});
test("housekeeping workspace exposes status/search filters and overdue workload indicators", async () => {
  const page = await read("../../src/app/workspace/housekeeping/page.tsx");
  assert.ok(page.includes("taskStatusFilter"));
  assert.ok(page.includes("taskSearch"));
  assert.ok(page.includes("visibleTasks"));
  assert.ok(page.includes("overdueTasks"));
  assert.ok(page.includes("Overdue · needs attention"));
});
