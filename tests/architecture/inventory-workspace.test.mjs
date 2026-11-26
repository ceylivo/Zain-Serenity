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
