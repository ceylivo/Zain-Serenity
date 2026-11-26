import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("public property resolution requires an active tenant and active property", async () => {
  const resolver = await read("../../src/lib/publicProperty.ts");
  assert.match(resolver, /Tenant\.findOne\(\{ slug: input\.tenantSlug \}\)/);
  assert.match(resolver, /tenant\.status !== "active"/);
  assert.match(resolver, /tenantId: tenant\._id,[\s\S]*slug: input\.propertySlug,[\s\S]*status: "active"/);
});

test("authenticated guests can create bookings without tenant staff membership", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/route.ts");
  const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function GET"));
  assert.match(post, /resolvePublicProperty\(/);
  assert.match(post, /createInventoryBooking\(/);
  assert.doesNotMatch(post, /resolveTenantAccess\(/);
  assert.doesNotMatch(post, /body\.tenantId|body\.propertyId|body\.totalPrice/);
});

test("guest booking reads are restricted to the signed-in user's own bookings", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/route.ts");
  assert.match(route, /if \(!canReadAll\) filter\.userId = session\.user\.id/);
  assert.match(route, /permission: "booking:read"/);
});

test("public catalogue returns active room types and active rate plans only", async () => {
  const roomTypes = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/room-types/route.ts");
  const ratePlans = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/rate-plans/route.ts");
  assert.match(roomTypes, /status: "active"/);
  assert.match(ratePlans, /isActive: true/);
  assert.match(roomTypes, /resolvePublicProperty\(/);
  assert.match(ratePlans, /resolvePublicProperty\(/);
});
