import test from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_KEY,
  verifyLicense,
  loadCachedLicense,
  saveCachedLicense,
  clearCachedLicense,
  memoryStorage,
} from "../lib/license.js";

test("empty key is rejected and the sample remains available", async () => {
  const result = await verifyLicense("  ", { permalink: "tasks-ics" });
  assert.equal(result.ok, false);
  assert.match(result.message, /built-in sample still works/i);
});

test("review key unlocks only when no Gumroad product is listed", async () => {
  const ok = await verifyLicense(REVIEW_KEY, { permalink: "", now: new Date("2026-11-26T04:00:00Z") });
  assert.equal(ok.ok, true);
  assert.equal(ok.source, "review");
  const blocked = await verifyLicense(REVIEW_KEY, { permalink: "tasks-ics" });
  assert.equal(blocked.ok, false);
});

test("valid Gumroad licenses are cached; refunded and cancelled keys are not", async () => {
  const storage = memoryStorage();
  const fetchImpl = async () => ({
    json: async () => ({ success: true, purchase: { refunded: false, chargebacked: false } }),
  });
  const ok = await verifyLicense("AAAA-BBBB", {
    permalink: "tasks-ics",
    fetchImpl,
    now: new Date("2026-11-26T04:00:00Z"),
  });
  assert.equal(ok.ok, true);
  saveCachedLicense(ok, storage);
  const cached = loadCachedLicense(storage);
  assert.equal(cached.key, "AAAA-BBBB");

  const refunded = await verifyLicense("REFUNDED", {
    permalink: "tasks-ics",
    fetchImpl: async () => ({ json: async () => ({ success: false, purchase: { refunded: true } }) }),
  });
  assert.equal(refunded.ok, false);
  assert.equal(refunded.reason, "refunded");

  const cancelled = await verifyLicense("CHARGED", {
    permalink: "tasks-ics",
    fetchImpl: async () => ({ json: async () => ({ success: true, purchase: { chargebacked: true } }) }),
  });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.reason, "cancelled");

  clearCachedLicense(storage);
  assert.equal(loadCachedLicense(storage), null);
});

test("a network failure does not unlock a new key", async () => {
  const result = await verifyLicense("AAAA-BBBB", {
    permalink: "tasks-ics",
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "network");
});
