# Phase 0 — Extended Audit Notes and Architecture Decisions

**Branch:** `work/phase-0-audit`  
**Source:** `zainshah3464/Zain-Serenity` at `ce4f50c1708d34528f150431aaa33219b390f635`  
**Status:** Static source review; runtime validation pending.

## 1. Additional verified findings

### Authentication and account lifecycle
- `src/app/api/auth/[...nextauth]/route.ts` uses NextAuth v4 JWT sessions, Google OAuth, and credentials authentication.
- Credentials login requires email verification and checks bcrypt password hashes.
- Google sign-in creates a global customer user by email when absent.
- The sign-in callback sends welcome/login email and updates `lastLogin`.
- `src/app/api/auth/register/route.ts` stores a raw verification token and expiry on the User document.
- `src/app/api/auth/forgot-password/route.ts` stores a raw reset token and expiry.
- `src/app/api/auth/reset-password/route.ts` consumes the reset token but does not visibly invalidate existing sessions.
- `src/app/api/auth/verify/route.ts` manually creates a NextAuth JWT cookie instead of using the supported sign-in callback flow. Cookie naming/secure behavior can diverge from NextAuth configuration, especially with secure cookie prefixes and custom settings.
- Registration checks for an existing email before create; the unique index is the final concurrency guard, but duplicate-key errors are not normalized.
- Password minimum length is six characters in current endpoints. Policy and abuse protection should be strengthened consistently.

### Booking and public APIs
- `src/app/api/bookings/route.ts` has no request schema parser or body-size guard visible in the handler.
- The POST endpoint trusts browser-supplied `totalPrice`, accepts loosely typed fields, and performs a non-atomic availability check followed by create.
- Admin booking GET has no pagination and enriches every booking in memory.
- `src/app/api/rooms/route.ts` loads room records before pagination, uses `any` for filters, does not visibly validate page/limit/date ranges, and queries reviews in a loop.
- `src/app/api/reviews/route.ts` requires a session and prevents duplicate user+room reviews with a pre-check, but no unique compound index was visible in the Review model.
- `src/app/api/gallery/route.ts` accepts a category filter without a visible allowlist and returns all matching records without pagination.
- `src/app/api/contact/route.ts` has no visible rate limit, request-size limit, or runtime schema validation. User-controlled content is inserted into HTML email.
- API error handling is inconsistent; some handlers may leak Mongoose or provider error messages.

### Admin operations
- Admin API handlers repeatedly implement the same coarse role check rather than a centralized permission policy.
- `src/app/api/admin/rooms/route.ts` spreads request data into Mongoose create.
- `src/app/api/admin/rooms/[id]/route.ts` accepts request body directly in update and exposes hard delete.
- `src/app/api/admin/users/[id]/route.ts` allows role and verification updates without a granular permission model; delete has no visible self-delete or owner-protection policy.
- `src/app/api/admin/users/route.ts` returns all users in one response.
- `src/app/api/admin/upload/route.ts` and `src/app/api/admin/gallery/route.ts` buffer uploaded files fully in memory and do not visibly validate magic bytes, maximum size, or image dimensions before Cloudinary upload.
- `src/app/api/admin/gallery/[id]/route.ts` deletes a database record; storage asset cleanup behavior needs review.
- `src/app/api/admin/dashboard/route.ts` and `src/app/api/admin/stats/route.ts` use global queries with no tenant boundary. They treat non-cancelled booking totals as revenue even though there is no payment ledger to establish that funds were received.
- Dashboard code contains multiple per-record lookups and potentially unbounded reads. Analytics must be tenant-scoped and bounded.

