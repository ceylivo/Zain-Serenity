# SaaS Domain Model

## Ownership hierarchy

```text
Platform
  └── Tenant (hospitality business)
        ├── Memberships (global users + tenant roles)
        ├── Properties (one or many)
        │     ├── Room types and physical inventory units
        │     ├── Rate plans and daily inventory
        │     ├── Bookings and booking events
        │     ├── Payments, attempts, evidence and refunds
        │     ├── Media assets and reviews
        │     └── Notifications and reports
        └── Tenant settings and future SaaS subscription
```

## Non-negotiable principles

1. Tenant is the commercial organization; property is an independently operated accommodation location.
2. User is a global identity. Tenant permissions are granted through Membership documents, never a client-provided role.
3. Membership may be limited to selected property IDs. Tenant owners can manage every property in their tenant.
4. Every tenant-owned document carries trusted tenantId; property-owned documents carry tenantId and propertyId.
5. Tenant/property identifiers are injected from trusted server context, never accepted as authoritative request-body fields.
6. Tenant-scoped unique indexes include tenantId. Tenant-owned reads and writes include tenantId in database predicates.
7. Resolving a public tenant identifies a tenant but grants no private access.
8. Platform roles remain separate from tenant membership roles. Legacy global admin is not automatically a platform super-admin.
9. Guest payments and future platform subscription billing are separate domains.
10. Cross-tenant platform support access must be explicit, least-privilege and audited.

## Inventory strategy

The product supports room-type inventory and physical unit assignment:
- Guest books a sellable room type for a date range.
- Daily inventory is consumed for every night.
- Physical unit can be assigned later by authorized staff.
- Maintenance blocks a unit or sellable quantity for affected dates.
- Inventory writes must be concurrency-safe; read-then-create availability checks are insufficient.

MongoDB transaction strategy is intentionally not hard-coded until deployment topology is verified. A per-day conditional atomic inventory update is a candidate, but reservations spanning multiple nights and related payment records need a consistency and compensation design.

## Initial models

- Tenant: organization identity, slug, status, owner reference and defaults.
- Property: tenant-owned profile, timezone, locale, currency, address and operational times.
- Membership: global user membership, tenant role, status and optional property assignments.
- AuditLog: append-only operational/security event record.

These are foundation models, not the complete booking/payment schema. Legacy single-property models remain untouched until migration and compatibility are tested.
