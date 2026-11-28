const MINOR_UNIT_OVERRIDES = Object.freeze({
  BIF:0, CLP:0, DJF:0, GNF:0, ISK:0, JPY:0, KMF:0, KRW:0,
  PYG:0, RWF:0, UGX:0, UYI:0, VND:0, VUV:0, XAF:0, XOF:0, XPF:0,
  BHD:3, IQD:3, JOD:3, KWD:3, LYD:3, OMR:3, TND:3, CLF:4, UYW:4,
});

export function getCurrencyDigits(currency) {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    return { valid:false, digits:null };
  }
  try {
    new Intl.NumberFormat("en", { style:"currency", currency });
  } catch {
    return { valid:false, digits:null };
  }
  return { valid:true, digits:MINOR_UNIT_OVERRIDES[currency] ?? 2 };
}

function decimalParts(value) {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { valid:false, reason:"non_finite_number" };
  }
  if (typeof value !== "number" && typeof value !== "string" &&
      !(value && typeof value.toString === "function")) {
    return { valid:false, reason:"unsupported_type" };
  }
  const raw = String(value).trim();
  const match = /^(-?)(\\d+)(?:\\.(\\d+))?(?:[eE]([+-]?\\d+))?$/.exec(raw);
  if (!match) return { valid:false, reason:"malformed_decimal" };
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
    return { valid:false, reason:"invalid_exponent" };
  }
  const digits = match[2] + (match[3] ?? "");
  const decimalPosition = match[2].length + exponent;
  const whole = decimalPosition <= 0 ? "0" :
    decimalPosition >= digits.length ? digits + "0".repeat(decimalPosition - digits.length) :
    digits.slice(0, decimalPosition);
  const fraction = decimalPosition <= 0 ? "0".repeat(-decimalPosition) + digits :
    decimalPosition >= digits.length ? "" : digits.slice(decimalPosition);
  return { valid:true, negative:match[1] === "-", whole:whole || "0", fraction, raw };
}

export function inspectMoneyValue(value, currency) {
  const currencyInfo = getCurrencyDigits(currency);
  if (!currencyInfo.valid) return { status:"invalid_currency", minorUnits:null, safeInteger:false };
  const parts = decimalParts(value);
  if (!parts.valid) return { status:parts.reason, minorUnits:null, safeInteger:false };
  const { digits } = currencyInfo;
  const extra = parts.fraction.slice(digits);
  if (/[1-9]/.test(extra)) {
    return { status:"excess_precision", minorUnits:null, safeInteger:false, allowedDigits:digits };
  }
  const factor = 10n ** BigInt(digits);
  const fraction = (parts.fraction.slice(0,digits) + "0".repeat(digits)).slice(0,digits);
  const minor = BigInt(parts.whole) * factor + BigInt(fraction || "0");
  const signed = parts.negative ? -minor : minor;
  const safeInteger = signed <= BigInt(Number.MAX_SAFE_INTEGER) && signed >= BigInt(Number.MIN_SAFE_INTEGER);
  const status = !safeInteger ? "unsafe_integer" : (parts.negative && minor !== 0n ? "negative_value" : "valid");
  return {
    status,
    minorUnits:signed.toString(),
    safeInteger,
    allowedDigits:digits,
    normalizedMajor:parts.raw,
  };
}

export function createFinancialAuditReport() {
  return {
    generatedAt:new Date().toISOString(),
    mode:"read-only",
    collections:{},
    currencies:{},
    anomalies:[],
    anomalyCounts:{},
    totals:{
      documentsScanned:0,
      monetaryFieldsScanned:0,
      validFields:0,
      invalidFields:0,
    },
  };
}

export function addMoneyObservation(report, collectionName, document, field, value, currency) {
  report.totals.monetaryFieldsScanned += 1;
  const result = inspectMoneyValue(value, currency);
  const bucketKey = currency || "MISSING_CURRENCY";
  const currencyBucket = report.currencies[bucketKey] ??= {
    fields:0, validFields:0, invalidFields:0, byField:{},
  };
  const fieldKey = `${collectionName}.${field}`;
  const fieldBucket = currencyBucket.byField[fieldKey] ??= {
    fields:0, validFields:0, invalidFields:0, totalMinorUnits:"0",
  };
  currencyBucket.fields += 1;
  fieldBucket.fields += 1;
  if (result.minorUnits !== null) {
    fieldBucket.totalMinorUnits = (BigInt(fieldBucket.totalMinorUnits) + BigInt(result.minorUnits)).toString();
  }
  if (result.status === "valid") {
    currencyBucket.validFields += 1;
    fieldBucket.validFields += 1;
    report.totals.validFields += 1;
  } else {
    currencyBucket.invalidFields += 1;
    fieldBucket.invalidFields += 1;
    report.totals.invalidFields += 1;
  }
  if (result.status !== "valid") {
    report.anomalyCounts[result.status] = (report.anomalyCounts[result.status] ?? 0) + 1;
    if (report.anomalies.length < 100) {
      report.anomalies.push({
        collection:collectionName,
        documentId:String(document._id),
        field,
        currency:currency || null,
        status:result.status,
        value:String(value),
      });
    }
  }
  return result;
}

export function addMissingMoneyObservation(report, collectionName, document, field) {
  report.totals.monetaryFieldsScanned += 1;
  report.totals.invalidFields += 1;
  const currency = typeof document.currency === "string" ? document.currency.trim().toUpperCase() : "";
  const bucketKey = currency || "MISSING_CURRENCY";
  const currencyBucket = report.currencies[bucketKey] ??= {
    fields:0, validFields:0, invalidFields:0, byField:{},
  };
  const fieldKey = `${collectionName}.${field}`;
  const fieldBucket = currencyBucket.byField[fieldKey] ??= {
    fields:0, validFields:0, invalidFields:0, totalMinorUnits:"0",
  };
  currencyBucket.fields += 1;
  currencyBucket.invalidFields += 1;
  fieldBucket.fields += 1;
  fieldBucket.invalidFields += 1;
  report.anomalyCounts.missing_money_field = (report.anomalyCounts.missing_money_field ?? 0) + 1;
  if (report.anomalies.length < 100) {
    report.anomalies.push({
      collection:collectionName,
      documentId:String(document._id),
      field,
      currency:currency || null,
      status:"missing_money_field",
      value:null,
    });
  }
}