### Frontend and product claims
- `src/app/layout.tsx` hardcodes a single property identity, domain, metadata, English language, and light color scheme.
- `src/app/globals.css` defines a light-only global palette; there is no real theme preference/provider visible in the inspected root layout.
- `src/components/PublicLayoutWrapper.tsx` renders one shared public navbar/footer and bypasses them for admin routes. Tenant-specific public rendering will need a tenant context.
- `src/components/Providers.tsx` sends the authenticated user's database ID to Google Analytics as user_id and a custom property. Review privacy/consent requirements; do not send email, name, or other direct identifiers to analytics.
- The README describes the existing product as a single luxury coastal resort and claims "real-time availability management" and "revenue tracking". The current source-level availability flow is not concurrency-safe, and booking totals are not proof of collected revenue. README claims must be revised to distinguish implemented functionality from roadmap/planned SaaS capabilities.
- The README includes narrative claims about global resort rankings and property/location details. Treat these as marketing claims requiring owner verification, not verified technical facts.

## 2. Authorization matrix — current versus target

| Actor | Current implementation | Target permission boundary |
|---|---|---|
| Anonymous visitor | Public pages, rooms, gallery, contact | Public tenant/property catalogue only; strict public DTOs |
| Customer | Own bookings via session user ID; submit reviews | Own profile, own bookings/payments/evidence, permitted reviews; tenant context explicit |
| Legacy admin | Global admin role sees/changes all resources | Must be mapped to explicit tenant membership; no implicit platform-wide access |
| Tenant Owner | Not represented | Full control within owned tenant; manage properties, staff, settings, finance |
| Property Manager | Not represented | Manage assigned property operations, not tenant billing/ownership |
| Booking Manager | Not represented | Booking/inventory/customer operations only |
| Payment Verifier | Not represented | Verify manual payments, record cash collection, no tenant ownership changes |
| Receptionist | Not represented | Front desk check-in/out and permitted booking lookup |
| Platform Support | Not represented | Explicitly scoped support access, reason required, audited, time-bound where possible |
| Platform Owner | Not represented | Platform administration, tenant lifecycle, platform-level configuration |

The existing `admin` role must not be silently interpreted as a new global Platform Owner. A deliberate bootstrap/mapping process is required.

## 3. Recommended initial domain model

Recommended baseline for the SaaS domain:

1. **Tenant** — commercial organization/account, status, plan, primary owner reference.
2. **Property** — independently branded/operated hotel, resort, or guesthouse; belongs to exactly one tenant; timezone, locale, currency, address, policies.
3. **User** — global identity; no tenant-specific authorization stored as a single role.
4. **Membership** — user-to-tenant membership, role, status, invitation lifecycle.
5. **PropertyAssignment** — optional property-specific access grants for staff who should not see every property in a tenant.
6. **RoomType** — sellable accommodation category and guest-facing description/rate defaults.
7. **InventoryUnit** — physical room/unit assigned to a RoomType; supports unit-level maintenance and assignment.
8. **InventoryDay** — date-scoped sellable capacity/reserved count or equivalent atomic inventory record.
9. **RatePlan** — currency, pricing rules, occupancy, weekday/seasonal pricing, cancellation and inclusion policies.
10. **Booking** — tenantId, propertyId, guest, selected room type/unit, dates, immutable quote snapshot, lifecycle state.
11. **BookingEvent** — append-only booking history.
12. **Payment** — payment intent/obligation separate from booking.
13. **PaymentAttempt** — provider/manual attempt, idempotency and provider references.
14. **PaymentEvidence** — private uploaded transfer receipt and verification state.
15. **PaymentEvent / LedgerEntry** — append-only financial transitions and accounting facts.
16. **Refund** — amount, reason, provider/manual status, actor.
17. **PaymentMethodConfig** — tenant/property enabled methods and safe display instructions; never store provider secret keys here.
18. **MediaAsset** — tenant/property ownership, visibility class, provider public ID, metadata.
19. **Review** — tenant/property/booking/guest scope, moderation state.
20. **AuditLog** — tenant/property, actor, action, resource, safe metadata, timestamp, correlation ID.
21. **Notification / NotificationDelivery** — tenant-scoped communication and delivery attempts.
22. **TenantSubscription** — later platform SaaS billing, explicitly separate from guest booking payments.

### Inventory strategy

