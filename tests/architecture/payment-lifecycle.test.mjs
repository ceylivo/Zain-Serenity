import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("payment attempts are tenant/property scoped and idempotent", async () => {
  const service = await read("../../src/lib/paymentLifecycle.ts");
  const model = await read("../../src/models/Payment.ts");
  assert.match(service, /tenantId: input\.tenantId, propertyId: input\.propertyId, idempotencyKey: input\.idempotencyKey/);
  assert.match(service, /existing\.userId\.toString\(\) !== input\.userId/);
  assert.match(service, /status: \{ \$in: \["pending", "pending_verification"\] \}/);
  assert.match(model, /PaymentSchema\.index\(\{ tenantId: 1, propertyId: 1, idempotencyKey: 1 \}, \{ unique: true \}\)/);
});

test("payment amounts come from the booking and not request input", async () => {
  const service = await read("../../src/lib/paymentLifecycle.ts");
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/payments/route.ts");
  assert.match(service, /const amount = Math\.round\(booking\.totalPrice \* 100\) \/ 100/);
  assert.doesNotMatch(route, /body\.amount|body\.totalPrice/);
  assert.match(service, /paymentStatus = "pending"/);
});

test("Stripe is explicitly unavailable until test checkout is implemented", async () => {
  const service = await read("../../src/lib/paymentLifecycle.ts");
  assert.match(service, /input\.method === "stripe"/);
  assert.match(service, /No live or simulated charge was created/);
});

test("manual payment verification requires proof submission", async () => {
  const service = await read("../../src/lib/paymentLifecycle.ts");
  const receiptRoute = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/payments/[paymentId]/receipt/route.ts");
  assert.match(service, /requireSubmittedProof: true/);
  assert.match(service, /payment\.status !== "pending_verification"/);
  assert.match(receiptRoute, /type: "authenticated"/);
  assert.match(receiptRoute, /access_mode: "authenticated"/);
  assert.match(receiptRoute, /private_download_url/);
  assert.match(receiptRoute, /MAX_FILE_SIZE = 5 \* 1024 \* 1024/);
});

test("manual verification and cash collection require payment verification permission", async () => {
  const verify = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/payments/[paymentId]/verify/route.ts");
  const cash = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/payments/[paymentId]/collect-cash/route.ts");
  assert.match(verify, /permission: "payment:verify"/);
  assert.match(verify, /verifyManualPayment\(/);
  assert.match(cash, /permission: "payment:verify"/);
  assert.match(cash, /collectCashPayment\(/);
});

test("payment settings are property-scoped and only owners can manage them", async () => {
  const model = await read("../../src/models/PaymentSettings.ts");
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/payment-settings/route.ts");
  const permissions = await read("../../src/lib/permissions.ts");
  assert.match(model, /PaymentSettingsSchema\.index\(\{ tenantId: 1, propertyId: 1 \}, \{ unique: true \}\)/);
  assert.match(route, /permission: "payment:manage"/);
  assert.match(route, /enabledMethods/);
  assert.match(permissions, /tenant_owner: PERMISSIONS/);
  assert.doesNotMatch(permissions.split("payment_verifier:")[1].split("receptionist:")[0], /payment:manage/);
});

test("only one active payment attempt can exist per booking", async () => {
  const model = await read("../../src/models/Payment.ts");
  const service = await read("../../src/lib/paymentLifecycle.ts");
  assert.match(model, /isActive: \{ type: Boolean, required: true, default: true \}/);
  assert.match(model, /partialFilterExpression: \{ isActive: true \}/);
  assert.match(service, /payment\.isActive = false/);
});
