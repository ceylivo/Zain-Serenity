import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("refund records preserve tenant ownership, currency, idempotency and lifecycle history", async () => {
  const model = await read("../../src/models/Refund.ts");
  assert.match(model, /tenantId: \{ type: Schema\.Types\.ObjectId[^\n]*immutable: true/);
  assert.match(model, /propertyId: \{ type: Schema\.Types\.ObjectId[^\n]*immutable: true/);
  assert.match(model, /idempotencyKey: \{ type: String[^\n]*immutable: true/);
  assert.match(model, /RefundSchema\.index\(\{ tenantId: 1, propertyId: 1, idempotencyKey: 1 \}, \{ unique: true \}\)/);
  assert.match(model, /requestedAt/);
  assert.match(model, /reviewedBy/);
  assert.match(model, /completedBy/);
});

test("refund requests reserve the refundable amount atomically and enforce idempotency", async () => {
  const service = await read("../../src/lib/refundLifecycle.ts");
  const payment = await read("../../src/models/Payment.ts");
  assert.match(payment, /refundReservedAmount: \{ type: Number/);
  assert.match(service, /Payment\.updateOne\([\s\S]*?\$expr:[\s\S]*?\$ifNull: \["\$refundReservedAmount", 0\]/);
  assert.match(service, /\$inc: \{ refundReservedAmount: amount \/ 100 \}/);
  assert.match(service, /IDEMPOTENCY_CONFLICT/);
  assert.match(service, /REFUND_LIMIT_EXCEEDED/);
});

test("refund completion requires external settlement evidence and keeps booking/payment states synchronized", async () => {
  const service = await read("../../src/lib/refundLifecycle.ts");
  assert.match(service, /REFUND_REFERENCE_REQUIRED/);
  assert.match(service, /refund\.externalReference = input\.externalReference/);
  assert.match(service, /status: "completed"/);
  assert.match(service, /payment\.status = "refunded"/);
  assert.match(service, /booking\.paymentStatus = net === 0 && gross > 0 \? "refunded"/);
  assert.match(service, /withTransaction/);
  assert.match(service, /A different authorized owner must review the refund request/);
  assert.match(service, /A reason is required when rejecting or failing a refund/);
});

test("refund API is property scoped and requires refund permission", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/payments/[paymentId]/refunds/route.ts");
  assert.match(route, /permission: "payment:refund"/);
  assert.match(route, /permission: "payment:read"/);
  assert.match(route, /Idempotency-Key/);
  assert.match(route, /tenantId: access\.tenantId, propertyId: access\.propertyId, paymentId/);
});

test("only tenant owners can request and approve refunds by default", async () => {
  const permissions = await read("../../src/lib/permissions.ts");
  assert.match(permissions, /tenant_owner: PERMISSIONS/);
  const verifier = permissions.split("payment_verifier:")[1].split("receptionist:")[0];
  assert.doesNotMatch(verifier, /payment:refund/);
  const manager = permissions.split("property_manager:")[1].split("booking_manager:")[0];
  assert.doesNotMatch(manager, /payment:refund/);
});

test("refund route binds every lifecycle action to the payment in its URL", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/payments/[paymentId]/refunds/route.ts");
  const service = await read("../../src/lib/refundLifecycle.ts");
  assert.match(route, /readString\(body\.action, \{ min: 4, max: 10 \}\)/);
  assert.match(route, /paymentId, tenantId: access\.tenantId/);
  assert.match(route, /refundId, paymentId,/);
  assert.match(service, /_id: input\.refundId, paymentId: input\.paymentId/);
});

test("reconciliation is tenant-scoped, currency-separated and based on settled ledger entries", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/payments/reconciliation/route.ts");
  assert.match(route, /permission: "report:read"/);
  assert.match(route, /status: \{ \$in: \["succeeded", "refunded"\] \}/);
  assert.match(route, /status: \{ \$in: \["requested", "approved", "processing", "completed"\] \}/);
  assert.match(route, /completedRefunds: refund/);
  assert.match(route, /netCollected:/);
  assert.match(route, /outstandingBalances:/);
  assert.match(route, /never converted/);
  assert.match(route, /maximum range of 366 days/);
  assert.doesNotMatch(route, /\$limit: 10000/);
});

test("refund workspace is linked, role-aware and records external settlement evidence", async () => {
  const page = await read("../../src/app/workspace/refunds/page.tsx");
  const nav = await read("../../src/components/WorkspaceShell.tsx");
  const packageJson = await read("../../package.json");
  assert.match(page, /tenant_owner/);
  assert.match(page, /Idempotency-Key/);
  assert.match(page, /Record settlement complete/);
  assert.match(page, /externalReference/);
  assert.match(page, /No money is transferred by this screen/);
  assert.match(nav, /\/workspace\/refunds/);
  assert.match(nav, /\/workspace\/reconciliation/);
  assert.match(packageJson, /src\/app\/workspace\/refunds\/page\.tsx/);
  assert.match(packageJson, /src\/app\/workspace\/reconciliation\/page\.tsx/);
});

test("reconciliation workspace presents currency-separated ledger totals and current balances", async () => {
  const page = await read("../../src/app/workspace/reconciliation/page.tsx");
  assert.match(page, /grossCollected/);
  assert.match(page, /netCollected/);
  assert.match(page, /completedRefunds/);
  assert.match(page, /pendingRefunds/);
  assert.match(page, /outstandingBalances/);
  assert.match(page, /financial reporting access/i);
});