Do not treat each sellable category as a single physical room. The recommended target supports both room-type inventory and assignment of a physical unit:
- Guests book a room type for dates.
- Availability is derived from sellable inventory for every night in the stay.
- Front desk can assign a physical unit before arrival or at check-in.
- Maintenance blocks a unit or capacity for selected dates.
- Inventory reservation must be atomic under concurrent booking attempts.

The exact atomic reservation implementation depends on verified MongoDB topology. A unique per-property/room-type/date inventory record with an atomic conditional update is a candidate; transactions may be needed to coordinate multiple nights and booking/payment records. Never assume standalone MongoDB supports multi-document transactions.

## 4. Tenant routing recommendation

Use a tenant resolution service with explicit precedence:
1. Verified custom domain mapping (exact normalized hostname lookup).
2. Configured tenant subdomain on the platform's trusted base domain.
3. A path-based tenant route for preview/development and fallback.

Do not trust arbitrary `Host`, `X-Forwarded-Host`, or client-supplied tenant IDs. The host must be normalized and checked against trusted proxy/deployment configuration. A resolved tenant is not authorization by itself; membership/property permission checks still apply.

The first property can use a configured canonical domain, but the application must not contain hard-coded Zain's Serenity tenant IDs or bypass tenant isolation for it.

## 5. Migration and bootstrap strategy

- Create a new schema version and deterministic bootstrap command.
- Seed a platform owner only through a secure one-time environment-controlled bootstrap process; never commit a default password.
- Create the first tenant and its first property through an explicit seed/config command.
- Map the legacy admin account to the first tenant owner only after verifying the intended account identity.
- Existing records may be ignored for product compatibility, but production data is never dropped automatically.
- Add preflight checks, dry-run mode, backup requirement, migration log, and rollback guidance for any destructive migration.
- New tenant-owned records must be created only through services that inject trusted tenant/property context.

## 6. Security and privacy notes

- Store password reset and email verification token hashes, not raw tokens; consume tokens atomically and expire them.
- Invalidate/revoke sessions after password reset and sensitive account changes.
- Use a shared rate-limit backend; trust forwarded IP headers only when set by the configured trusted proxy.
- Validate request JSON/form-data with schemas, bound payload sizes, and return safe error DTOs.
- Escape all user-controlled email content and validate links/URLs.
- Use private object storage for payment evidence; a public Cloudinary URL is not an acceptable receipt privacy model.
- Verify upload file signatures, file limits, image decode, and allowed formats.
- Add CSRF/origin protections appropriate to cookie-authenticated mutations.
- Use idempotency for booking creation, payment creation, and webhook processing.
- Never use client-supplied tenantId, propertyId, price, role, payment status, or verification status as authoritative.
- Review GA4 identity tracking and consent. Use pseudonymous analytics identifiers only where lawful and configured; never send direct personal information.

## 7. Phase 0 remaining work

- [x] Read README and compare advertised claims with source behavior.
- [x] Inspect all named API route families and core authentication handlers.
- [x] Record authorization, payment, upload, analytics, and tenant-isolation risks.
- [ ] Review all page/component flows, forms, client-side API usage, and admin navigation.
- [ ] Review all config and deployment assumptions, including Vercel/hosting and MongoDB topology (requires owner-provided non-secret details).
- [ ] Establish local baseline with install, lint, typecheck, and build (requires full checkout; not possible from GitHub-only source inspection).
- [ ] Finalize tenant URL strategy, property/room inventory model, currency/timezone and cancellation defaults.
- [ ] Publish final implementation file map and Phase 1 test plan.

## 8. Owner-provided deployment facts needed before booking concurrency implementation

Please provide only non-secret facts:
- Is production MongoDB hosted on MongoDB Atlas? If yes, is it a replica set / Atlas cluster?
- Is the app deployed on Vercel, and are serverless functions used?
- Does one property represent one physical room per listing today, or do you sell multiple rooms under one room category (e.g. 8 Deluxe Rooms)?

Do not paste database URIs, passwords, OAuth secrets, Cloudinary secrets, Stripe secrets, or production tokens into chat or GitHub.
