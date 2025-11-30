import { CONFIG } from '../config/defaults.js';

const metricsCache = new Map();

export function createCacheKey(category, params = {}) {
  return `${category}:${JSON.stringify(params)}`;
}

export function getFromCache(key) {
  const entry = metricsCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CONFIG.cache.ttlMs) {
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
