import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("payment workspace loads tenant and property context from scoped APIs", async () => {
  const page = await read("../../src/app/workspace/payments/page.tsx");
  assert.ok(page.includes('fetch("/api/tenants"'));
  assert.ok(page.includes("/properties"));
  assert.ok(page.includes("/payments"));
  assert.ok(!page.includes('fetch("/api/bookings"'));
});

test("payment workspace actions use server-authorized verification and cash collection routes", async () => {
  const page = await read("../../src/app/workspace/payments/page.tsx");
  assert.ok(page.includes('const endpoint = action === "cash" ? "collect-cash" : "verify"'));
  assert.ok(page.includes('outcome: action === "verify" ? "succeeded" : "failed"'));
  assert.ok(page.includes("payment.method === \"cash_on_arrival\""));
  assert.ok(page.includes("canVerify && payment.method !== \"cash_on_arrival\""));
});

test("payment workspace only offers mutation controls to owner and payment verifier roles", async () => {
  const page = await read("../../src/app/workspace/payments/page.tsx");
  assert.ok(page.includes('selectedTenant?.role === "tenant_owner" || selectedTenant?.role === "payment_verifier"'));
  assert.ok(page.includes("!canVerify"));
});

test("receipt preview is fetched from the protected receipt endpoint", async () => {
  const page = await read("../../src/app/workspace/payments/page.tsx");
  assert.ok(page.includes("/payments/${payment._id}/receipt"));
  assert.ok(page.includes("window.open(body.data.url"));
  assert.ok(!page.includes("cloudinary.com"));
});
