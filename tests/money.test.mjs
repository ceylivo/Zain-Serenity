import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/money.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const money = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("currency precision follows ISO minor-unit digits", () => {
  assert.equal(money.currencyMinorUnitDigits("PKR"), 2);
  assert.equal(money.currencyMinorUnitDigits("USD"), 2);
  assert.equal(money.currencyMinorUnitDigits("JPY"), 0);
  assert.equal(money.currencyMinorUnitDigits("KWD"), 3);
});

test("major-unit amounts convert to exact minor-unit integers", () => {
  assert.equal(money.toMinorUnits("123.45", "PKR"), 12345);
  assert.equal(money.toMinorUnits("123.4500", "PKR"), 12345);
  assert.equal(money.toMinorUnits("123", "JPY"), 123);
  assert.equal(money.toMinorUnits("1.234", "KWD"), 1234);
  assert.equal(money.toMinorUnits(12.34, "USD"), 1234);
});

test("conversion rejects unsupported precision, malformed amounts and unsafe values", () => {
  assert.throws(() => money.toMinorUnits("1.001", "PKR"), RangeError);
  assert.throws(() => money.toMinorUnits("1.1", "JPY"), RangeError);
  assert.throws(() => money.toMinorUnits("1.2345", "KWD"), RangeError);
  assert.throws(() => money.toMinorUnits("1e3", "PKR"), RangeError);
  assert.throws(() => money.toMinorUnits(Number.POSITIVE_INFINITY, "PKR"), RangeError);
  assert.throws(() => money.toMinorUnits("9007199254740992", "JPY"), RangeError);
  assert.throws(() => money.toMinorUnits("1.00", "US"), RangeError);
});

test("minor-unit conversion and sums preserve the selected currency precision", () => {
  assert.equal(money.fromMinorUnits(12345, "PKR"), 123.45);
  assert.equal(money.fromMinorUnits(123, "JPY"), 123);
  assert.equal(money.fromMinorUnits(1234, "KWD"), 1.234);
  assert.equal(money.normalizeMoney(12.340000000000002, "USD"), 12.34);
  assert.equal(money.sumMinorUnits(["1.10", "2.20", "3.30"], "USD"), 660);
  assert.throws(() => money.sumMinorUnits(["9007199254740991", "1"], "JPY"), RangeError);
});
