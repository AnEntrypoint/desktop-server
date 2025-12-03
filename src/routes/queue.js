import { asyncHandler } from '../middleware/error-handler.js';
import { taskQueueManager } from '@sequential/server-utilities';
import { formatResponse } from '@sequential/response-formatting';
import { parseResourceId, requireResource } from '@sequential/route-helpers';
import { throwNotFound } from '@sequential/error-handling';

export function registerQueueRoutes(app, container) {
  app.post('/api/queue/enqueue', asyncHandler(async (req, res) => {
    const { taskName, args, options } = req.body;
    if (!taskName) throwNotFound('taskName', 'required');
    res.json(formatResponse(taskQueueManager.enqueue(taskName, args || [], options || {})));
  }));

  app.post('/api/queue/dequeue', asyncHandler(async (req, res) => {
    const dequeued = taskQueueManager.dequeue();
    res.json(formatResponse({ task: dequeued || null }));
  }));

  app.post('/api/queue/:id/complete', parseResourceId('id'), asyncHandler(async (req, res) => {
    const { result } = req.body;
    const success = taskQueueManager.complete(req.resourceId, result);
    if (!success) throwNotFound('Task', req.resourceId);
    res.json(formatResponse({
      message: `Task ${req.resourceId} completed`,
      status: taskQueueManager.status(req.resourceId)
    }));
  }));

  app.post('/api/queue/:id/fail', parseResourceId('id'), asyncHandler(async (req, res) => {
    const { error } = req.body;
    const success = taskQueueManager.fail(req.resourceId, error || new Error('Task failed'));
    if (!success) throwNotFound('Task', req.resourceId);
    const status = taskQueueManager.status(req.resourceId);
    res.json(formatResponse({
      message: `Task ${req.resourceId} failed (retries: ${status.retries}/${status.maxRetries})`,
      status
    }));
  }));

  app.get('/api/queue/status/:id', parseResourceId('id'), asyncHandler(async (req, res) => {
    const status = taskQueueManager.status(req.resourceId);
    requireResource(status, 'Task', req.resourceId);
    res.json(formatResponse({ task: status }));
  }));

  app.get('/api/queue/list', asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.taskName) filter.taskName = req.query.taskName;
    if (req.query.status) filter.status = req.query.status;
    const tasks = taskQueueManager.list(filter);
    res.json(formatResponse({ count: tasks.length, tasks }));
  }));

  app.get('/api/queue/stats', asyncHandler(async (req, res) => {
    res.json(formatResponse({ stats: taskQueueManager.getStats() }));
  }));

  app.post('/api/queue/clear', asyncHandler(async (req, res) => {
    const count = taskQueueManager.queue.size;
    taskQueueManager.clear();
    res.json(formatResponse({ message: `Cleared ${count} tasks from queue`, cleared: count }));
  }));
}
