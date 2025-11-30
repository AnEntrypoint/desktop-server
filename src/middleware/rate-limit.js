import { createErrorResponse } from '../utils/error-factory.js';

const rateLimitMap = new Map();
const wsConnectionMap = new Map();
const WS_MAX_CONNECTIONS_PER_IP = 10;
const WS_CONNECTION_CLEANUP_INTERVAL = 60000;

export function createRateLimitMiddleware(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const now = Date.now();

    if (!rateLimitMap.has(ip)) {
      rateLimitMap.set(ip, []);
    }

    const timestamps = rateLimitMap.get(ip);
    const recentRequests = timestamps.filter(t => now - t < windowMs);

    if (recentRequests.length >= maxRequests) {
      return res.status(429).json(createErrorResponse('RATE_LIMIT_EXCEEDED', `Too many requests. Limit: ${maxRequests} per ${windowMs}ms`, { retryAfter: windowMs / 1000 }));
    }

    recentRequests.push(now);
    rateLimitMap.set(ip, recentRequests);
    next();
  };
}

export function createWebSocketRateLimiter() {
  setInterval(() => {
    const now = Date.now();
    wsConnectionMap.forEach((connections, ip) => {
      const validConnections = connections.filter(c => c.ws.readyState === 1);
      if (validConnections.length === 0) {
        wsConnectionMap.delete(ip);
      } else {
        wsConnectionMap.set(ip, validConnections);
      }
    });
  }, WS_CONNECTION_CLEANUP_INTERVAL);
}

export function checkWebSocketRateLimit(ip) {
  if (!wsConnectionMap.has(ip)) {
    wsConnectionMap.set(ip, []);
  }

  const connections = wsConnectionMap.get(ip);
  if (connections.length >= WS_MAX_CONNECTIONS_PER_IP) {
    const oldestConnection = connections[0];
    oldestConnection.ws.close(1008, 'Per-IP connection limit exceeded');
    connections.shift();
  }

  return {
    ip,
    add: (ws) => {
      const connections = wsConnectionMap.get(ip);
      connections.push({ ws, timestamp: Date.now() });
    },
    remove: (ws) => {
      const connections = wsConnectionMap.get(ip);
      const index = connections.findIndex(c => c.ws === ws);
      if (index !== -1) {
        connections.splice(index, 1);
        if (connections.length === 0) wsConnectionMap.delete(ip);
      }
    }
  };
}
