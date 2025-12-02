import { asyncHandler } from '../middleware/error-handler.js';
import { taskQueueManager } from '@sequential/server-utilities';
import { formatResponse, formatError } from '@sequential/response-formatting';

export function registerQueueRoutes(app, container) {
  const stateManager = container.resolve('StateManager');

  app.post('/api/queue/enqueue', asyncHandler(async (req, res) => {
    const { taskName, args, options } = req.body;

    if (!taskName) {
      return res.status(400).json(formatError(400, {
        code: 'MISSING_TASK_NAME',
        message: 'taskName is required'
      }));
    }

    const result = taskQueueManager.enqueue(taskName, args || [], options || {});
    res.json(formatResponse(result));
  }));

  app.post('/api/queue/dequeue', asyncHandler(async (req, res) => {
    const dequeued = taskQueueManager.dequeue();

    if (!dequeued) {
      return res.json(formatResponse({ task: null }, { message: 'Queue is empty' }));
    }

    res.json(formatResponse({ id: dequeued.id, task: dequeued.task }));
  }));

  app.post('/api/queue/:id/complete', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { result } = req.body;
    const taskId = parseInt(id);

    const success = taskQueueManager.complete(taskId, result);

    if (!success) {
      return res.status(404).json(formatError(404, {
        code: 'NOT_FOUND',
        message: `Task ${id} not found in queue`
      }));
    }

    res.json(formatResponse({
      message: `Task ${id} completed`,
      status: taskQueueManager.status(taskId)
    }));
  }));

  app.post('/api/queue/:id/fail', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { error } = req.body;
    const taskId = parseInt(id);

    const success = taskQueueManager.fail(taskId, error || new Error('Task failed'));

    if (!success) {
      return res.status(404).json(formatError(404, {
        code: 'NOT_FOUND',
        message: `Task ${id} not found in queue`
      }));
    }

    const status = taskQueueManager.status(taskId);
    res.json(formatResponse({
      message: `Task ${id} failed (retries: ${status.retries}/${status.maxRetries})`,
      status
    }));
  }));

  app.get('/api/queue/status/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const taskId = parseInt(id);
    const status = taskQueueManager.status(taskId);

    if (!status) {
      return res.status(404).json(formatError(404, {
        code: 'NOT_FOUND',
        message: `Task ${id} not found`
      }));
    }

    res.json(formatResponse({ task: status }));
  }));

  app.get('/api/queue/list', asyncHandler(async (req, res) => {
    const { taskName, status } = req.query;
    const filter = {};

    if (taskName) filter.taskName = taskName;
    if (status) filter.status = status;

    const tasks = taskQueueManager.list(filter);
    res.json(formatResponse({
      count: tasks.length,
      tasks
    }));
  }));

  app.get('/api/queue/stats', asyncHandler(async (req, res) => {
    const stats = taskQueueManager.getStats();
    res.json(formatResponse({ stats }));
  }));

  app.post('/api/queue/clear', asyncHandler(async (req, res) => {
    const count = taskQueueManager.queue.size;
    taskQueueManager.clear();

    res.json(formatResponse({
      message: `Cleared ${count} tasks from queue`,
      cleared: count
    }));
  }));
}
