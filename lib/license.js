/** Gumroad license check. User files never leave the browser. Only the key is sent. */

export const REVIEW_KEY = "REVIEW-LOCAL-ONLY";
export const STORAGE_KEY = "takeout-tasks-to-ics.license";
export const VERIFY_URL = "https://api.gumroad.com/v2/licenses/verify";

export function configPermalink() {
  return String(globalThis.__GUMROAD_PRODUCT_PERMALINK || "").trim();
}

export function loadCachedLicense(storage = defaultStorage()) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.ok && data.key && data.status === "valid") return data;
  } catch {
    return null;
  }
  return null;
}

export function saveCachedLicense(result, storage = defaultStorage()) {
  if (!result?.ok) return;
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ok: true,
      status: "valid",
      key: result.key,
      source: result.source,
      verifiedAt: result.verifiedAt,
    })
  );
}

export function clearCachedLicense(storage = defaultStorage()) {
  storage.removeItem(STORAGE_KEY);
}

export async function verifyLicense(key, options = {}) {
  const trimmed = String(key ?? "").trim();
  const now = options.now ?? new Date();
  const permalink = options.permalink ?? configPermalink();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!trimmed) {
    return fail("empty", "Enter a license key to convert your own Takeout file. The built-in sample still works.");
  }

  if (!permalink) {
    if (trimmed === REVIEW_KEY) {
      return {
        ok: true,
        status: "valid",
        key: trimmed,
        source: "review",
        verifiedAt: now.toISOString(),
        message: "Unlocked for review. This temporary key will be removed when the Gumroad product is listed.",
      };
    }
    return fail(
      "not-listed",
      "A Gumroad license cannot be checked yet because the product has not been listed. You can still convert the built-in sample."
    );
  }

  if (typeof fetchImpl !== "function") {
    return fail("offline", "This browser cannot reach Gumroad to check the license. If a valid key was accepted earlier, it can still be used offline. The built-in sample still works.");
  }

  let response;
  try {
    const body = new URLSearchParams({
      product_permalink: permalink,
      license_key: trimmed,
      increment_uses_count: "false",
    });
    response = await fetchImpl(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    return fail("network", "Could not reach Gumroad to check this license. Try again when you are online, or convert the built-in sample.");
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    return fail("invalid", "Gumroad did not return a readable response for this license.");
  }

  const purchase = data.purchase || {};
  if (purchase.refunded) {
    return fail("refunded", "This license has been refunded, so it cannot unlock your own files. The built-in sample still works.");
  }
  if (purchase.chargebacked) {
    return fail("cancelled", "This license has been cancelled, so it cannot unlock your own files. The built-in sample still works.");
  }
  if (data.success === true) {
    return {
      ok: true,
      status: "valid",
      key: trimmed,
      source: "gumroad",
      verifiedAt: now.toISOString(),
      message: "License unlocked. Your Takeout files are still processed only in this browser.",
    };
  }
  return fail("invalid", "This license key is not valid. Check the key from your Gumroad receipt, or convert the built-in sample.");
}

function fail(reason, message) {
  return { ok: false, status: "invalid", reason, message };
}

function defaultStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {}
  return memoryStorage();
}

export function memoryStorage(start = {}) {
  const map = { ...start };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null),
    setItem: (key, value) => {
      map[key] = String(value);
    },
    removeItem: (key) => {
      delete map[key];
    },
  };
}
