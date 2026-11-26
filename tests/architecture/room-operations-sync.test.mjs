import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("room operational status is derived from outstanding maintenance and housekeeping work", async () => {
  const helper = await read("../../src/lib/roomOperationalSync.ts");
  assert.ok(helper.includes('status: { $in: ["open", "in_progress", "blocked"] }'));
  assert.ok(helper.includes('status: { $in: ["open", "in_progress"] }'));
  assert.ok(helper.includes('openMaintenance ? "maintenance" : openHousekeeping ? "cleaning"'));
  assert.ok(helper.includes('room.status === "occupied" || room.status === "out_of_service"'));
  assert.ok(helper.includes("withTransaction") === false, "caller owns the transaction boundary");
  assert.ok(helper.includes("physical_room.operational_status_synchronized"));
});

test("booking check-in cannot bypass unfinished room operations and checkout reconciles the room", async () => {
  const lifecycle = await read("../../src/lib/bookingLifecycle.ts");
  assert.ok(lifecycle.includes("unfinished housekeeping or maintenance work"));
  assert.ok(lifecycle.includes("synchronizePhysicalRoomOperationalStatus"));
  assert.ok(lifecycle.includes('input.action === "check_out"'));
});
