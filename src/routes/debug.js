import { asyncHandler, getOperationLog } from '../middleware/error-handler.js';
import { getFromCache, getRequestLog, CONFIG } from '@sequentialos/server-utilities';
import { createError } from '@sequentialos/error-handling';
import { formatResponse } from '@sequentialos/response-formatting';
import { createServiceFactory } from '@sequentialos/service-factory';

export function registerDebugRoutes(app, container) {
  const { getStateManager } = createServiceFactory(container);
  app.get('/api/logs', asyncHandler((req, res) => {
    const filter = req.query.filter;
    const logs = getRequestLog(filter ? JSON.parse(filter) : null);
    const limit = req.query.limit ? parseInt(req.query.limit) : CONFIG.logs.defaultLogLimit;
    res.json(formatResponse({ logs: logs.slice(-limit) }));
  }));

  app.get('/api/operations-log', asyncHandler((req, res) => {
    const log = getOperationLog();
    const limit = req.query.limit ? parseInt(req.query.limit) : CONFIG.logs.defaultLogLimit;
    res.json(formatResponse({ log: log.slice(-limit) }));
  }));

  app.get('/api/cache-status', asyncHandler((req, res) => {
    const cached = getFromCache('metrics');
    res.json(formatResponse({ hasMetricsCache: cached !== null, metricsCache: cached, cacheStatus: 'operational' }));
  }));

  app.post('/api/cache-clear', asyncHandler((req, res) => {
    res.json(formatResponse({ message: 'Cache would be cleared' }));
  }));

  app.get('/api/state/stats', asyncHandler((req, res) => {
    const stats = getStateManager().getCacheStats();
    res.json(formatResponse({ stats }));
  }));
}
