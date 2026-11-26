# Zain Serenity — SaaS Transformation Plan

> Development workspace: `ceylivo/Zain-Serenity`  
> Final destination: `zainshah3464/Zain-Serenity`  
> Status: Phase 3 foundation implemented; customer and operations UI integration in progress

## 1. Product direction

Transform the existing Zain's Serenity hospitality booking application into a production-minded, multi-tenant hospitality SaaS platform for hotels, resorts, guesthouses, and similar accommodation businesses. Zain's Serenity will be the first tenant/property, not a hard-coded special case.

The platform must support multiple independent tenant organizations. Each tenant can manage one or more properties, property-specific staff, rooms/inventory, bookings, guest communication, payment settings, policies, reporting, and branding.

## 2. Confirmed decisions

- Multi-tenant SaaS and the Zain's Serenity first-property experience are both in scope from the foundation.
- Initial interface languages: English and Urdu. Arabic and additional languages should be addable without architectural rewrites.
- Urdu requires complete right-to-left layout support, not merely translated strings or right-aligned text.
- Existing data compatibility is not a product requirement. A clean schema redesign is allowed, but production databases must never be destructively reset without separate explicit approval, backup, and a migration/rollback plan.
- Stripe integration starts in test mode only. Live charges remain disabled until separately approved.
- Manual payment methods include configured bank transfer, Easypaisa, and JazzCash options with private receipt submission and staff verification.
- Cash on arrival is a separate payment method; selecting it does not mean cash has been collected.
- Booking state and payment state must be separate state machines.
- The development workspace is `ceylivo/Zain-Serenity`; the canonical production repository remains `zainshah3464/Zain-Serenity`. Changes will be committed to the workspace for review and manual transfer by the project owner.

## 3. Current technical baseline

Initial repository inspection identified:
- Next.js 16, React 19, TypeScript, Tailwind CSS 4.
- MongoDB with Mongoose.
- NextAuth, bcryptjs, Cloudinary, Nodemailer.
- Framer Motion, Three.js / React Three Fiber, Recharts, GA4.
- Public marketing pages, room catalogue/details, customer authentication, bookings, reviews, gallery, contact, and an admin dashboard.

Preliminary issues to validate in the full audit:
1. Booking API persists a client-supplied total price; pricing must be calculated and validated on the server.
2. Availability check and booking creation are separate operations; concurrent requests can oversell inventory.
3. Rate limiting uses process-local memory and timers; it is not safe across serverless instances.
4. Existing User, Room, and Booking models are single-property-oriented and lack tenant ownership.
5. Authorization is based on coarse admin/customer roles rather than tenant-scoped permissions.
6. Upload validation and private payment-evidence access need a security review.
7. Admin room creation needs strict allowlisted input validation.
8. Admin user listing needs pagination and minimal response DTOs.
9. Some room/review data loading may perform per-room queries.
10. Automated test scripts and a complete test suite are not configured.
11. A proper theme system, i18n catalogue, and Urdu RTL foundation are absent.
12. Payment workflows and auditable payment records need to be designed.

These are preliminary source-level findings, not a declaration that the full audit is complete.

## 4. Target architecture

### Tenant and property model
- Shared application and MongoDB cluster initially, with explicit tenant ownership on all tenant-owned records.
- A tenant may own multiple properties.
- Global identity users can belong to multiple tenants through membership records.
- Property-scoped resources must carry and validate both tenant and property ownership where relevant.
- Tenant isolation must be enforced in server-side authorization, service methods, database queries, uploads, background jobs, webhooks, exports, and audit logs—not only in frontend filtering.
- Keep data access abstractions suitable for a future dedicated database/cluster per enterprise tenant.

### Roles and permissions
Platform roles and tenant/property roles must remain separate.

Platform roles (initial set):
- Platform Owner / Super Admin
- Platform Support
- Optional Platform Finance

Tenant/property roles (initial set):
- Tenant Owner
- Property Admin / Manager
- Booking Manager
- Payment Verifier / Finance Staff
- Receptionist / Front Desk
- Customer / Guest

