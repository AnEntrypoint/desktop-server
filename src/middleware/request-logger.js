import { CONFIG } from '../config/defaults.js';

const requestLog = [];

export function createRequestLogger(slowThresholdMs = null) {
  slowThresholdMs = slowThresholdMs || CONFIG.requestLogger.slowThresholdMs;
  return (req, res, next) => {
    const requestId = Math.random().toString(36).substring(7);
    const startTime = Date.now();

    req.requestId = requestId;
    const originalJson = res.json;
    res.json = function(data) {
      const duration = Date.now() - startTime;
      const isSlow = duration > slowThresholdMs;
      const bodySize = JSON.stringify(data).length;

      const logEntry = {
        requestId,
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        query: Object.keys(req.query).length > 0 ? req.query : undefined,
        status: res.statusCode,
        duration: `${duration}ms`,
        slow: isSlow,
        bodySize: `${bodySize}B`,
        ip: req.ip || 'unknown',
        userAgent: req.get('user-agent')?.substring(0, CONFIG.requestLogger.userAgentMaxLength)
      };

      if (requestLog.length >= CONFIG.requestLogger.maxLogSize) {
        requestLog.shift();
      }
      requestLog.push(logEntry);

      const level = isSlow ? '⚠️ ' : res.statusCode >= 400 ? '❌' : '✓';
      if (process.env.DEBUG || isSlow || res.statusCode >= 400) {
        console.log(`${level} [${requestId}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
        if (isSlow) console.log(`   Slow request detected (threshold: ${slowThresholdMs}ms)`);
        if (res.statusCode >= 400) console.log(`   Error response: ${JSON.stringify(data).substring(0, 200)}`);
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

export function getRequestLog(filter) {
  if (!filter) return requestLog;
  return requestLog.filter(entry => {
    if (filter.method && entry.method !== filter.method) return false;
    if (filter.path && !entry.path.includes(filter.path)) return false;
    if (filter.slow !== undefined && entry.slow !== filter.slow) return false;
    if (filter.status && entry.status !== filter.status) return false;
    return true;
  });
}
