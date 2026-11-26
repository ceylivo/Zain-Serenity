import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("cancellation is tenant/property scoped and transactional", async () => {
  const service = await read("../../src/lib/bookingLifecycle.ts");
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/[bookingId]/cancel/route.ts");
  assert.ok(service.includes("session.withTransaction(async"));
  assert.ok(service.includes("tenantId: input.tenantId"));
  assert.ok(service.includes("propertyId: input.propertyId"));
  assert.ok(service.includes('status: { $in: ["pending", "confirmed"] }'));
  assert.ok(service.includes("reservedRooms: { $gt: 0 }"));
  assert.ok(service.includes("$inc: { reservedRooms: -1, availableRooms: 1 }"));
  assert.ok(route.includes('permission: "booking:cancel"'));
  assert.ok(route.includes("cancelTenantBooking("));
});

test("cancellation blocks settled, submitted and refund-related payments", async () => {
  const service = await read("../../src/lib/bookingLifecycle.ts");
  assert.ok(service.includes("PAYMENT_ACTION_REQUIRED"));
  assert.ok(service.includes("paymentRecords.some("));
  assert.ok(service.includes('payment.status === "succeeded"'));
  assert.ok(service.includes('payment.status === "refunded"'));
  assert.ok(service.includes('payment.status === "pending_verification"'));
  assert.ok(service.includes('"paid", "partially_paid", "partially_refunded", "refunded"'));
  assert.ok(service.includes("requires staff review before cancellation"));
});

test("physical room assignment checks tenant, property, type and overlapping stays", async () => {
  const service = await read("../../src/lib/bookingLifecycle.ts");
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/[bookingId]/assign-room/route.ts");
  assert.ok(service.includes("roomTypeId: booking.roomTypeId"));
  assert.ok(service.includes("assignmentVersion: 1"));
  assert.ok(service.includes("checkIn: { $lt: booking.checkOut }"));
  assert.ok(service.includes("checkOut: { $gt: booking.checkIn }"));
  assert.ok(service.includes("physicalRoomId = room._id"));
  assert.ok(route.includes('permission: "booking:update"'));
  assert.ok(route.includes("assignPhysicalRoom("));
});

test("physical room status is not used as a date-blind reservation lock", async () => {
  const model = await read("../../src/models/PhysicalRoom.ts");
  const service = await read("../../src/lib/bookingLifecycle.ts");
  assert.ok(!model.includes('"reserved"'));
  assert.ok(model.includes("assignmentVersion: { type: Number, required: true, default: 0"));
  assert.ok(!service.includes('status: "reserved"'));
});

test("guest cancellation is restricted to the authenticated booking owner", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/[bookingId]/cancel/route.ts");
  assert.ok(route.includes("userId: session.user.id"));
  assert.ok(route.includes("tenantId: property.tenantId"));
  assert.ok(route.includes("propertyId: property.propertyId"));
  assert.ok(route.includes("const canCancelAny = staffAccess.ok"));
  assert.ok(route.includes("if (!canCancelAny)"));
});

test("booking cancellation releases only unsettled payment attempts", async () => {
  const service = await read("../../src/lib/bookingLifecycle.ts");
  assert.ok(service.includes('payment.status === "pending_verification"'));
  assert.ok(service.includes('payment.status === "pending" && payment.isActive'));
  assert.ok(service.includes('payment.status = "cancelled"'));
  assert.ok(service.includes("payment.isActive = false"));
  assert.ok(service.includes('payment.status === "succeeded"'));
});
test("check-in is blocked until assigned-room housekeeping and maintenance work is resolved", async () => {
  const lifecycle = await read("../../src/lib/bookingLifecycle.ts");
  assert.ok(lifecycle.includes("HousekeepingTask.exists"));
  assert.ok(lifecycle.includes("MaintenanceWorkOrder.exists"));
  assert.ok(lifecycle.includes("unfinished housekeeping or maintenance work"));
  assert.ok(lifecycle.includes('status: { $in: ["open", "in_progress", "blocked"] }'));
  assert.ok(lifecycle.includes("synchronizePhysicalRoomOperationalStatus"));
  assert.ok(lifecycle.includes('input.action === "check_out"'));
});