Add Housekeeping and read-only analyst roles when the operational scope requires them. Use centralized permission-based RBAC, deny by default, least privilege, and audit sensitive actions.

### Booking and inventory
- Define inventory granularity after inspecting the current room model and product requirements (room-type capacity versus individually assigned physical rooms).
- Enforce server-side pricing, currency, taxes/fees, date/timezone rules, occupancy limits, cancellation policy, and availability.
- Prevent double booking using a concurrency-safe reservation strategy. Verify MongoDB deployment transaction capabilities before relying on transactions.
- Booking lifecycle and payment lifecycle are independent.
- Record immutable booking/payment events and actor metadata.

Suggested booking states: draft, pending_payment, pending_verification, confirmed, checked_in, checked_out, completed, cancelled, expired, no_show.

Suggested payment states: unpaid, requires_action, pending, pending_verification, authorized, paid, partially_refunded, refunded, failed, rejected, cancelled, expired.

### Payments
- Stripe test mode only initially; secrets stay server-side, webhooks require signature verification, and all operations use idempotency.
- Manual transfers: customer selects an enabled method, receives tenant-configured instructions, submits a reference and private receipt, then authorized staff approve/reject with a reason. All transitions are audited.
- Receipt evidence must be private, access-controlled, size/type validated, and served through short-lived authorized URLs.
- Cash on arrival requires a staff action to record collection.
- Guest booking payments must be separate from future SaaS subscription billing.

### Security
- Secure authentication/session lifecycle and account recovery.
- Tenant-scoped permission checks on every protected operation.
- Server-side schema validation and explicit field allowlists.
- Rate limiting via a shared store suitable for the deployment platform.
- CSRF/origin protections where applicable, secure headers, safe error responses, and secrets hygiene.
- Safe email HTML escaping and template validation.
- Upload MIME/signature checks, size limits, and private storage policies.
- Audit logs for access, booking, payment, staff, settings, and tenant lifecycle events.
- Never expose payment secrets, private evidence, internal stack traces, or unnecessary personal data.

### Experience
- Light, dark, and system themes.
- English and Urdu initially; complete RTL mirroring for Urdu.
- Responsive public booking journey and role-aware tenant dashboards.
- Accessible keyboard navigation, focus states, labels, contrast, reduced motion, and useful empty/loading/error states.
- Tenant branding and configurable property content without leaking data across tenants.

## 5. Quality strategy

Required layers:
- Unit tests for domain logic, pricing, date ranges, permissions, and state transitions.
- Integration tests for database-backed services and API routes.
- Tenant-isolation and authorization regression tests.
- Component tests for critical forms and flows.
- End-to-end tests for registration/login, search, booking, payment verification, and staff operations.
- Accessibility checks and production build verification.

CI should run lockfile-based install, lint, typecheck, tests, build, and appropriate dependency/secret scanning. Do not mark a phase complete based only on a successful local build.

## 6. Delivery phases

0. **Audit and architecture validation** — inspect every route, model, page, shared component, configuration, environment variable, and deployment assumption; produce an evidence-based risk register and final file map.
1. **Foundation** — configuration, validation conventions, test infrastructure, CI, shared error handling, logging, and environment validation.
2. **Multi-tenancy** — tenant/property/membership models, tenant context, scoped repositories/services, migrations/seeding, and isolation tests.
3. **Authentication and security** — identity, sessions, RBAC, protected routes, audit logs, rate limiting, and upload security.
4. **Booking and inventory** — availability, pricing, concurrency protection, lifecycle, cancellation, and customer booking experience.
5. **Payments** — Stripe test mode, manual transfer verification, private evidence, cash collection, refunds/ledger foundations.
6. **Operations dashboards** — platform console, tenant/property dashboards, staff workflows, reporting.
7. **Experience and localization** — responsive UI overhaul, themes, English/Urdu, RTL, accessibility.
8. **Operations hardening** — notifications, analytics, performance, observability, deployment, backup/restore, and security review.

Each phase must include complete file contents for new/replaced files, exact paths, environment variable changes, commands, tests, acceptance criteria, and a commit. Avoid partial snippets, ellipses, fake placeholders, or instructions such as “keep the rest unchanged” when a complete file was requested.

