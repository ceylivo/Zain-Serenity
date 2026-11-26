import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("cancellation is tenant/property scoped and transactional", async () => {
  const service = await read("../../src/lib/bookingLifecycle.ts");
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/[bookingId]/cancel/route.ts");
  assert.match(service, /session\.withTransaction\(async/);
  assert.match(service, /tenantId: input\.tenantId,[\s\S]*propertyId: input\.propertyId/);
  assert.match(service, /status: \{ \$in: \["pending", "confirmed"\] \}/);
  assert.match(service, /reservedRooms: \{ \$gt: 0 \}/);
  assert.match(service, /\$inc: \{ reservedRooms: -1, availableRooms: 1 \}/);
  assert.match(route, /permission: "booking:cancel"/);
  assert.match(route, /cancelTenantBooking\(/);
});

test("cancellation cannot bypass payment/refund handling", async () => {
  const service = await read("../../src/lib/bookingLifecycle.ts");
  assert.match(service, /PAYMENT_ACTION_REQUIRED/);
  assert.match(service, /!\["unpaid", "failed"\]\.includes\(booking\.paymentStatus\)/);
});

test("physical room assignment checks tenant, property, type and overlapping stays", async () => {
  const service = await read("../../src/lib/bookingLifecycle.ts");
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/[bookingId]/assign-room/route.ts");
  assert.match(service, /roomTypeId: booking\.roomTypeId/);
  assert.match(service, /assignmentVersion: 1/);
  assert.match(service, /checkIn: \{ \$lt: booking\.checkOut \}/);
  assert.match(service, /checkOut: \{ \$gt: booking\.checkIn \}/);
  assert.match(service, /physicalRoomId = room\._id/);
  assert.match(route, /permission: "booking:update"/);
  assert.match(route, /assignPhysicalRoom\(/);
});

test("physical room status is not used as a date-blind reservation lock", async () => {
  const model = await read("../../src/models/PhysicalRoom.ts");
  const service = await read("../../src/lib/bookingLifecycle.ts");
  assert.doesNotMatch(model, /"reserved"/);
  assert.match(model, /assignmentVersion: \{ type: Number, required: true, default: 0/);
  assert.doesNotMatch(service, /status: "reserved"/);
});
