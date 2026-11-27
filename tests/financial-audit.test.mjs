import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectMoneyValue,
  createFinancialAuditReport,
  addMoneyObservation,
} from "../scripts/lib/financial-audit.mjs";

test("audit recognizes supported currency exponents", () => {
  assert.equal(inspectMoneyValue("12.34","PKR").status,"valid");
  assert.equal(inspectMoneyValue("12","JPY").status,"valid");
  assert.equal(inspectMoneyValue("1.234","KWD").status,"valid");
  assert.equal(inspectMoneyValue("1.2345","CLF").status,"valid");
});

test("audit flags missing/invalid currency and excess precision", () => {
  assert.equal(inspectMoneyValue("1.00","").status,"invalid_currency");
  assert.equal(inspectMoneyValue("1.001","PKR").status,"excess_precision");
  assert.equal(inspectMoneyValue("1.01","JPY").status,"excess_precision");
  assert.equal(inspectMoneyValue("NaN","USD").status,"malformed_decimal");
});

test("audit uses exact integer minor-unit totals without floating point", () => {
  const report = createFinancialAuditReport();
  addMoneyObservation(report,"payments",{_id:"p1"},"amount","0.10","USD");
  addMoneyObservation(report,"payments",{_id:"p2"},"amount","0.20","USD");
  assert.equal(report.currencies.USD.byField.amount.totalMinorUnits,"30");
  assert.equal(report.totals.validFields,2);
});

test("audit identifies amounts outside JavaScript safe integer range", () => {
  assert.equal(inspectMoneyValue("9007199254740992","JPY").status,"unsafe_integer");
});

test("audit flags negative monetary amounts for review", () => {
  assert.equal(inspectMoneyValue("-0.01","PKR").status,"negative_value");
  assert.equal(inspectMoneyValue("0.00","PKR").status,"valid");
});

test("audit script is read-only and prefers secondary reads", async () => {
  const { readFile } = await import("node:fs/promises");
  const script = await readFile(new URL("../scripts/audit-financial-data.mjs", import.meta.url), "utf8");
  assert.match(script, /readPreference:\s*"secondaryPreferred"/);
  assert.match(script, /collection\.find\(/);
  assert.doesNotMatch(script, /\.insertOne\(|\.updateOne\(|\.replaceOne\(|\.deleteOne\(|\.bulkWrite\(/);
});
