import { asyncHandler } from '../middleware/error-handler.js';

export function registerWorkerRoutes(app, container) {
  const queueWorkerPool = container.resolve('QueueWorkerPool');

  app.get('/api/queue/workers/status', asyncHandler(async (req, res) => {
    const stats = queueWorkerPool.getStats();
    res.json({
      success: true,
      stats
    });
  }));

  app.get('/api/queue/workers/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const workerId = parseInt(id);
    const status = queueWorkerPool.getWorkerStatus(workerId);

    if (!status) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Worker ${id} not found` }
      });
    }

    res.json({
      success: true,
      worker: { id: workerId, ...status }
    });
  }));

  app.get('/api/queue/workers', asyncHandler(async (req, res) => {
    const workers = queueWorkerPool.getAllWorkerStatus();
    res.json({
      success: true,
      count: workers.length,
      workers
    });
  }));

  app.post('/api/queue/workers/start', asyncHandler(async (req, res) => {
    if (queueWorkerPool.isRunning) {
      return res.json({
        success: true,
        message: 'Worker pool already running'
      });
    }

    await queueWorkerPool.start();
    res.json({
      success: true,
      message: 'Worker pool started',
      stats: queueWorkerPool.getStats()
    });
  }));

  app.post('/api/queue/workers/stop', asyncHandler(async (req, res) => {
    if (!queueWorkerPool.isRunning) {
      return res.json({
        success: true,
        message: 'Worker pool already stopped'
      });
    }

    await queueWorkerPool.stop();
    res.json({
      success: true,
      message: 'Worker pool stopped'
    });
  }));
}
