import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("inventory workspace loads tenant and property scoped inventory endpoints", async () => {
  const page = await read("../../src/app/workspace/inventory/page.tsx");
  for (const endpoint of ["/api/tenants", "/properties", "/room-types", "/rate-plans", "/physical-rooms"]) assert.ok(page.includes(endpoint));
});

test("inventory workspace creates room types, rate plans and physical rooms through server APIs", async () => {
  const page = await read("../../src/app/workspace/inventory/page.tsx");
  for (const endpoint of ['"room-types"', '"rate-plans"', '"physical-rooms"']) assert.ok(page.includes(endpoint));
  assert.ok(page.includes('method: "POST"'));
});

test("inventory workspace gates creation controls by tenant owner or property manager role", async () => {
  const page = await read("../../src/app/workspace/inventory/page.tsx");
  assert.ok(page.includes('["tenant_owner", "property_manager"]'));
  assert.ok(page.includes("Your role can view inventory"));
});

test("inventory workspace does not submit tenant, property or price authority fields", async () => {
  const page = await read("../../src/app/workspace/inventory/page.tsx");
  assert.ok(page.includes("roomTypeId: selectedRoomType"));
  assert.ok(page.includes("nightlyRate: Number(ratePrice)"));
  assert.ok(!page.includes("tenantId:"));
  assert.ok(!page.includes("propertyId:"));
});

test("availability calendar API is tenant scoped, bounded to 31 days and includes legacy bookings", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/inventory/availability/route.ts");
  assert.ok(route.includes('permission: "inventory:read"'));
  assert.ok(route.includes("days > 31"));
  assert.ok(route.includes("InventoryDay.find"));
  assert.ok(route.includes('status: { $in: ["pending", "confirmed", "checked_in"] }'));
  assert.ok(route.includes("Math.max(day?.reservedRooms ?? 0, overlappingBookings)"));
});

test("inventory workspace renders a 14-day availability calendar", async () => {
  const page = await read("../../src/app/workspace/inventory/page.tsx");
  assert.ok(page.includes("/inventory/availability?startDate="));
  assert.ok(page.includes("Room availability calendar"));
  assert.ok(page.includes("setCalendarStart"));
  assert.ok(page.includes("availableRooms"));
});

test("inventory block API is tenant scoped, date bounded and transactional", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/inventory/blocks/route.ts");
  assert.ok(route.includes('permission: "inventory:manage"'));
  assert.ok(route.includes("dates.length > 31"));
  assert.ok(route.includes("sessionDb.withTransaction(async"));
  assert.ok(route.includes("availableRooms: { $gte: Number(quantity) }"));
  assert.ok(route.includes("blockedRooms: { $gte: Number(quantity) }"));
  assert.ok(route.includes("legacyReservedByDate"));
  assert.ok(route.includes("AuditLog.create"));
});

test("inventory workspace exposes tracked block creation and per-record partial release controls", async () => {
  const page = await read("../../src/app/workspace/inventory/page.tsx");
  assert.ok(page.includes("/inventory/blocks"));
  assert.ok(page.includes("Block room inventory"));
  assert.ok(page.includes("blockReason"));
  assert.ok(page.includes("Inventory block history"));
  assert.ok(page.includes("releaseQuantities"));
  assert.ok(page.includes("releaseReasons"));
  assert.ok(page.includes("releaseInventoryBlock"));
  assert.ok(page.includes("Release quantities later against this exact record"));
  assert.ok(!page.includes('value="unblock"'));
});