## 7. Non-negotiable safeguards

- Never commit real secrets, API keys, database credentials, customer data, or payment evidence.
- Never enable live Stripe charges without separate approval.
- Never destructively reset a production database without separate explicit approval and a verified backup.
- Never claim a test passed unless it was actually run and its result inspected.
- Never claim changes were pushed to the canonical repository; workspace commits are review artifacts until the owner transfers them.
- Keep each commit focused and explain its contents and validation.
- Preserve the canonical repository as the source of truth until the owner intentionally transfers reviewed changes.

## 8. Phase 0 exit criteria

- Complete route, page, model, component, and configuration inventory.
- Authentication and authorization matrix.
- Tenant-owned data map and isolation boundaries.
- Booking/inventory concurrency decision grounded in deployment topology.
- Payment provider and private evidence design.
- Exact environment variable inventory (names only; never values).
- Final implementation file map and migration/seed strategy.
- Prioritized risks with file-path evidence.
- Clear local setup and verification instructions.


## 9. Verified delivery status — 2026-11-26

Development work is committed to the workspace feature branch `ceylivo/Zain-Serenity:feat/hospitality-saas-foundation`. The canonical repository remains untouched.

| Area | Status |
|---|---|
| Initial audit and architecture documents | Completed as a source-level baseline; full production readiness audit remains ongoing |
| Tenant, property, membership and permission foundation | Implemented |
| Room types, physical inventory, rate plans and transactional booking reservation | Implemented in the SaaS API foundation |
| Booking lifecycle, cancellation safeguards and physical room assignment | Implemented in the SaaS API foundation |
| Manual payments, private receipt storage, verification and cash collection | Implemented in the SaaS API foundation |
| SaaS payment verification workspace UI | Initial implementation committed; CI validation pending |
| Public booking UI and customer payment journey integration | Not yet complete |
| Stripe test-mode checkout and signed webhooks | Not implemented; Stripe remains disabled |
| Refunds, reconciliation and payment ledger | Not implemented |
| Full tenant dashboard, localization and RTL | Not implemented |
| Legacy route migration and end-to-end coverage | In progress / pending |

The latest verified successful CI run before the payment workspace UI commit was `45819158308` at commit `52ebe20`; it passed SaaS lint, TypeScript, unit tests and production build. A new workflow is required to validate later commits.

### Immediate next implementation sequence

1. Finish and validate the SaaS payment verification workspace.
2. Integrate the public booking journey with tenant/property room types, rate plans and server-priced booking APIs.
3. Add customer payment selection, private proof upload and payment status to the booking journey.
4. Add tenant-owner payment settings and property operations navigation.
5. Implement Stripe test-mode checkout only after the manual flow and webhook/idempotency contract are reviewed.
6. Add refund/ledger workflows, integration/E2E coverage, English/Urdu catalogues and complete RTL support.

A successful CI workflow does not establish production readiness. Transaction-capable MongoDB deployment, index rollout, secrets configuration, rate limiting, migration, backups and tenant-isolation review remain release gates.


## Customer booking journey — initial SaaS integration

A tenant/property-scoped booking entry point is now available at `/book/{tenantSlug}/{propertySlug}`.

- Loads active room types, active rate plans and public payment instructions through the tenant/property APIs.
- Creates bookings using room type and rate plan identifiers only; client-submitted totals are never sent.
- Displays the server-calculated booking amount returned by the reservation API.
- Starts manual payment attempts with an idempotency key.
- Supports bank transfer, Easypaisa, JazzCash and cash-on-arrival when enabled for the property.
- Uploads receipt images through the private, authenticated receipt endpoint.
- Cash remains pending until staff explicitly records collection.

This is an additional SaaS route; the legacy `/booking` and `/api/bookings` flow is intentionally preserved while property-specific links and legacy migration are completed. The new route requires an authenticated customer account. Customer self-service booking history, cancellation UI, accessibility/localization polish and full E2E coverage remain follow-up work.


## Customer self-service booking history — initial integration

