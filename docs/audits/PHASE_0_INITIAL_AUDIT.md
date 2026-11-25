# Phase 0 — Repository Audit (Initial Evidence)

**Audit date:** 2026-11-26  
**Source repository:** `zainshah3464/Zain-Serenity`  
**Development workspace:** `ceylivo/Zain-Serenity`  
**Source default branch:** `main`  
**Source tree snapshot:** `ce4f50c1708d34528f150431aaa33219b390f635`  
**Audit status:** In progress — structural inventory and core-path review complete; full page/component and deployment review remains.

## 1. Repository and stack snapshot

The source tree contains 228 Git tree entries (including directories and binary assets). The project is a Next.js App Router application.

Verified from `package.json`:
- Next.js 16.3.1
- React / React DOM 19.2.8
- TypeScript 5.x
- Tailwind CSS 4
- MongoDB via Mongoose 9.9.2
- NextAuth 4.24.15
- bcryptjs 3.0.3
- Cloudinary 2.10.0
- Nodemailer 7.0.13
- Framer Motion 13.1.0
- Three.js 0.185.1 and React Three Fiber 9.7.0
- Recharts 3.10.1
- ESLint 9

Current scripts are only `dev`, `build`, `start`, and `lint`. There are no configured test, typecheck, or CI scripts in package.json.

## 2. Structural inventory

### Public App Router pages
- `src/app/page.tsx`
- `src/app/about/page.tsx`
- `src/app/rooms/page.tsx`
- `src/app/rooms/[id]/page.tsx`
- `src/app/booking/page.tsx` and `BookingContent.tsx`
- `src/app/gallery/page.tsx`
- `src/app/contact/page.tsx`
- `src/app/login/page.tsx` and `LoginContent.tsx`
- `src/app/register/page.tsx`
- `src/app/forgot-password/page.tsx`
- `src/app/reset-password/page.tsx` and `ResetPasswordContent.tsx`
- `src/app/my-bookings/page.tsx`
- `src/app/not-found.tsx`

### Admin pages
- `src/app/admin/(public)/login/page.tsx`
- `src/app/admin/(public)/layout.tsx`
- `src/app/admin/(private)/layout.tsx`
- `src/app/admin/(private)/page.tsx`
- `src/app/admin/(private)/bookings/page.tsx`
- `src/app/admin/(private)/rooms/page.tsx`
- `src/app/admin/(private)/rooms/new/page.tsx`
- `src/app/admin/(private)/rooms/[id]/edit/page.tsx`
- `src/app/admin/(private)/users/page.tsx`
- `src/app/admin/(private)/gallery/page.tsx`

### API route inventory
- Authentication: `src/app/api/auth/[...nextauth]/route.ts`, `register`, `verify`, `forgot-password`, `reset-password`
- Guest booking: `src/app/api/bookings/route.ts`
- Public room/review/gallery/contact: `rooms`, `reviews`, `gallery`, `contact`
- Admin booking: `src/app/api/admin/bookings/[id]/route.ts`
- Admin rooms: `src/app/api/admin/rooms/route.ts`, `[id]/route.ts`, `stats/route.ts`
- Admin users: `src/app/api/admin/users/route.ts`, `[id]/route.ts`
- Admin gallery: `src/app/api/admin/gallery/route.ts`, `[id]/route.ts`
- Admin uploads: `src/app/api/admin/upload/route.ts`
- Admin reporting: `src/app/api/admin/dashboard/route.ts`, `stats/route.ts`
- Admin account verification: `src/app/api/admin/verify-user/route.ts`

### Models
- `src/models/User.ts`
- `src/models/Room.ts`
- `src/models/Booking.ts`
- `src/models/Review.ts`
- `src/models/GalleryImage.ts`

### Shared libraries
- `src/lib/dbConnect.ts`
- `src/lib/bookingValidation.ts`
- `src/lib/checkAvailability.ts`
- `src/lib/rateLimiter.ts`
- `src/lib/emailTemplates.ts`
- `src/lib/ga4.ts`

### Shared UI
- Public components under `src/components/`, including Navbar, Footer, RoomCard, RoomDetailContent, SearchBar, ReviewForm, Gallery, Providers, and public layout wrappers.
- Admin components under `src/components/admin/`, including AdminDashboard, AdminSidebar, AdminTopbar, dashboard widgets, modal, and loading/animation components.
- Global styling: `src/app/globals.css`
- Root layout: `src/app/layout.tsx`

