import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("room timeline endpoint is authenticated, property scoped and date bounded", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/operations/room-timeline/route.ts");
  assert.ok(route.includes('permission: "inventory:read"'));
  assert.ok(route.includes("tenantId: access.tenantId, propertyId: access.propertyId"));
  assert.ok(route.includes("DATE_RANGE_TOO_LARGE"));
  assert.ok(route.includes("90"));
  assert.ok(route.includes("PhysicalRoom.find"));
});

test("room timeline aggregates overlapping bookings and operational task activity", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/operations/room-timeline/route.ts");
  assert.ok(route.includes('type: "booking"'));
  assert.ok(route.includes('type: "housekeeping"'));
  assert.ok(route.includes('type: "maintenance"'));
  assert.ok(route.includes("statusHistory"));
  assert.ok(route.includes("checkIn: { $lt: end }, checkOut: { $gt: start }"));
  assert.ok(route.includes("allowedRoomIds"));
});

test("room timeline workspace supports property selection, date range and room grouped events", async () => {
  const page = await read("../../src/app/workspace/room-timeline/page.tsx");
  assert.ok(page.includes("/operations/room-timeline"));
  assert.ok(page.includes("Room operations timeline"));
  assert.ok(page.includes('type="date"'));
  assert.ok(page.includes("eventsByRoom"));
  assert.ok(page.includes("Housekeeping"));
  assert.ok(page.includes("Maintenance"));
});