The legacy `/my-bookings` page now reads from `GET /api/my-bookings`, a signed-in-user-scoped endpoint that aggregates bookings across tenants and properties.

- Booking queries are restricted to the authenticated user's own records.
- Results include tenant/property labels, room type, booking state, independent payment state, and payment attempts.
- Pagination is server-side and bounded.
- Customer cancellation calls the tenant/property lifecycle endpoint for that booking; the server re-checks ownership, permission, payment state and inventory transaction rules.
- Legacy bookings remain visible with fallback labels when they do not have SaaS tenant/property metadata.

The customer self-service history integration is initial, not a replacement for staff booking operations. Receipt viewing from customer history, retry/reselection after a failed attempt, notification delivery and full browser E2E coverage remain follow-up work.


## Tenant-owner payment settings workspace — initial integration

A property-scoped owner interface is available at `/workspace/payment-settings`.

- Tenant and property are selected from the signed-in user's memberships and scoped property API.
- Owners can enable/disable bank transfer, Easypaisa, JazzCash and cash-on-arrival and configure the corresponding customer instructions.
- The UI only exposes editing controls to tenant owners; the API independently enforces `payment:manage`.
- Stripe is intentionally not exposed until test-mode checkout and signed webhook verification are implemented.
- The settings route is included in the SaaS lint workflow and has architecture regression coverage.

The workspace is an initial settings screen. Sensitive credential management, payment-provider reconciliation, subscription billing and Stripe remain separate future work.


## Property inventory workspace — initial management UI

The `/workspace/inventory` page provides a tenant/property-scoped interface for:
- Listing active room types, active rate plans and registered physical rooms.
- Creating room types with capacity, occupancy and base nightly price.
- Creating rate plans linked to a room type, with currency, nightly price, tax and stay defaults.
- Registering physical room numbers and floor/wing labels.
- Restricting create controls to tenant owners and property managers in the UI; all writes still pass through the server's tenant-scoped `inventory:manage` APIs.

This is an initial create-and-view workflow. Editing/deactivating existing inventory, availability calendar, date-based price overrides, housekeeping status operations and booking assignment UI remain outstanding.


## Booking operations and housekeeping — initial workflow

The feature branch now includes:
- `/workspace/bookings`: tenant/property-scoped reservation list, operational summary, pending-booking confirmation, physical room assignment, check-in and check-out actions.
- Check-in requires a confirmed booking, a physical room assignment and a room in `ready` status. The room transitions to `occupied` in the same MongoDB transaction.
- Check-out requires an in-house booking and an `occupied` room. The booking transitions to `checked_out` and the room transitions to `cleaning` in the same transaction.
- `/workspace/housekeeping`: room status board and allowed transitions for cleaning, ready, maintenance and out-of-service states.
- Dedicated `inventory:housekeeping` permission, granted to tenant owners and the housekeeping role; all updates remain tenant/property scoped.
- Housekeeping cannot mark a room ready or unavailable while a checked-in booking is assigned to it.
- All booking and housekeeping transitions create audit events and fail closed if MongoDB transactions are unavailable.

This is an initial operational workflow. Outstanding work includes paginated/searchable queues, arrival/departure date filtering, guest identity/contact display with privacy controls, room unassignment/reassignment, no-show handling, maintenance work orders, housekeeping task assignment, and full end-to-end browser testing. The existing customer booking and payment flows remain independent; check-in is not treated as proof of payment collection.

## Inventory calendar and room assignment operations

The operations workspace now includes a 14-day availability calendar for each active room type. The tenant/property-scoped availability endpoint:
- Requires `inventory:read` permission and validates date-only inputs.
- Limits each request to 31 days.
- Combines daily inventory counters with overlapping active bookings, so older bookings that predate inventory-day counters are not silently omitted.
- Reports total, available, reserved and blocked room counts per day.

Booking operations now allow staff to assign, reassign or unassign a physical room before check-in. Each change is transactional, tenant/property scoped and audited. Reassignment rejects rooms with overlapping active stays; unassignment is blocked after check-in. Room assignments do not change the room's housekeeping state until check-in.

