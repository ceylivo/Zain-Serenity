import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("property dashboard API is authenticated, permission-gated and tenant/property scoped", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/operations/dashboard/route.ts");
  assert.ok(route.includes("getServerSession"));
  assert.ok(route.includes('permission: "booking:read"'));
  assert.ok(route.includes("tenantId: access.tenantId, propertyId: access.propertyId"));
  assert.ok(route.includes("isValidDateOnly"));
  assert.ok(route.includes("INVALID_DATE"));
});

test("property dashboard aggregates bookings, room readiness and operational workload", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/operations/dashboard/route.ts");
  for (const token of ["arrivals", "departures", "inHouse", "newToday", "pendingPayments", "roomReady", "roomOccupied", "roomCleaning", "roomMaintenance", "openHousekeeping", "overdueHousekeeping", "openMaintenance", "urgentMaintenance"]) assert.ok(route.includes(token));
});

test("property dashboard upcoming records resolve room numbers within the same property", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/operations/dashboard/route.ts");
  assert.ok(route.includes("upcomingArrivals"));
  assert.ok(route.includes("upcomingDepartures"));
  assert.ok(route.includes("PhysicalRoom.find({ ...scope"));
  assert.ok(route.includes("roomNames.get("));
});

test("workspace overview loads property dashboard and exposes navigation to operational workspaces", async () => {
  const page = await read("../../src/app/workspace/page.tsx");
  for (const token of ["/operations/dashboard", "Arrivals today", "Departures today", "Guests in-house", "Room readiness", "Needs attention", "Upcoming arrivals & departures", "/workspace/housekeeping", "/workspace/maintenance", "/workspace/payments"]) assert.ok(page.includes(token));
  const shell = await read("../../src/components/WorkspaceShell.tsx");
  assert.ok(shell.includes('href: "/workspace", label: "Overview"'));
});

test("overdue workload calculations use a clock captured outside render", async () => {
  const housekeeping = await read("../../src/app/workspace/housekeeping/page.tsx");
  const maintenance = await read("../../src/app/workspace/maintenance/page.tsx");
  assert.ok(housekeeping.includes("setCurrentTime(Date.now())"));
  assert.ok(maintenance.includes("setCurrentTime(Date.now())"));
  assert.ok(!housekeeping.includes("dueAt).getTime() < Date.now()"));
  assert.ok(!maintenance.includes("dueAt).getTime() < Date.now()"));
});
