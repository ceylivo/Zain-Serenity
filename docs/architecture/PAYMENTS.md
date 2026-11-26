# Payment Architecture

This document describes the tenant-scoped payment workflow currently implemented in the SaaS foundation.

## Principles

- Booking state and payment state are independent.
- The server derives the payable amount from the persisted booking; clients cannot submit an amount.
- A payment attempt belongs to one tenant, property, booking and customer.
- Idempotency keys protect retries. A partial unique index permits only one active payment attempt per booking.
- Manual transfers are not marked paid until a receipt is submitted and an authorized property staff member verifies it.
- Cash on arrival is not collected until authorized staff explicitly records receipt of cash.
- Payment verification, rejection, settings changes and attempt creation are written to the audit log.
- Refunds are intentionally not implemented in this phase. Paid bookings cannot be cancelled through the unpaid-booking cancellation path.

## Supported payment methods

| Method | Current behaviour |
|---|---|
| Bank transfer | Customer creates an attempt, uploads a private receipt image, staff verifies or rejects it |
| Easypaisa | Same manual verification workflow |
| JazzCash | Same manual verification workflow |
| Cash on arrival | Customer selects the method; staff explicitly records cash collection |
| Stripe | Not enabled yet. No simulated or live charge is created |

Stripe must remain disabled until a separate test-mode integration is implemented and reviewed. Live mode requires separate explicit approval.

## Tenant and property configuration

PUT /api/tenants/:tenantSlug/properties/:propertySlug/payment-settings

Only a tenant owner can configure payment methods. The request accepts an enabledMethods array and method-specific public payment instructions. Bank transfer requires a bank name, account title, and account number or IBAN. Easypaisa and JazzCash require an account title and account number.

GET /api/tenants/:tenantSlug/properties/:propertySlug/payment-settings

Returns the configured payment methods and payment instructions for an active property. Do not store API secrets, passwords, private keys or bank portal credentials in these public instructions.

## Customer payment flow

1. POST /api/tenants/:tenantSlug/properties/:propertySlug/payments
   - Requires an authenticated customer.
   - JSON: { "bookingId": "...", "method": "bank_transfer" }
   - Requires an Idempotency-Key header (8–128 characters).
   - Amount and currency are loaded from the booking.
2. For bank transfer, Easypaisa or JazzCash:
   - POST /api/tenants/:tenantSlug/properties/:propertySlug/payments/:paymentId/receipt
   - Multipart form with file (JPEG, PNG or WebP, maximum 5 MB) and optional reference.
   - Receipt is uploaded to Cloudinary using authenticated/private delivery.
3. The payment moves to pending_verification.
4. Staff verifies or rejects it:
   - POST /api/tenants/:tenantSlug/properties/:propertySlug/payments/:paymentId/verify
   - JSON: { "outcome": "succeeded" } or { "outcome": "failed" }.
5. For cash on arrival, staff records collection:
   - POST /api/tenants/:tenantSlug/properties/:propertySlug/payments/:paymentId/collect-cash

Customers can list their own payment attempts with GET /api/tenants/:tenantSlug/properties/:propertySlug/payments. Staff with payment:read can list property payment attempts.

## Receipt access

Receipt uploads are restricted to the customer who owns the pending manual payment. The server checks file size and image signatures, stores only a Cloudinary public identifier in MongoDB, and never returns a public delivery URL. Receipt access is authorized for the booking owner or staff with payment:read; the API returns a short-lived private download URL (five minutes).

Cloudinary must be configured with the existing CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET environment variables. Private/authenticated delivery must be enabled for the Cloudinary account.

## Payment state transitions

- pending → pending_verification → succeeded
- pending → pending_verification → failed
- pending → succeeded for cash only after staff records collection
- A failed attempt becomes inactive; a customer may create a new attempt.
- A succeeded attempt is immutable through these endpoints.

Booking paymentStatus is updated independently (unpaid, pending, failed, paid, or partially_paid). Partial collection and refunds are not exposed as customer actions in this phase.

## Operational prerequisites and limitations

- MongoDB must run as a replica set or sharded cluster for transactional payment operations.
- MongoDB indexes must be built before enabling payment traffic; in particular, the unique active-attempt index prevents concurrent duplicate attempts.
- Configure each property's payment instructions before enabling its corresponding method.
- Staff permissions are checked server-side for payment verification and cash collection.
- The current implementation does not initiate external provider charges, process payment webhooks, issue refunds, or reconcile bank statements.


## Operations workspace

An initial tenant-scoped staff payment review screen is available at `/workspace/payments`.

- It loads the signed-in user's active tenant memberships from `GET /api/tenants`.
- It loads properties only through the tenant-scoped properties endpoint.
- It lists payment attempts through the property payment API; staff access is controlled by the server-side `payment:read` permission.
- Manual receipt verification/rejection and cash collection call the existing permission-protected mutation endpoints.
- Receipt viewing requests the short-lived authorized receipt URL; the page does not store receipt URLs.
- The screen is an initial operations UI, not a complete tenant dashboard. Payment settings, refunds, reconciliation, customer-side payment selection and full role-aware navigation remain follow-up work.