Known follow-up: manual inventory blocking/unblocking, property-local timezone configuration, date-range filters and a full interactive end-to-end test suite are still outstanding.


## Date-range inventory adjustments

Tenant owners and property managers can block or release sellable room-type inventory for a selected date range. Each request:
- Requires the property-scoped `inventory:manage` permission.
- Validates room type ownership, date-only inputs, a maximum 31-day range, positive quantity and an operator reason.
- Refuses to block more rooms than are currently available, protecting reserved inventory.
- Refuses to release more rooms than are currently blocked.
- Runs all date adjustments and the audit event in one MongoDB transaction; unsupported transaction deployments fail closed.
- Accounts for overlapping legacy active bookings when first materializing inventory-day records.

This is a quantity-based inventory adjustment, not an individually reversible block record. A future operations phase should introduce first-class block records with per-block IDs, actor, reason, timestamps and partial-release history before offering granular cancellation of individual blocks.

## Booking operations: search, filters and pagination

The property-scoped booking list API supports server-side pagination (`page`, `limit`), status filtering, check-in date range filtering (`checkInFrom`, `checkInTo`) and exact booking-ID lookup (`search`).

All filters are applied after tenant and property scope is established. Non-staff users remain restricted to their own bookings. Invalid statuses, malformed dates, reversed date ranges and non-ObjectId search references are rejected rather than silently broadening the query. The operations workspace exposes these filters and keeps pagination server-side.

## First-class inventory block records

Inventory adjustments now create durable, property-scoped block records with the originating actor, date range, original quantity, remaining quantity, reason and release history. Authorized inventory readers can list a bounded set of records for their active property. Owners and property managers can partially or fully release a specific block by ID; the API updates each affected daily inventory counter and the block ledger in one MongoDB transaction, then records an audit event. The original quantity-based unblock operation remains available for compatibility with blocks created before this ledger was introduced. Full UI for browsing and releasing individual block records, integration tests against a replica-set database, and operational migration/reconciliation of legacy blocked counters remain follow-up work.

## Operational inventory and housekeeping workflows

Inventory blocks now have durable records and a property-scoped history endpoint. Authorized managers can release a specific block partially or fully, with daily inventory counters and the block ledger updated in a MongoDB transaction. The inventory workspace exposes the block history and per-record release controls.

Housekeeping tasks now support physical-room association, optional staff assignment, deadlines, open/in-progress/completed/cancelled states, completion timestamps, and actor-attributed status history. Task creation and updates require the property's housekeeping permission, validate room and assignee membership within the tenant/property boundary, and create audit events. The housekeeping workspace exposes task creation and status progression. Assignee entry currently uses the property staff directory; a searchable staff picker remains a UX follow-up. Maintenance work-order APIs and workspace are implemented. Task creation/update, audit events and room-state synchronization now share MongoDB transactions. Replica-set integration tests and end-to-end verification remain outstanding.

## Maintenance work orders

Maintenance now has property-scoped work-order APIs and a dedicated workspace. Work orders support optional physical-room association, priority (low/normal/high/urgent), assignee, deadline, status (open/in progress/blocked/completed/cancelled), completion timestamps, and actor-attributed status history. Creation and updates require inventory-management permission; room and assignee references are validated against the active tenant/property. Audit events are recorded for creation and updates. The workspace supports creation, status/priority changes, and history review. The property staff directory supplies assignees. Work-order creation/update, audit events and physical-room synchronization now share MongoDB transactions. Replica-set integration tests and end-to-end verification remain follow-up work.

Operations now expose a property-scoped staff directory containing only active tenant owners, property managers and housekeeping members authorized for the selected property. Housekeeping and maintenance workspaces use this directory for assignment instead of requiring users to manually copy member IDs.

## Unified physical-room operations timeline

A property-scoped room timeline API and workspace now consolidate overlapping bookings, housekeeping tasks, maintenance work orders and their recorded status activity by physical room. Users with inventory-read access can select a date range and inspect room-level event sequences. The endpoint validates ISO date-only bounds, caps a query window at 90 days, scopes every source query to the authorized tenant/property, excludes cancelled/no-show stays, and reports when source record limits truncate the result. The workspace is available at `/workspace/room-timeline`.

