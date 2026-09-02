/**
 * Lightweight in-memory TTL cache for reference API data.
 * Reduces duplicate fetches when navigating between pages.
 */

const store = new Map();

function cacheKey(namespace, key) {
  return `${namespace}:${JSON.stringify(key)}`;
}

/**
 * Return cached value when fresh, otherwise run loader and store result.
 *
 * @param {string} namespace Cache bucket name (e.g. "cases", "evidence-inventory")
 * @param {string|object} key Unique key within the namespace
 * @param {() => Promise<any>} loader Async fetcher
 * @param {number} [ttlMs=30000] Time-to-live in milliseconds
 */
export async function cachedQuery(namespace, key, loader, ttlMs = 30000) {
  const id = cacheKey(namespace, key);
  const now = Date.now();
  const hit = store.get(id);
  if (hit && hit.expiresAt > now) {
    return hit.value;
  }
  const value = await loader();
  store.set(id, { value, expiresAt: now + Math.max(1000, ttlMs) });
  return value;
}

/** Drop one namespace bucket or the entire cache. */
export function invalidateQueryCache(namespace) {
  if (!namespace) {
    store.clear();
    return;
  }
  const prefix = `${namespace}:`;
  for (const id of store.keys()) {
    if (id.startsWith(prefix)) store.delete(id);
  }
}

/** Whether the document tab is visible (pause background polling when hidden). */
export function isPageVisible() {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}
