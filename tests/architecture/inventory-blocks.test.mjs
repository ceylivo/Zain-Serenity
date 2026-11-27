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

test("inventory cannot be unblocked without referencing its tracked block record", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/inventory/blocks/route.ts");
  assert.ok(route.includes('action !== "block"'));
  assert.ok(route.includes("InventoryBlock.findOneAndUpdate"));
  assert.ok(route.includes("remainingQuantity: { $gte: Number(quantity) }"));
  assert.ok(!route.includes("INSUFFICIENT_BLOCKED_INVENTORY"));
  assert.ok(!route.includes("Legacy quantity-only unblocks"));
});


test("inventory workspace exposes tracked releases instead of an unscoped unblock action", async () => {
  const page = await read("../../src/app/workspace/inventory/page.tsx");
  assert.ok(page.includes('body: JSON.stringify({ action: "block"'));
  assert.ok(page.includes("await loadInventoryBlocks(tenantSlug, propertySlug)"));
  assert.ok(page.includes("Release quantities later against this exact record"));
  assert.ok(!page.includes("blockAction"));
  assert.ok(!page.includes("Unblock rooms"));
});


test("legacy inventory reconciliation is read-only and compares tracked blocks by day", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/inventory/blocks/reconciliation/route.ts");
  assert.match(route, /permission: "inventory:read"/);
  assert.match(route, /InventoryDay\.find/);
  assert.match(route, /InventoryBlock\.find/);
  assert.match(route, /legacyUntracked/);
  assert.match(route, /overtracked/);
  assert.match(route, /safeToAutoMigrate: false/);
  assert.match(route, /Read-only audit only/);
  const readOnlyHandler = route.split("export async function POST")[0];
  assert.doesNotMatch(readOnlyHandler, /findOneAndUpdate|updateOne|\.save\(|\.create\(/);
  assert.match(route, /dates\.length > 31/);
});


test("legacy inventory audit workspace is linked and clearly read-only", async () => {
  const page = await read("../../src/app/workspace/inventory-reconciliation/page.tsx");
  const nav = await read("../../src/components/WorkspaceShell.tsx");
  const packageJson = await read("../../package.json");
  assert.match(page, /read-only audit/i);
  assert.match(page, /No automatic migration/);
  assert.match(page, /legacyUntrackedUnits/);
  assert.match(page, /overtrackedUnits/);
  assert.match(nav, /\/workspace\/inventory-reconciliation/);
  assert.match(packageJson, /src\/app\/workspace\/inventory-reconciliation\/page\.tsx/);
});


test("inventory reconciliation review cases retain immutable evidence and actor history", async () => {
  const model = await read("../../src/models/InventoryReconciliationCase.ts");
  for (const field of ["tenantId", "propertyId", "roomTypeId", "date", "inventoryBlocked", "trackedBlocked", "legacyUntracked", "overtracked", "snapshotKey", "reason", "createdBy"]) {
    assert.match(model, new RegExp(field));
  }
  assert.match(model, /immutable: true/);
  assert.match(model, /unique: true/);
  assert.match(model, /"open", "resolved", "dismissed"/);
});

test("opening a reconciliation case rechecks current counters and never changes inventory", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/inventory/blocks/reconciliation/route.ts");
  assert.match(route, /permission: "inventory:manage"/);
  assert.match(route, /DISCREPANCY_NO_LONGER_EXISTS/);
  assert.match(route, /snapshotKey/);
  assert.match(route, /sessionDb\.withTransaction/);
  assert.match(route, /InventoryReconciliationCase\.create/);
  assert.match(route, /readConcern: \{ level: "snapshot" \}/);
  assert.match(route, /RECONCILIATION_SNAPSHOT_CHANGED/);
  assert.match(route, /RECONCILIATION_SNAPSHOT_UNVERIFIABLE/);
  assert.match(route, /timestamps: false/);
  assert.match(route, /updatedAt: day\.updatedAt/);
  assert.match(route, /updatedAt: block\.updatedAt/);
  const createHandler = route.split("export async function POST")[1];
  assert.doesNotMatch(createHandler, /\$inc:\s*\{[^}]*blockedRooms/);
  assert.doesNotMatch(createHandler, /availableRooms:\s*\{|blockedRooms:\s*\{/);
});

test("review case decisions are tenant scoped, transactional and audit logged without stock mutation", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/inventory/blocks/reconciliation/cases/route.ts");
  assert.match(route, /permission: "inventory:read" \| "inventory:manage"/);
  assert.match(route, /authorized\(request, context, "inventory:read"\)/);
  assert.match(route, /authorized\(request, context, "inventory:manage"\)/);
  assert.match(route, /tenantId: auth\.access\.tenantId, propertyId: auth\.access\.propertyId/);
  assert.match(route, /withTransaction/);
  assert.match(route, /AuditLog\.create/);
  assert.match(route, /inventoryChanged: false/);
  assert.match(route, /CASE_NOT_OPEN_OR_NOT_FOUND/);
  assert.match(route, /CASE_CREATOR_CANNOT_REVIEW/);
  assert.match(route, /INDEPENDENT_REVIEW_REQUIRED/);
  assert.match(route, /existingCase\.createdBy\.toString\(\) === auth\.session\.user\.id/);
  assert.doesNotMatch(route, /InventoryDay\.findOneAndUpdate|InventoryDay\.updateOne/);
});

test("inventory reconciliation workspace can open and close auditable review cases", async () => {
  const page = await read("../../src/app/workspace/inventory-reconciliation/page.tsx");
  assert.match(page, /openReviewCase/);
  assert.match(page, /closeReviewCase/);
  assert.match(page, /resolutionNote/);
  assert.match(page, /No inventory quantities were changed|does not change inventory/i);
});
