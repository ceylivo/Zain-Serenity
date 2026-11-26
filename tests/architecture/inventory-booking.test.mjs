import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("room type and physical room inventory are tenant/property scoped", async () => {
  const roomType = await read("../../src/models/RoomType.ts");
  const physicalRoom = await read("../../src/models/PhysicalRoom.ts");
  const inventory = await read("../../src/models/InventoryDay.ts");
  assert.match(roomType, /tenantId:[\s\S]*required: true/);
  assert.match(roomType, /inventoryCount:[\s\S]*required: true/);
  assert.match(physicalRoom, /tenantId:[\s\S]*required: true/);
  assert.match(physicalRoom, /propertyId:[\s\S]*required: true/);
  assert.match(inventory, /InventoryDaySchema\.index\([\s\S]*unique: true/);
});

test("booking price is calculated from a tenant-owned active rate plan", async () => {
  const service = await read("../../src/lib/inventoryReservation.ts");
  assert.match(service, /tenantId: input\.tenantId,[\s\S]*propertyId: input\.propertyId,[\s\S]*roomTypeId,[\s\S]*isActive: true/);
  assert.match(service, /const subtotal = rate\.nightlyRate \* nights\.length/);
  assert.match(service, /const taxes = Math\.round\(subtotal \* rate\.taxRatePercent \/ 100\)/);
  assert.doesNotMatch(service, /input\.totalPrice/);
});

test("inventory reservation and booking creation share a MongoDB transaction", async () => {
  const service = await read("../../src/lib/inventoryReservation.ts");
  assert.match(service, /session\.withTransaction\(async/);
  assert.match(service, /availableRooms: \{ \$gt: 0 \}/);
  assert.match(service, /\$inc: \{ availableRooms: -1, reservedRooms: 1 \}/);
  assert.match(service, /\}, \{ session \}\)/);
});

test("booking API does not accept client-supplied price or tenant ownership", async () => {
  const route = await read("../../src/app/api/tenants/[tenantSlug]/properties/[propertySlug]/bookings/route.ts");
  assert.match(route, /resolveTenantAccess\(/);
  assert.match(route, /createInventoryBooking\(/);
  assert.doesNotMatch(route, /body\.totalPrice/);
  assert.doesNotMatch(route, /tenantId:\s*body\./);
});

test("legacy booking records remain compatible during staged migration", async () => {
  const booking = await read("../../src/models/Booking.ts");
  assert.match(booking, /tenantId\?: mongoose\.Types\.ObjectId/);
  assert.match(booking, /propertyId\?: mongoose\.Types\.ObjectId/);
  assert.match(booking, /paymentStatus\?: PaymentStatus/);
});
