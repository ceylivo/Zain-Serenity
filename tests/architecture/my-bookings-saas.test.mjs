import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("customer booking history API scopes bookings and payment attempts to the signed-in user", async () => {
  const api = await read("../../src/app/api/my-bookings/route.ts");
  assert.ok(api.includes('const filter = { userId: session.user.id }'));
  assert.ok(api.includes("Payment.find({ bookingId: { $in: bookingIds }, userId: new mongoose.Types.ObjectId(session.user.id) })"));
  assert.ok(api.includes("pagination: { page, limit, total"));
});

test("customer booking history enriches bookings with tenant, property, room and payment details", async () => {
  const api = await read("../../src/app/api/my-bookings/route.ts");
  for (const model of ["Tenant.find(", "Property.find(", "RoomType.find(", "Payment.find("]) assert.ok(api.includes(model));
  for (const field of ["tenant:", "property:", "roomName:", "payments:"]) assert.ok(api.includes(field));
});

test("customer booking history UI uses the tenant-aware API and scoped cancellation endpoint", async () => {
  const page = await read("../../src/app/my-bookings/page.tsx");
  assert.ok(page.includes("/api/my-bookings"));
  assert.ok(page.includes("/bookings/${booking._id}/cancel"));
  assert.ok(page.includes("booking.paymentStatus"));
  assert.ok(page.includes("booking.payments.map"));
  assert.ok(!page.includes('fetch("/api/bookings")'));
});
