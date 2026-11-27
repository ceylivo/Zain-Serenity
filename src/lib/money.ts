/**
 * Currency-aware money helpers.
 *
 * Persisted legacy records remain major-unit numbers for compatibility, while
 * calculations are performed using integer minor units. Currency precision is
 * derived from the ISO currency metadata provided by Intl.
 */
export function currencyMinorUnitDigits(currency: string): number {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new RangeError("Currency must be a three-letter ISO 4217 code.");
  }
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: normalized,
    }).resolvedOptions().maximumFractionDigits;
  } catch {
    throw new RangeError(`Unsupported currency code: ${normalized}`);
  }
}

export function toMinorUnits(value: number | string, currency: string): number {
  const digits = currencyMinorUnitDigits(currency);
  const factor = 10 ** digits;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("Money amount must be finite.");
    const scaled = value * factor;
    const rounded = Math.round(scaled);
    const tolerance = Math.max(1e-9, Number.EPSILON * Math.abs(scaled) * 2);
    if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > tolerance) {
      throw new RangeError(`Amount has more than ${digits} decimal places for ${currency.toUpperCase()}.`);
    }
    return rounded;
  }
  const raw = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new RangeError("Money amount must be a plain decimal value.");
  const fraction = match[3] ?? "";
  const significantExtraPrecision = fraction.slice(digits);
  if (/[1-9]/.test(significantExtraPrecision)) {
    throw new RangeError(`Amount has more than ${digits} decimal places for ${currency.toUpperCase()}.`);
  }
  const whole = Number(match[2]);
  const fractional = Number((fraction.slice(0, digits) + "0".repeat(digits)).slice(0, digits) || "0");
  const minor = whole * factor + fractional;
  if (!Number.isSafeInteger(minor)) throw new RangeError("Money amount exceeds the safe calculation range.");
  return match[1] === "-" ? -minor : minor;
}

export function fromMinorUnits(value: number, currency: string): number {
  const digits = currencyMinorUnitDigits(currency);
  if (!Number.isSafeInteger(value)) throw new RangeError("Minor-unit amount must be a safe integer.");
  const factor = 10 ** digits;
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / factor);
  const fraction = absolute % factor;
  return Number(`${sign < 0 ? "-" : ""}${whole}${digits ? `.${String(fraction).padStart(digits, "0")}` : ""}`);
}

export function normalizeMoney(value: number | string, currency: string): number {
  return fromMinorUnits(toMinorUnits(value, currency), currency);
}

export function sumMinorUnits(values: Array<number | string>, currency: string): number {
  const total = values.reduce((sum, value) => {
    const next = sum + toMinorUnits(value, currency);
    if (!Number.isSafeInteger(next)) throw new RangeError("Money total exceeds the safe calculation range.");
    return next;
  }, 0);
  return total;
}
