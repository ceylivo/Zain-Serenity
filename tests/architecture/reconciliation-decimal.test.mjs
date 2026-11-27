import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/payments/reconciliation/route.ts", import.meta.url),
  "utf8",
);

test("financial reconciliation converts monetary aggregation inputs to Decimal128", () => {
  assert.match(source, /\$sum:\s*\{\s*\$toDecimal:\s*"\$amount"\s*\}/);
  assert.match(source, /\$toDecimal:\s*\{\s*\$cond:/);
  assert.match(source, /\$toDecimal:\s*"\$totalPrice"/);
});

test("financial reconciliation does not sum legacy floating point money fields directly", () => {
  assert.doesNotMatch(source, /\$sum:\s*"\$(?:amount|totalPrice|outstandingAmount)"/);
  assert.doesNotMatch(source, /\$sum:\s*\{\s*\$cond:[^\n]*"\$(?:amount|totalPrice)"/);
});

test("aggregation results are converted through currency-aware minor units", () => {
  assert.match(source, /toMinorUnits\(String\(value\), currency\)/);
  assert.match(source, /fromMinorUnits\(decimalToMinorUnits\(row\.amount, row\._id\), row\._id\)/);
});
