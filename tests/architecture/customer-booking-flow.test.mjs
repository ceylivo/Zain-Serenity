import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("tenant booking journey loads only public room, rate and payment settings APIs", async () => {
  const page = await read("../../src/app/book/[tenantSlug]/[propertySlug]/BookingFlow.tsx");
  assert.ok(page.includes("/room-types"));
  assert.ok(page.includes("/rate-plans"));
  assert.ok(page.includes("/payment-settings"));
  assert.ok(page.includes("Promise.all"));
});

test("customer reservation submits room and rate IDs without a client price", async () => {
  const page = await read("../../src/app/book/[tenantSlug]/[propertySlug]/BookingFlow.tsx");
  assert.ok(page.includes("${base}/bookings"));
  assert.ok(page.includes("roomTypeId, ratePlanId, checkIn, checkOut, guests, children, specialRequests"));
  assert.ok(!page.includes("totalPrice:"));
  assert.ok(page.includes("booking.totalPrice"));
});

test("customer payment attempt uses an idempotency key and server-owned booking amount", async () => {
  const page = await read("../../src/app/book/[tenantSlug]/[propertySlug]/BookingFlow.tsx");
  assert.ok(page.includes('"Idempotency-Key": crypto.randomUUID()'));
  assert.ok(page.includes("bookingId: booking._id, method"));
  assert.ok(page.includes("${base}/payments"));
  assert.ok(!page.includes("amount: booking.totalPrice"));
});

test("manual payment proof is submitted as multipart to the protected receipt route", async () => {
  const page = await read("../../src/app/book/[tenantSlug]/[propertySlug]/BookingFlow.tsx");
  assert.ok(page.includes('form.set("file", receipt)'));
  assert.ok(page.includes("${base}/payments/${payment._id}/receipt"));
  assert.ok(page.includes("image/jpeg,image/png,image/webp"));
  assert.ok(page.includes("5 MB"));
});

test("cash on arrival is shown as pending until property staff records collection", async () => {
  const page = await read("../../src/app/book/[tenantSlug]/[propertySlug]/BookingFlow.tsx");
  assert.ok(page.includes("Property staff will record cash when received."));
  assert.ok(!page.includes("cash_on_arrival" && payment.status === "succeeded"));
});
