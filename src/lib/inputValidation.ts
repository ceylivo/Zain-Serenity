export type ValidationIssue = {
  field: string;
  message: string;
};

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function readString(
  value: unknown,
  options: { min?: number; max?: number; trim?: boolean } = {}
): string | null {
  if (typeof value !== "string") return null;
  const normalized = options.trim === false ? value : value.trim();
  if (normalized.length < (options.min ?? 0)) return null;
  if (normalized.length > (options.max ?? 10_000)) return null;
  return normalized;
}

export function readInteger(
  value: unknown,
  options: { min?: number; max?: number } = {}
): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed)) return null;
  if (parsed < (options.min ?? Number.MIN_SAFE_INTEGER)) return null;
  if (parsed > (options.max ?? Number.MAX_SAFE_INTEGER)) return null;
  return parsed;
}

export function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function isValidObjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f\d]{24}$/i.test(value)
  );
}

export function isValidCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

export function isValidIanaTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
