# Money and Currency Handling

## Current implementation

`src/lib/money.ts` is the shared currency-precision boundary for application calculations.

- Currency codes are normalized to uppercase and precision is derived from the runtime's ISO currency metadata through `Intl.NumberFormat`.
- `toMinorUnits` converts major-unit amounts into safe integer minor units and rejects non-finite, malformed, unsafe or over-precision values.
- Harmless trailing zeroes and normal IEEE-754 representation noise from legacy numeric values are tolerated.
- `fromMinorUnits` converts a safe integer back to the legacy major-unit number representation.
- `normalizeMoney` validates and canonicalizes an amount for its currency.
- `sumMinorUnits` performs checked integer accumulation.

Booking pricing, rate-plan validation, payment amount checks, refund calculations and internal reconciliation use these helpers. Runtime tests cover two-, zero- and three-decimal currencies, malformed input, precision rejection, safe-integer limits and conversion/sum behavior.

## Persistence compatibility boundary

The current Booking, Payment and Refund schemas still persist major-unit JavaScript numbers. This change does **not** reinterpret existing database values as minor units and does not perform a data migration.

Do not write integer minor-unit values into existing `amount`, `totalPrice`, `nightlyRate` or `refundReservedAmount` fields. Such a change would silently multiply or divide financial values unless every writer, reader, report, index-dependent query and historical record is migrated together.

## Required migration design

A future persistence migration must be separately reviewed and implemented in stages:

1. **Inventory:** identify every monetary field, currency source, writer, reader, aggregation pipeline, export, UI formatter, test fixture and legacy record.
2. **Compatibility contract:** define a single persisted representation and explicit currency exponent for every supported currency. Do not infer currency precision from a display locale.
3. **Backfill design:** define deterministic conversion rules, rounding policy, treatment of invalid/over-precision legacy values, and a report-only dry run. Never silently round unexplained discrepancies.
4. **Reconciliation:** compare per-record and per-currency totals before and after conversion; include payments, refund reservations, completed refunds, booking totals and outstanding balances.
5. **Rollout:** deploy compatible readers/writers, pause or gate conflicting writes during backfill, use idempotent batches with checkpoints, and verify each batch.
6. **Recovery:** preserve a backup and tested rollback/recovery procedure. Do not delete legacy values until post-migration verification and retention requirements are satisfied.
7. **Acceptance:** require database-backed tests for concurrent payment/refund operations, retries, duplicate idempotency keys, mixed currencies, zero/three-decimal currencies and migration reruns.

A migration must not run automatically on application startup. It requires an explicit operational command, a dry-run report, production backup verification and separate approval.

## Financial invariants

- Never add or compare monetary amounts across different currencies.
- Keep reconciliation grouped by currency; do not imply FX conversion.
- Booking totals remain server-derived from persisted rate plans.
- Refund requests must not exceed the captured/refundable amount after accounting for existing reservations and completed refunds.
- A completed refund is a ledger record with external settlement evidence, not proof that the application transferred money.
- Current outstanding balances are not historical as-of balances.
- All integer arithmetic must remain within JavaScript's safe-integer range until a decimal/bigint persistence strategy is implemented and tested.
