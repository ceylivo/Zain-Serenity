import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("tenant booking journey loads public room, rate and payment settings APIs", async () => {
  const page = await read("../../src/app/book/[tenantSlug]/[propertySlug]/BookingFlow.tsx");
  for (const endpoint of ["/room-types", "/rate-plans", "/payment-settings"]) assert.ok(page.includes(endpoint));
  assert.ok(page.includes("Promise.all"));
});

test("customer reservation sends identifiers and dates, never a client total", async () => {
  const page = await read("../../src/app/book/[tenantSlug]/[propertySlug]/BookingFlow.tsx");
  assert.ok(page.includes("${base}/bookings"));
  assert.ok(page.includes("roomTypeId, ratePlanId, checkIn, checkOut, guests, children, specialRequests"));
  assert.ok(!page.includes("body: JSON.stringify({ roomTypeId, ratePlanId, checkIn, checkOut, guests, children, specialRequests, totalPrice"));
  assert.ok(page.includes("booking.totalPrice"));
});

test("customer payment attempt is idempotent and does not submit an amount", async () => {
  const page = await read("../../src/app/book/[tenantSlug]/[propertySlug]/BookingFlow.tsx");
  assert.ok(page.includes('"Idempotency-Key": crypto.randomUUID()'));
  assert.ok(page.includes("bookingId: booking._id, method"));
  assert.ok(page.includes("${base}/payments"));
  assert.ok(!page.includes("amount: booking.totalPrice"));
});

test("receipt is submitted as multipart to the protected receipt endpoint", async () => {
  const page = await read("../../src/app/book/[tenantSlug]/[propertySlug]/BookingFlow.tsx");
  assert.ok(page.includes('form.set("file", receipt)'));
  assert.ok(page.includes("${base}/payments/${payment._id}/receipt"));
  assert.ok(page.includes("image/jpeg,image/png,image/webp"));
  assert.ok(page.includes("5 MB"));
});

test("cash-on-arrival remains pending until staff collection", async () => {
  const page = await read("../../src/app/book/[tenantSlug]/[propertySlug]/BookingFlow.tsx");
  assert.ok(page.includes("Property staff will record cash when received."));
  assert.ok(page.includes('payment.method === "cash_on_arrival"'));
});
