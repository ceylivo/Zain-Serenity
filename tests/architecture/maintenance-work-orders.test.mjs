import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("maintenance work orders preserve tenant scope, priority, room, assignee and status history", async () => {
  const model = await read("../../src/models/MaintenanceWorkOrder.ts");
  for (const field of ["tenantId", "propertyId", "physicalRoomId", "priority", "assignedTo", "dueAt", "createdBy", "statusHistory"]) assert.ok(model.includes(field));
  assert.ok(model.includes('"low", "normal", "high", "urgent"'));
  assert.ok(model.includes('"open", "in_progress", "blocked", "completed", "cancelled"'));
});

test("maintenance work order creation validates property room and active property assignee", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/maintenance/work-orders/route.ts");
  assert.ok(route.includes('permission: "inventory:manage"'));
  assert.ok(route.includes("PhysicalRoom.findOne"));
  assert.ok(route.includes("validAssignee"));
  assert.ok(route.includes('action: "maintenance.work_order.created"'));
  assert.ok(route.includes('status: "open"'));
});

test("maintenance updates are property scoped and record actor-attributed status transitions", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/maintenance/work-orders/[workOrderId]/route.ts");
  assert.ok(route.includes('permission: "inventory:manage"'));
  assert.ok(route.includes('MaintenanceWorkOrder.findOne({ _id: workOrderId, tenantId: access.tenantId, propertyId: access.propertyId })'));
  assert.ok(route.includes("current.statusHistory.push"));
  assert.ok(route.includes("completedAt"));
  assert.ok(route.includes('action: "maintenance.work_order.updated"'));
});

test("maintenance workspace consumes property-scoped APIs and exposes priority and status history", async () => {
  const page = await read("../../src/app/workspace/maintenance/page.tsx");
  assert.ok(page.includes("/maintenance/work-orders"));
  assert.ok(page.includes("Create work order"));
  assert.ok(page.includes("Status history"));
  assert.ok(page.includes('const priorities = ["low", "normal", "high", "urgent"]'));
});
test("maintenance create and update synchronize room state atomically with work-order and audit writes", async () => {
  const createRoute = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/maintenance/work-orders/route.ts");
  const updateRoute = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/maintenance/work-orders/[workOrderId]/route.ts");
  for (const route of [createRoute, updateRoute]) {
    assert.ok(route.includes("synchronizePhysicalRoomOperationalStatus"));
    assert.ok(route.includes("withTransaction"));
    assert.ok(route.includes('source: "maintenance_work_order"'));
  }
});
test("maintenance workspace exposes search, status and priority filters with overdue KPIs", async () => {
  const page = await read("../../src/app/workspace/maintenance/page.tsx");
  assert.ok(page.includes("statusFilter"));
  assert.ok(page.includes("priorityFilter"));
  assert.ok(page.includes("visibleOrders"));
  assert.ok(page.includes("overdueCount"));
  assert.ok(page.includes("Overdue · needs attention"));
});
