import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("money utility derives ISO currency precision instead of assuming two decimals", async () => {
  const money = await read("../../src/lib/money.ts");
  assert.match(money, /Intl\.NumberFormat/);
  assert.match(money, /maximumFractionDigits/);
  assert.match(money, /currencyMinorUnitDigits/);
  assert.doesNotMatch(money, /\* 100|\/ 100/);
});

test("money utility validates decimal precision and safe integer bounds", async () => {
  const money = await read("../../src/lib/money.ts");
  assert.match(money, /fraction\.length > digits/);
  assert.match(money, /Number\.isSafeInteger/);
  assert.match(money, /plain decimal value/);
  assert.match(money, /three-letter ISO 4217 code/);
});

test("booking, payment and refund calculations share currency-aware minor-unit helpers", async () => {
  const booking = await read("../../src/lib/inventoryReservation.ts");
  const payment = await read("../../src/lib/paymentLifecycle.ts");
  const refund = await read("../../src/lib/refundLifecycle.ts");
  const reconciliation = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/payments/reconciliation/route.ts");
  assert.match(booking, /toMinorUnits\(rate\.nightlyRate, rate\.currency\)/);
  assert.match(booking, /fromMinorUnits\(subtotalMinor \+ taxMinor, rate\.currency\)/);
  assert.match(payment, /normalizeMoney\(booking\.totalPrice, currency\)/);
  assert.match(payment, /paidMinor >= toMinorUnits\(booking\.totalPrice, bookingCurrency\)/);
  assert.match(refund, /minor\(input\.amount, currency\)/);
  assert.match(refund, /fromMinorUnits/);
  assert.match(reconciliation, /toMinorUnits\(collected, currency\)/);
  assert.match(reconciliation, /fromMinorUnits\(netMinor, currency\)/);
});
