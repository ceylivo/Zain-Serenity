# Zain Serenity — SaaS Transformation Plan

> Development workspace: `ceylivo/Zain-Serenity`  
> Final destination: `zainshah3464/Zain-Serenity`  
> Status: Phase 0 — repository audit and architecture validation

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
