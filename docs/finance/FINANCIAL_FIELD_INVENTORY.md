# Financial field inventory and migration baseline

Status: audit baseline only. No database migration is authorized or performed by this document.

Scope inspected on `feat/hospitality-saas-foundation`: Booking, RatePlan, Payment, Refund models; booking reservation, payment and refund lifecycle services; payment reconciliation aggregation.

## Persisted monetary fields

| Model | Field | Meaning | Currency source | Current representation |
|---|---|---|---|---|
| Booking | `totalPrice` | Booking total | `currency` (legacy default PKR in readers) | Major-unit JS Number |
| Booking | `pricing.subtotal` | Pre-tax/discount subtotal | `currency` | Major-unit JS Number |
| Booking | `pricing.taxes` | Tax total | `currency` | Major-unit JS Number |
| Booking | `pricing.discount` | Discount total | `currency` | Major-unit JS Number |
| Booking | `pricing.total` | Priced booking total | `currency` | Major-unit JS Number |
| RatePlan | `nightlyRate` | Nightly rate | `currency` | Major-unit JS Number |
| Payment | `amount` | Captured/attempt amount | `currency` | Major-unit JS Number |
| Payment | `refundReservedAmount` | Amount reserved against refund requests | `currency` | Major-unit JS Number |
| Refund | `amount` | Refund request/settlement amount | immutable `currency` | Major-unit JS Number |

Non-monetary quantities such as receipt file size, inventory counters, tax percentage, counts and identifiers are intentionally excluded.

## Confirmed writer/reader paths

- RatePlan creation validates currency and canonicalizes `nightlyRate` through `normalizeMoney`.
- Booking creation calculates nightly subtotal and tax in minor units in `src/lib/inventoryReservation.ts`, then persists major-unit values in the legacy Booking fields.
- Payment attempt creation derives its amount from the server-side Booking total and stores major units in Payment.
- Payment settlement sums successful payments through `toMinorUnits` before updating Booking payment status.
- Refund request reserves a major-unit amount in `Payment.refundReservedAmount` and creates a major-unit Refund record.
- Refund completion aggregates completed refunds through minor units and updates Payment/Booking lifecycle state.
- Reconciliation reads Payment, Refund and Booking monetary values. Its aggregation now casts money operands to MongoDB Decimal128 before summing; results are converted back through currency-aware minor units for API output.

## Migration constraints

1. This is a compatibility baseline, not a migration plan approval.
2. Existing data must remain unchanged until a read-only audit reports per-currency counts, null/missing currency cases, malformed amounts, unsupported precision, negative values, unsafe magnitudes, and before/after totals.
3. Do not infer historical currency from current property settings. Preserve explicit record currency; legacy missing-currency behavior (currently some readers default to PKR) must be reported separately and resolved as a reviewed policy.
4. Any future minor-unit field needs an explicit integer storage bound. JavaScript safe integers are not an unlimited ledger; MongoDB Int64 or Decimal128 may be needed for high-volume/large totals.
5. Backfill must be idempotent, batchable, tenant/property scoped, checkpointed, and produce an immutable audit report. Do not overwrite legacy source fields during initial backfill.
6. Dual-read/dual-write compatibility and cutover criteria must be defined before enabling new fields.
7. Rollback must switch readers back to the untouched legacy fields. Do not delete or reverse source values during rollback.
8. Reconciliation and financial statements must remain currency-separated; no implicit FX conversion.
9. Production migration requires backup verification, staging rehearsal, consistency checks, explicit approval and a tested rollback procedure.

## Known gaps

- Legacy schemas still store major-unit JavaScript Number fields.
- Tax percentage multiplication and other upstream calculations need a dedicated rounding-policy review.
- Historical as-of balances and statement exports are not implemented.
- Reconciliation Decimal128 aggregation requires runtime testing against the actual MongoDB version and representative legacy data.
- Replica-set integration tests for payment/refund concurrency and migration rehearsal remain outstanding.

## Read-only audit command

Run `npm run audit:financial` with `MONGODB_URI` pointed at a verified staging/backup database. The command uses MongoDB `find` cursors only, requests secondary-preferred reads, and never writes or migrates records.

The JSON report includes:
- document and monetary-field scan counts per collection;
- missing currency records separately, without assuming the legacy PKR fallback;
- invalid currency codes, malformed values, unsupported decimal precision, negative amounts, non-finite values and unsafe integer magnitudes;
- exact integer minor-unit totals grouped by currency, collection and field (for example `USD -> payments.amount`), avoiding the invalid practice of summing booking totals, tax subtotals and payment amounts into one meaningless currency total;
- the first 100 anomaly examples plus full anomaly counts.

The audit is an observational scan, not a transactionally frozen point-in-time snapshot. Run during a quiet window or against a restored backup for migration sign-off. It writes only its JSON report to stdout; it does not persist report files or modify MongoDB.

### Audit safety requirements

Use a MongoDB account with read-only privileges (for example, the built-in `read` role scoped to the target database). The script itself issues only collection `find` operations; `secondaryPreferred` is a read preference, not an authorization boundary and does not replace a read-only database role.

The audit reports absent/null required monetary values for Booking.totalPrice, RatePlan.nightlyRate, Payment.amount, Payment.refundReservedAmount and Refund.amount. Optional legacy Booking.pricing subfields are only audited when present; their absence is not automatically treated as corruption.
