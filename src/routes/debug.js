import { asyncHandler, getOperationLog } from '../middleware/error-handler.js';
import { getRequestLog } from '../middleware/request-logger.js';
import { createErrorResponse } from '../utils/error-factory.js';
import { getFromCache } from '../utils/cache.js';
import { CONFIG } from '../config/defaults.js';

export function registerDebugRoutes(app) {
  app.get('/api/logs', asyncHandler((req, res) => {
    const filter = req.query.filter;
    const logs = getRequestLog(filter ? JSON.parse(filter) : null);
    const limit = req.query.limit ? parseInt(req.query.limit) : CONFIG.logs.defaultLogLimit;
    res.json(logs.slice(-limit));
  }));

  app.get('/api/operations-log', asyncHandler((req, res) => {
    const log = getOperationLog();
    const limit = req.query.limit ? parseInt(req.query.limit) : CONFIG.logs.defaultLogLimit;
    res.json(log.slice(-limit));
  }));

  app.get('/api/cache-status', asyncHandler((req, res) => {
    const cached = getFromCache('metrics');
    res.json({
      hasMetricsCache: cached !== null,
      metricsCache: cached,
      cacheStatus: 'operational'
    });
  }));

  app.post('/api/cache-clear', asyncHandler((req, res) => {
    res.json({ success: true, message: 'Cache would be cleared' });
  }));
}
