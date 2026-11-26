import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = async (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

test("tenant identity has a unique, validated slug", async () => {
  const model = await source("../../src/models/Tenant.ts");
  assert.match(model, /TenantSchema\.index\(\{ slug: 1 \}, \{ unique: true \}\)/);
  assert.match(model, /primaryOwnerId:[\s\S]*required: true/);
  assert.match(model, /enum: \["active", "suspended", "pending", "archived"\]/);
});

test("property uniqueness is scoped to its tenant", async () => {
  const model = await source("../../src/models/Property.ts");
  assert.match(model, /tenantId:[\s\S]*required: true[\s\S]*immutable: true/);
  assert.match(model, /PropertySchema\.index\(\{ tenantId: 1, slug: 1 \}, \{ unique: true \}\)/);
});

test("memberships cannot duplicate a user's tenant membership", async () => {
  const model = await source("../../src/models/Membership.ts");
  assert.match(model, /MembershipSchema\.index\(\{ tenantId: 1, userId: 1 \}, \{ unique: true \}\)/);
  assert.match(model, /status: \{[\s\S]*enum: \["invited", "active", "suspended", "revoked"\]/);
});

test("property access fails closed when a staff member has no assignment", async () => {
  const access = await source("../../src/lib/tenantAccess.ts");
  assert.match(access, /membership\.role !== "tenant_owner"[\s\S]*!assignedProperties\.some/);
  assert.match(access, /tenantId: tenant\._id,[\s\S]*slug: input\.propertySlug/);
});

test("tenant creation derives owner identity from the authenticated session", async () => {
  const route = await source("../../src/app/api/tenants/route.ts");
  assert.match(route, /getServerSession\(authOptions\)/);
  assert.match(route, /primaryOwnerId: userId/);
  assert.match(route, /role: "tenant_owner"/);
  assert.doesNotMatch(route, /primaryOwnerId:\s*body\./);
});

test("property creation scopes the new property to resolved server-side tenant context", async () => {
  const route = await source("../../src/app/api/tenants/[tenantSlug]/properties/route.ts");
  assert.match(route, /resolveTenantAccess\(/);
  assert.match(route, /tenantId: access\.tenantId/);
  assert.match(route, /permission: "property:create"/);
  assert.doesNotMatch(route, /tenantId:\s*body\./);
});