The timeline is an operational read model, not a new source of truth: booking, housekeeping and maintenance records remain authoritative in their existing domains. Staff display-name hydration, event pagination for very high-volume properties, and end-to-end/replica-set verification remain follow-up work.
Compound indexes have also been added for room-scoped booking overlap and housekeeping/maintenance due-date timeline reads so the consolidated view can scale more predictably as operational records grow.

## Shared workspace experience and product identity

A shared responsive workspace shell now wraps all `/workspace/*` routes. It provides consistent desktop sidebar navigation, mobile navigation, active-route indication and a unified content frame for bookings, room timeline, inventory, housekeeping, maintenance and payments. Workspace routes no longer render the legacy public-site navbar/footer. Application metadata has been changed from single-resort marketing copy to hospitality SaaS product positioning.

This is the first UX consistency layer, not the completed visual redesign. Remaining UI/UX work includes a true workspace overview/dashboard, consistent page headers and KPI patterns, table/filter/form component system, skeleton/empty/error states, accessible dialogs and confirmations, mobile workflow testing, dark mode, English/Urdu catalogues and RTL, and a redesigned SaaS public landing page. The existing root homepage still contains legacy single-property marketing content and must be redesigned before public product presentation.

## Deployment and preview decision

GitHub Pages is not a suitable runtime for this application: it depends on Next.js server routes, authenticated sessions, MongoDB, private receipt uploads and payment webhooks. The application needs a server-capable deployment (for example Vercel or a Node/container host) with a transaction-capable MongoDB deployment and private object storage. GitHub Pages may host static documentation only, not the functioning SaaS platform. Public deployment is intentionally deferred until core workflows, security review, migrations, secrets, backup/restore and production CI acceptance are complete.
Room readiness now fails closed inside a MongoDB transaction when a physical room still has open/in-progress housekeeping tasks or open/in-progress/blocked maintenance work orders. The existing lifecycle also prevents staff from overriding active guest stays and booking assignments through the housekeeping status endpoint. This keeps manual room-state changes aligned with operational work rather than allowing a room to be marked ready prematurely.

## Transactional room-state synchronization

Housekeeping task and maintenance work-order creation and updates now run their source-record mutation, audit event and physical-room status reconciliation inside one MongoDB transaction. Outstanding maintenance work takes precedence and marks a non-occupied, non-out-of-service room as maintenance; otherwise active housekeeping work marks it cleaning. When no operational work remains, cleaning/maintenance rooms can return to ready. Occupied and out-of-service states are preserved, and every derived room-state transition is audit logged.

Booking check-in now fails closed while the assigned room has open/in-progress housekeeping or open/in-progress/blocked maintenance work. Check-out reconciles the room against remaining operational work in the same booking transaction, avoiding a blind transition to cleaning when maintenance is still outstanding. These workflows use the existing MongoDB transaction requirement; replica-set integration and E2E verification remain necessary before production.
Guest check-out now automatically creates an unassigned "Post-checkout room cleaning" housekeeping task in the same booking transaction. The room therefore remains in cleaning until the turnover task is completed; outstanding maintenance continues to take precedence. The generated task and room-state transition are both audit logged.
The room operations timeline now resolves assigned staff display names for housekeeping and maintenance events using only user IDs referenced by records already scoped to the selected tenant and property. The workspace displays the responsible team member alongside each operational event; unrelated users are not queried or exposed.
## Operational workspace usability

Housekeeping now includes client-side task search (title, description, room and assignee), status filtering, total/active/overdue workload indicators, and an explicit empty-filter state. Maintenance now includes search across work-order title, description, room and assignee, status and priority filters, plus total/active/overdue KPIs. These controls filter the tenant/property-scoped records already returned by the APIs; the existing API response cap remains in place, so server-side filtering and pagination are a later scale improvement.

The checkout turnover task is created from the booking stay transition after the booking is saved, within the same MongoDB transaction. It is not part of physical-room assignment or unassignment. This keeps the automatic cleaning workflow tied to the actual guest check-out event.
