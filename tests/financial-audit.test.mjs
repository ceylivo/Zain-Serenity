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
  assert.equal(report.currencies.USD.totalMinorUnits,"30");
  assert.equal(report.totals.validFields,2);
});

test("audit identifies amounts outside JavaScript safe integer range", () => {
  assert.equal(inspectMoneyValue("9007199254740992","JPY").status,"unsafe_integer");
});
