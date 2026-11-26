import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("workspace routes use a shared responsive navigation shell without the public hotel navbar", async () => {
  const layout = await read("../../src/app/workspace/layout.tsx");
  const shell = await read("../../src/components/WorkspaceShell.tsx");
  const wrapper = await read("../../src/components/PublicLayoutWrapper.tsx");
  assert.ok(layout.includes("WorkspaceShell"));
  for (const href of ["/workspace/bookings", "/workspace/room-timeline", "/workspace/inventory", "/workspace/housekeeping", "/workspace/maintenance", "/workspace/payments", "/workspace/payment-settings"]) assert.ok(shell.includes(href));
  assert.ok(shell.includes("aria-current"));
  assert.ok(shell.includes("aria-label"));
  assert.ok(wrapper.includes("isWorkspaceRoute"));
});

test("application metadata describes the hospitality SaaS product, not a single resort", async () => {
  const layout = await read("../../src/app/layout.tsx");
  assert.ok(layout.includes("Hospitality Operations Platform"));
  assert.ok(layout.includes("multi-property hospitality management platform"));
  assert.ok(!layout.includes("Luxury Coastal Retreat in Crystal Cove"));
  assert.ok(!layout.includes("luxury eco"));
});
