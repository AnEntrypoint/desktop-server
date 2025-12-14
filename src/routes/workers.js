import { asyncHandler } from '../middleware/error-handler.js';
import { formatResponse } from '@sequentialos/response-formatting';
import { parseResourceId, requireResource } from '@sequentialos/route-helpers';
import { throwNotFound } from '@sequentialos/error-handling';
import { createServiceFactory } from '@sequentialos/service-factory';

export function registerWorkerRoutes(app, container) {
  const { getQueueWorkerPool } = createServiceFactory(container);
  const queueWorkerPool = getQueueWorkerPool();

  app.get('/api/queue/workers/status', asyncHandler(async (req, res) => {
    res.json(formatResponse({ stats: queueWorkerPool.getStats() }));
  }));

  app.get('/api/queue/workers/:id', parseResourceId('id'), asyncHandler(async (req, res) => {
    const status = queueWorkerPool.getWorkerStatus(req.resourceId);
    requireResource(status, 'Worker', req.resourceId);
    res.json(formatResponse({ worker: { id: req.resourceId, ...status } }));
  }));

  app.get('/api/queue/workers', asyncHandler(async (req, res) => {
    const workers = queueWorkerPool.getAllWorkerStatus();
    res.json(formatResponse({ count: workers.length, workers }));
  }));

  app.post('/api/queue/workers/start', asyncHandler(async (req, res) => {
    if (queueWorkerPool.isRunning) {
      return res.json(formatResponse({ message: 'Worker pool already running' }));
    }
    await queueWorkerPool.start();
    res.json(formatResponse({ message: 'Worker pool started', stats: queueWorkerPool.getStats() }));
  }));

  app.post('/api/queue/workers/stop', asyncHandler(async (req, res) => {
    if (!queueWorkerPool.isRunning) {
      return res.json(formatResponse({ message: 'Worker pool already stopped' }));
    }
    await queueWorkerPool.stop();
    res.json(formatResponse({ message: 'Worker pool stopped' }));
  }));
}