### Static assets
The source includes property imagery, gallery photos, screenshots, favicon assets, a 3D bedroom model, and a hero video under `public/`. These assets should be inventoried and retained where licensing/tenant branding permits; avoid copying private or unnecessary binaries into implementation commits.

## 3. Confirmed high-priority findings

| Severity | Path | Evidence / risk | Required direction |
|---|---|---|---|
| Critical | `src/app/api/bookings/route.ts` | POST accepts `totalPrice` from the browser and saves it as authoritative price. | Derive price server-side from property rate plans, dates, occupancy, taxes, discounts, and currency. Ignore client totals. |
| Critical | `src/lib/checkAvailability.ts`, `src/app/api/bookings/route.ts` | Availability is checked before a separate create call. Concurrent requests can both pass. | Design inventory reservation with atomic concurrency control; verify MongoDB deployment/transaction topology. |
| Critical | `src/app/api/admin/rooms/route.ts`, `src/app/api/admin/rooms/[id]/route.ts` | Create spreads request body; update passes request body directly to Mongoose. | Strict schemas and field allowlists; prohibit mass assignment and tenant-owned field injection. |
| Critical | `src/app/api/admin/users/[id]/route.ts` | User role is changed through a request body with no explicit role allowlist beyond model behavior; global admin/customer role model. | Central permission service, tenant membership roles, platform/tenant role separation, protected self/owner operations. |
| High | `src/lib/rateLimiter.ts` | Process-local Map and interval timer do not coordinate across instances and are not durable. | Shared-store limiter with explicit fail-open/fail-closed policy per route. |
| High | `src/app/api/admin/upload/route.ts` | File is fully buffered with no visible byte-size or actual content signature validation. | Enforce request and file limits, inspect magic bytes, constrain formats, private storage for sensitive evidence. |
| High | `src/app/api/auth/register/route.ts` | Email/name fields are interpolated into HTML email without visible escaping; input parsing is weak. | Runtime schema validation, canonical email normalization, HTML escaping, safe URL construction, generic errors. |
| High | `src/app/api/contact/route.ts` | User-provided name/email/message are interpolated into HTML; no visible request-size or rate limit. | Escape HTML and headers, validate fields, rate limit and bound body size. |
| High | `src/app/api/auth/verify/route.ts` | Verification creates a session cookie manually and token lookup is email + raw token. | Rework verification as a one-time hashed token flow and use supported NextAuth session lifecycle. |
| High | `src/app/api/bookings/route.ts` | Admin GET returns all bookings without pagination; customer/admin DTOs are hand-built. | Tenant-scoped pagination and explicit response DTOs. |
| High | `src/app/api/admin/users/route.ts` | Returns all users without pagination. | Paginated, tenant-scoped list with minimal DTO. |
| High | `src/app/api/rooms/route.ts` | Fetches reviews inside a loop (N+1); loads all rooms before pagination; weak query parameter validation. | Aggregation/precomputed ratings, DB-side filtering/pagination, validated date inputs. |
| High | `src/app/api/admin/dashboard/route.ts` | Large dashboard handler performs repeated per-booking/per-room/per-user queries and global aggregates. | Tenant-scoped analytics services, bounded queries, aggregation pipelines and caching. |
| High | `src/app/api/admin/stats/route.ts` | Global aggregate queries are not tenant-scoped; revenue sums booking totals irrespective of payment collection. | Tenant-scoped financial ledger and recognized/collected revenue semantics. |
| High | Models under `src/models/` | User, Room, Booking, Review and GalleryImage have no tenant/property ownership. | Tenant and property ownership model plus compound indexes and scoped repositories. |
| Medium | `src/app/layout.tsx`, `src/app/globals.css` | Root layout hardcodes one property brand, English language, light color scheme and resort metadata. | Tenant-driven branding/metadata, theme provider, locale routing and RTL direction. |
| Medium | `package.json` | No test/typecheck/CI scripts. | Unit/integration/E2E tooling and CI gates after baseline compatibility review. |

## 4. Current authorization model

Observed model:
- User role enum: `admin` or `customer`.
- Admin API routes commonly call `getServerSession(authOptions)` and compare `session.user.role === "admin"`.
- The private admin layout uses a client-side session gate; this is not sufficient as the authorization boundary for APIs or server actions.
- There is no tenant membership or property permission model in the inspected schemas.

