const metricsCache = new Map();
const CACHE_TTL_MS = 30000;

export function createCacheKey(category, params = {}) {
  return `${category}:${JSON.stringify(params)}`;
}

export function getFromCache(key) {
  const entry = metricsCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL_MS) {
    metricsCache.delete(key);
    return null;
  }
  return entry.data;
}

export function setCache(key, data) {
  metricsCache.set(key, { data, timestamp: Date.now() });
}

export function invalidateCache(pattern = null) {
  if (!pattern) {
    metricsCache.clear();
  } else {
    for (const key of metricsCache.keys()) {
      if (key.startsWith(pattern)) {
        metricsCache.delete(key);
      }
    }
  }
}
