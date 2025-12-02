import { asyncHandler } from '../middleware/error-handler.js';
import { formatResponse, formatError } from '@sequential/response-formatting';

export function registerWorkerRoutes(app, container) {
  const queueWorkerPool = container.resolve('QueueWorkerPool');

  app.get('/api/queue/workers/status', asyncHandler(async (req, res) => {
    const stats = queueWorkerPool.getStats();
    res.json(formatResponse({ stats }));
  }));

  app.get('/api/queue/workers/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const workerId = parseInt(id);
    const status = queueWorkerPool.getWorkerStatus(workerId);

    if (!status) {
      return res.status(404).json(formatError(404, { code: 'NOT_FOUND', message: `Worker ${id} not found` }));
    }

    res.json(formatResponse({ worker: { id: workerId, ...status } }));
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