Target:
- Platform-level role and tenant/property-level membership are separate concepts.
- Resolve active tenant/property context on the server, then authorize every read/write against it.
- Deny by default and use centralized named permissions.
- Client navigation guards are UX only; every backend operation must independently authorize.

## 5. Data model direction

Proposed domain entities (final field design follows inventory and workflow audit):
- Tenant
- Property
- User (global identity)
- Membership (user ↔ tenant, with tenant role and status)
- PropertyMembership or scoped assignments (where staff access is property-limited)
- RoomType / Unit / InventoryUnit (granularity decision pending)
- RatePlan / Availability / InventoryReservation
- Booking
- BookingEvent
- Payment / PaymentAttempt / PaymentEvent / PaymentEvidence / Refund
- PaymentMethodConfiguration
- Review
- MediaAsset
- Notification / NotificationDelivery
- AuditLog
- TenantSubscription (later, separate from guest payments)

All tenant-owned data must have tenant scope; property-owned data must also have property scope. Unique constraints and indexes must include tenant scope where identifiers are tenant-local.

## 6. Booking and money-domain risks

Current booking state is only pending/confirmed/cancelled. Payment status is not represented independently. Current dashboard treats booking total as revenue, which can overstate cash collected when payment is pending or unpaid.

Target separation:
- Booking state: draft, pending_payment, pending_verification, confirmed, checked_in, checked_out, completed, cancelled, expired, no_show.
- Payment state: unpaid, requires_action, pending, pending_verification, authorized, paid, partially_refunded, refunded, failed, rejected, cancelled, expired.
- Ledger/event records are auditable and append-only for financial transitions.
- Cash collection requires a staff record; choosing cash on arrival is not a receipt.
- Stripe webhooks require signature verification and idempotent processing. Start with test credentials only.

## 7. Environment/configuration audit status

Names and usage observed so far:
- `MONGODB_URI`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `EMAIL_USER`
- `EMAIL_PASS`
- `NEXT_PUBLIC_BASE_URL`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `NEXT_PUBLIC_GA_ID`

No `.env.example` or CI workflow appeared in the inspected root tree. This must be rechecked against all branches/deployment settings before declaring the inventory final. Never copy actual secret values into Git.

## 8. Decisions still requiring evidence before implementation

1. **Inventory granularity:** one physical room per booking versus room-type inventory with assignable units. This affects concurrency and availability.
2. **MongoDB topology:** verify Atlas/replica-set support before relying on multi-document transactions. Design a safe fallback if deployment is standalone.
3. **Tenant URL strategy:** subdomain, custom domain, or path-based tenant routing; support custom domains without trusting arbitrary Host headers.
4. **Property settings:** timezone, locale, currency, taxes, check-in/out times, cancellation policy, and pricing model.
5. **Storage:** whether room/gallery assets can remain public while identity documents/payment receipts require private access.
6. **Deployment:** hosting platform, serverless/runtime constraints, background job mechanism, and shared rate-limit store.
7. **Identity:** whether Google sign-in remains available for guest users and whether staff invitations are email-based.
8. **Data cutover:** existing records need not be preserved as a product requirement, but production reset is prohibited without a separately approved, backed-up operation.

## 9. Phase 0 completion checklist

- [x] Source repository and default branch verified.
- [x] Full Git tree inventory retrieved (228 entries).
- [x] Package/runtime versions and scripts inspected.
- [x] Core models and shared booking/security helpers inspected.
- [x] Primary booking, auth, admin and public API handlers inspected.
- [x] Initial critical-risk register documented.
- [ ] All remaining route handlers reviewed in full.
- [ ] All page and component flows reviewed.
- [ ] README/product claims and environment/deployment assumptions reviewed.
- [ ] Authentication and permission matrix completed.
- [ ] Inventory and MongoDB concurrency design finalized.
- [ ] Final implementation file map and migration/seed plan approved.
- [ ] Local build/lint/typecheck/test baseline run against a full checkout.

## 10. Important audit limitation

This audit is based on GitHub source inspection. No local checkout, dependency installation, environment secrets, live MongoDB topology, deployment settings, or production runtime has been accessed. Therefore no build, lint, tests, integration tests, or production behavior are claimed as verified. The original repository remains unchanged.
