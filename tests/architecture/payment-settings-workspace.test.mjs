import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("payment settings workspace uses tenant and property scoped APIs", async () => {
  const page = await read("../../src/app/workspace/payment-settings/page.tsx");
  assert.ok(page.includes('fetch("/api/tenants"'));
  assert.ok(page.includes("/payment-settings"));
  assert.ok(page.includes('method: "PUT"'));
});

test("payment settings workspace exposes only supported manual payment methods", async () => {
  const page = await read("../../src/app/workspace/payment-settings/page.tsx");
  for (const method of ["bank_transfer", "easypaisa", "jazzcash", "cash_on_arrival"]) assert.ok(page.includes(method));
  assert.ok(!page.includes('id: "stripe"'));
});

test("payment settings editing is restricted to tenant owners in the UI", async () => {
  const page = await read("../../src/app/workspace/payment-settings/page.tsx");
  assert.ok(page.includes('tenant?.role === "tenant_owner"'));
  assert.ok(page.includes("Only a tenant owner can edit payment settings."));
});

test("payment settings workspace sends configured fields to the server without accepting prices", async () => {
  const page = await read("../../src/app/workspace/payment-settings/page.tsx");
  assert.ok(page.includes("JSON.stringify(settings)"));
  assert.ok(!page.includes("totalPrice"));
});
