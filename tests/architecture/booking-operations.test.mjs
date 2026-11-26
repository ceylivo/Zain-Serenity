import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("booking operations API keeps check-in and checkout tenant scoped and permission guarded", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/[bookingId]/stay/route.ts");
  assert.ok(route.includes('permission: "booking:update"'));
  assert.ok(route.includes("transitionBookingStay"));
  assert.ok(route.includes('"check_in"') && route.includes('"check_out"'));
});

test("stay lifecycle requires a room assignment and transitions room status atomically", async () => {
  const lifecycle = await read("../../src/lib/bookingLifecycle.ts");
  assert.ok(lifecycle.includes("Assign a physical room before check-in or check-out."));
  assert.ok(lifecycle.includes('status: "ready"'));
  assert.ok(lifecycle.includes('status: "occupied"'));
  assert.ok(lifecycle.includes('status: "cleaning"'));
  assert.ok(lifecycle.includes('input.action === "confirm" ? "booking.confirmed"'));
  assert.ok(lifecycle.includes('input.action === "check_in" ? "booking.checked_in" : "booking.checked_out"'));
});

test("housekeeping uses a dedicated tenant permission and prevents making in-house rooms ready", async () => {
  const permissions = await read("../../src/lib/permissions.ts");
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/physical-rooms/[roomId]/route.ts");
  const lifecycle = await read("../../src/lib/housekeepingLifecycle.ts");
  assert.ok(permissions.includes('"inventory:housekeeping"'));
  assert.ok(route.includes('permission: "inventory:housekeeping"'));
  assert.ok(lifecycle.includes('["checked_in"]'));
  assert.ok(lifecycle.includes('status: { $in: statuses }'));
  assert.ok(lifecycle.includes("cannot be marked ready."));
  assert.ok(lifecycle.includes("cannot be marked unavailable."));
});

test("booking and housekeeping workspaces use tenant/property scoped endpoints", async () => {
  const bookings = await read("../../src/app/workspace/bookings/page.tsx");
  const housekeeping = await read("../../src/app/workspace/housekeeping/page.tsx");
  assert.ok(bookings.includes("/assign-room") && bookings.includes("/stay"));
  assert.ok(bookings.includes("/api/tenants/"));
  assert.ok(housekeeping.includes("/physical-rooms"));
  assert.ok(housekeeping.includes("method: \"PATCH\""));
});

test("booking operations support room reassignment and unassignment through tenant scoped lifecycle", async () => {
  const lifecycle = await read("../../src/lib/bookingLifecycle.ts");
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/[bookingId]/assign-room/route.ts");
  const page = await read("../../src/app/workspace/bookings/page.tsx");
  assert.ok(lifecycle.includes("export async function unassignPhysicalRoom"));
  assert.ok(lifecycle.includes("previousPhysicalRoomId"));
  assert.ok(route.includes('action !== "assign" && action !== "unassign"'));
  assert.ok(page.includes('act(booking,"unassign")'));
  assert.ok(page.includes("Reassign room"));
});

test("booking list supports tenant-scoped status, date and exact reference filters with pagination", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/route.ts");
  assert.ok(route.includes('url.searchParams.get("status")'));
  assert.ok(route.includes('url.searchParams.get("checkInFrom")'));
  assert.ok(route.includes('url.searchParams.get("checkInTo")'));
  assert.ok(route.includes('url.searchParams.get("search")'));
  assert.ok(route.includes("INVALID_FILTER"));
  assert.ok(route.includes("skip((page - 1) * limit)"));
  assert.ok(route.includes("countDocuments(filter)"));
  assert.ok(route.includes("if (!canReadAll) filter.userId = session.user.id"));
});
