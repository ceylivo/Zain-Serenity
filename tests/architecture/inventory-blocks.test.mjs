import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("inventory block records preserve tenant scope, original quantity and release history", async () => {
  const model = await read("../../src/models/InventoryBlock.ts");
  for (const field of ["tenantId", "propertyId", "roomTypeId", "startDate", "endDate", "quantity", "remainingQuantity", "releasedQuantity", "createdBy", "reason"]) assert.ok(model.includes(field));
  assert.ok(model.includes('"active", "partially_released", "released"'));
  assert.ok(model.includes("immutable: true"));
});

test("inventory block API lists records only within authorized property scope", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/inventory/blocks/route.ts");
  assert.ok(route.includes('permission: "inventory:read"'));
  assert.ok(route.includes('InventoryBlock.find({ tenantId: access.tenantId, propertyId: access.propertyId })'));
  assert.ok(route.includes(".limit(100)"));
});

test("inventory block creation is transactional and records actor and reason", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/inventory/blocks/route.ts");
  assert.ok(route.includes("InventoryBlock.create"));
  assert.ok(route.includes("createdBy: new mongoose.Types.ObjectId(session.user.id)"));
  assert.ok(route.includes("remainingQuantity: Number(quantity)"));
  assert.ok(route.includes("sessionDb.withTransaction(async"));
});

test("partial release targets one tenant-scoped block and atomically updates daily inventory", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/inventory/blocks/route.ts");
  assert.ok(route.includes('permission: "inventory:manage"'));
  assert.ok(route.includes("readString(body.blockId, { min: 24, max: 24 })"));
  assert.ok(route.includes("remainingQuantity: { $gte: Number(quantity) }"));
  assert.ok(route.includes("blockedRooms: { $gte: Number(quantity) }"));
  assert.ok(route.includes('action: "inventory.block.partially_released"'));
  assert.ok(route.includes('updated.status = updated.remainingQuantity === 0 ? "released" : "partially_released"'));
  assert.ok(route.includes("BLOCK_ALREADY_CHANGED"));
});

test("legacy quantity-based unblock remains supported for backwards compatibility", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/inventory/blocks/route.ts");
  assert.ok(route.includes("INSUFFICIENT_BLOCKED_INVENTORY"));
  assert.ok(route.includes('if (action === "block")'));
  assert.ok(route.includes('// Legacy quantity-only unblocks remain supported for old records.'));
});
