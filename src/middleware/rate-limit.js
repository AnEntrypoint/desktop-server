import { createErrorResponse } from '@sequential/error-handling';
import { CONFIG } from '@sequential/server-utilities';

const RATE_LIMIT_MAP = new Map();
const WS_CONNECTION_MAP = new Map();

export function createRateLimitMiddleware(maxRequests = 100, windowMs = 60000) {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of RATE_LIMIT_MAP.entries()) {
      const valid = timestamps.filter(t => now - t < windowMs);
      if (valid.length === 0) {
        RATE_LIMIT_MAP.delete(ip);
      } else {
        RATE_LIMIT_MAP.set(ip, valid);
      }
    }
  }, Math.max(windowMs / 2, 30000));

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const now = Date.now();

    if (!RATE_LIMIT_MAP.has(ip)) {
      RATE_LIMIT_MAP.set(ip, []);
    }

    const timestamps = RATE_LIMIT_MAP.get(ip);
    const recentRequests = timestamps.filter(t => now - t < windowMs);

    if (recentRequests.length >= maxRequests) {
      return res.status(429).json(createErrorResponse('RATE_LIMIT_EXCEEDED', `Too many requests. Limit: ${maxRequests} per ${windowMs}ms`, { retryAfter: windowMs / 1000 }));
    }

    recentRequests.push(now);
    RATE_LIMIT_MAP.set(ip, recentRequests);
    next();
  };
}

export function createWebSocketRateLimiter() {
  setInterval(() => {
    const now = Date.now();
    WS_CONNECTION_MAP.forEach((connections, ip) => {
      const validConnections = connections.filter(c => c.ws.readyState === 1);
      if (validConnections.length === 0) {
        WS_CONNECTION_MAP.delete(ip);
      } else {
        WS_CONNECTION_MAP.set(ip, validConnections);
      }
    });
  }, CONFIG.rateLimit.websocket.cleanupIntervalMs);
}

export function checkWebSocketRateLimit(ip) {
  if (!WS_CONNECTION_MAP.has(ip)) {
    WS_CONNECTION_MAP.set(ip, []);
  }

  const connections = WS_CONNECTION_MAP.get(ip);

  return {
    ip,
    isAllowed: () => connections.length < CONFIG.rateLimit.websocket.maxConnectionsPerIp,
    getRemainingConnections: () => Math.max(0, CONFIG.rateLimit.websocket.maxConnectionsPerIp - connections.length),
    add: (ws) => {
      const connections = WS_CONNECTION_MAP.get(ip);
      if (connections.length >= CONFIG.rateLimit.websocket.maxConnectionsPerIp) {
        return false;
      }
      connections.push({ ws, timestamp: Date.now() });
      return true;
    },
    remove: (ws) => {
      const connections = WS_CONNECTION_MAP.get(ip);
      const index = connections.findIndex(c => c.ws === ws);
      if (index !== -1) {
        connections.splice(index, 1);
        if (connections.length === 0) WS_CONNECTION_MAP.delete(ip);
      }
    }
  };
}
