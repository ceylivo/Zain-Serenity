# Security Boundaries

## Authentication is not authorization

A valid NextAuth session establishes a user identity only. It does not imply platform, tenant or property permissions.

## Tenant request flow

1. Authenticate the session.
2. Resolve tenant from a verified domain/route mapping.
3. Load an active membership for the authenticated user and tenant.
4. Resolve the requested property under that tenant.
5. Enforce property assignment restrictions.
6. Check the named permission for the operation.
7. Query or mutate with tenant and property predicates included.
8. Record sensitive operations in the audit log.

## Rules

- Never accept tenantId, propertyId, role, price, payment state or verification state from the client as authorization/financial truth.
- Frontend route guards are UX, not a security boundary.
- Never query tenant-owned collections by resource ID alone.
- Never expose payment evidence through public media URLs.
- Never grant platform-wide access because a legacy user has role admin.
- Fail closed when tenant membership or property context cannot be established.
- Keep secrets out of Git, logs, browser bundles and API error responses.
- Use request-size limits, schema validation, idempotency, safe logging and shared rate limiting on mutations.
- Sensitive staff and financial actions require actor attribution and audit history.

## Current implementation boundary

The initial tenant resolver and permission helpers are building blocks. Existing public/admin endpoints have not yet been migrated to them. Until migration is complete, this branch is not ready for production multi-tenant traffic.
