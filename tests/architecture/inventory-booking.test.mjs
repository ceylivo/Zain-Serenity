import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("room type and physical room inventory are tenant/property scoped", async () => {
  const roomType = await read("../../src/models/RoomType.ts");
  const physicalRoom = await read("../../src/models/PhysicalRoom.ts");
  const inventory = await read("../../src/models/InventoryDay.ts");
  assert.ok(roomType.includes("tenantId:") && roomType.includes("required: true"));
  assert.ok(roomType.includes("inventoryCount:") && roomType.includes("required: true"));
  assert.ok(physicalRoom.includes("tenantId:") && physicalRoom.includes("required: true"));
  assert.ok(physicalRoom.includes("propertyId:") && physicalRoom.includes("required: true"));
  assert.ok(inventory.includes("unique: true"));
});

test("booking price is calculated from a tenant-owned active rate plan", async () => {
  const service = await read("../../src/lib/inventoryReservation.ts");
  assert.ok(service.includes("tenantId: input.tenantId"));
  assert.ok(service.includes("propertyId: input.propertyId"));
  assert.ok(service.includes("isActive: true"));
  assert.ok(service.includes("const subtotal = rate.nightlyRate * nights.length"));
  assert.ok(service.includes("const taxes = Math.round(subtotal * rate.taxRatePercent / 100)"));
  assert.ok(!service.includes("input.totalPrice"));
});

test("inventory reservation and booking creation share a MongoDB transaction", async () => {
  const service = await read("../../src/lib/inventoryReservation.ts");
  assert.ok(service.includes("session.withTransaction(async"));
  assert.ok(service.includes("availableRooms: { $gt: 0 }"));
  assert.ok(service.includes("$inc: { availableRooms: -1, reservedRooms: 1 }"));
  assert.ok(service.includes("Booking.create(["));
  assert.ok(service.includes("], { session })"));
  assert.ok(service.includes("{ new: true, session }"));
});

test("booking API does not accept client-supplied price or tenant ownership", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/route.ts");
  assert.ok(route.includes("resolveTenantAccess("));
  assert.ok(route.includes("createInventoryBooking("));
  assert.ok(!route.includes("body.totalPrice"));
  assert.ok(!route.includes("tenantId: body."));
});

test("legacy booking records remain compatible during staged migration", async () => {
  const booking = await read("../../src/models/Booking.ts");
  assert.ok(/tenantId\??\s*:\s*mongoose\.Types\.ObjectId/.test(booking));
  assert.ok(/propertyId\??\s*:\s*mongoose\.Types\.ObjectId/.test(booking));
  assert.ok(/paymentStatus\??\s*:\s*PaymentStatus/.test(booking));
});
