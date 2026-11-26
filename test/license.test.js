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

const PRODUCT_ID = "32-nPAicqbLj8B_WswVlMw==";

test("empty key is rejected and the sample remains available", async () => {
  const result = await verifyLicense("  ", { productId: PRODUCT_ID });
  assert.equal(result.ok, false);
  assert.match(result.message, /built-in sample still works/i);
});

test("review key unlocks only when no Gumroad product id is set", async () => {
  const ok = await verifyLicense(REVIEW_KEY, { productId: "", now: new Date("2026-11-26T04:00:00Z") });
  assert.equal(ok.ok, true);
  assert.equal(ok.source, "review");
  const blocked = await verifyLicense(REVIEW_KEY, { productId: PRODUCT_ID });
  assert.equal(blocked.ok, false);
});

test("live verify sends product_id, not product_permalink", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, body: String(init.body) };
    return { json: async () => ({ success: true, purchase: { refunded: false, chargebacked: false, disputed: false } }) };
  };
  const ok = await verifyLicense("AAAA-BBBB", { productId: PRODUCT_ID, fetchImpl });
  assert.equal(ok.ok, true);
  assert.equal(sent.url, "https://api.gumroad.com/v2/licenses/verify");
  assert.match(sent.body, /product_id=/);
  assert.doesNotMatch(sent.body, /product_permalink=/);
});

test("valid Gumroad licenses are cached; refunded, disputed, and ended subscriptions are not", async () => {
  const storage = memoryStorage();
  const fetchImpl = async () => ({
    json: async () => ({ success: true, purchase: { refunded: false, chargebacked: false, disputed: false } }),
  });
  const ok = await verifyLicense("AAAA-BBBB", {
    productId: PRODUCT_ID,
    fetchImpl,
    now: new Date("2026-11-26T04:00:00Z"),
  });
  assert.equal(ok.ok, true);
  saveCachedLicense(ok, storage);
  const cached = loadCachedLicense(storage);
  assert.equal(cached.key, "AAAA-BBBB");

  const refunded = await verifyLicense("REFUNDED", {
    productId: PRODUCT_ID,
    fetchImpl: async () => ({ json: async () => ({ success: true, purchase: { refunded: true } }) }),
  });
  assert.equal(refunded.ok, false);
  assert.equal(refunded.reason, "refunded");

  const cancelled = await verifyLicense("CHARGED", {
    productId: PRODUCT_ID,
    fetchImpl: async () => ({ json: async () => ({ success: true, purchase: { chargebacked: true } }) }),
  });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.reason, "cancelled");

  const disputed = await verifyLicense("DISPUTED", {
    productId: PRODUCT_ID,
    fetchImpl: async () => ({ json: async () => ({ success: true, purchase: { disputed: true, dispute_won: false } }) }),
  });
  assert.equal(disputed.ok, false);
  assert.equal(disputed.reason, "disputed");

  const won = await verifyLicense("WON", {
    productId: PRODUCT_ID,
    fetchImpl: async () => ({
      json: async () => ({ success: true, purchase: { disputed: true, dispute_won: true } }),
    }),
  });
  assert.equal(won.ok, true);

  const ended = await verifyLicense("ENDED", {
    productId: PRODUCT_ID,
    fetchImpl: async () => ({
      json: async () => ({ success: true, purchase: { subscription_cancelled_at: "2026-01-01T00:00:00Z" } }),
    }),
  });
  assert.equal(ended.ok, false);
  assert.equal(ended.reason, "subscription-ended");

  clearCachedLicense(storage);
  assert.equal(loadCachedLicense(storage), null);
});

test("a network failure does not unlock a new key", async () => {
  const result = await verifyLicense("AAAA-BBBB", {
    productId: PRODUCT_ID,
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "network");
});
