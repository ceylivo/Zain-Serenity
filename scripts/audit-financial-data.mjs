#!/usr/bin/env node
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import {
  createFinancialAuditReport,
  addMoneyObservation,
} from "./lib/financial-audit.mjs";

const COLLECTIONS = [
  { name:"bookings", fields:["totalPrice","pricing.subtotal","pricing.taxes","pricing.discount","pricing.total"] },
  { name:"rateplans", fields:["nightlyRate"] },
  { name:"payments", fields:["amount","refundReservedAmount"] },
  { name:"refunds", fields:["amount"] },
];

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value == null ? undefined : value[key], object);
}

function hasMoneyValue(value) {
  return value !== undefined && value !== null;
}

export async function runFinancialAudit({ uri = process.env.MONGODB_URI, output = process.stdout } = {}) {
  if (!uri) throw new Error("MONGODB_URI is required. The audit does not accept a database write operation.");
  const report = createFinancialAuditReport();
  await mongoose.connect(uri, { readPreference:"secondaryPreferred", serverSelectionTimeoutMS:10000 });
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB connection did not expose a database.");
    for (const definition of COLLECTIONS) {
      const collection = db.collection(definition.name);
      const stats = report.collections[definition.name] = {
        documentsScanned:0, monetaryFieldsScanned:0, documentsWithMissingCurrency:0,
      };
      const projection = { _id:1, currency:1 };
      for (const field of definition.fields) projection[field] = 1;
      const cursor = collection.find({}, { projection, batchSize:500 });
      for await (const document of cursor) {
        stats.documentsScanned += 1;
        report.totals.documentsScanned += 1;
        const currency = typeof document.currency === "string" ? document.currency.trim().toUpperCase() : "";
        const values = definition.fields
          .map((field) => ({ field, value:getPath(document, field) }))
          .filter((entry) => hasMoneyValue(entry.value));
        if (values.length && !currency) {
          stats.documentsWithMissingCurrency += 1;
          report.anomalyCounts.missing_currency = (report.anomalyCounts.missing_currency ?? 0) + values.length;
          if (report.anomalies.length < 100) {
            for (const entry of values) {
              report.anomalies.push({
                collection:definition.name, documentId:String(document._id),
                field:entry.field, currency:null, status:"missing_currency", value:String(entry.value),
              });
              if (report.anomalies.length >= 100) break;
            }
          }
        }
        for (const entry of values) {
          stats.monetaryFieldsScanned += 1;
          if (!currency) {
            report.totals.monetaryFieldsScanned += 1;
            report.totals.invalidFields += 1;
            const bucket = report.currencies.MISSING_CURRENCY ??= {
              fields:0, validFields:0, invalidFields:0, byField:{},
            };
            const fieldBucket = bucket.byField[entry.field] ??= {
              fields:0, validFields:0, invalidFields:0, totalMinorUnits:"0",
            };
            bucket.fields += 1;
            bucket.invalidFields += 1;
            fieldBucket.fields += 1;
            fieldBucket.invalidFields += 1;
            continue;
          }
          addMoneyObservation(report, definition.name, document, entry.field, entry.value, currency);
        }
      }
      await cursor.close();
    }
    const result = {
      ...report,
      notes:[
        "Read-only scan: this tool issues find operations only and does not insert, update, replace, or delete records.",
        "Totals are represented as integer minor-unit strings, grouped by the record's own currency.",
        "Missing currency is reported separately; no legacy PKR default is inferred.",
        "Anomalies contains at most the first 100 records; anomalyCounts contains full counts.",
        "Run against a verified backup/staging database first. Large collections may take time to scan.",
      ],
    };
    output.write(JSON.stringify(result, null, 2) + "\n");
    return result;
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFinancialAudit().catch((error) => {
    process.stderr.write(`Financial audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
