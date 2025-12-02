import { validateTaskName, sanitizeInput } from '@sequential/core';
import { createError, createValidationError, createErrorResponse } from '@sequential/error-handling';
import { validateParam } from '@sequential/param-validation';
import { asyncHandler, logOperation } from '../middleware/error-handler.js';
import { broadcastToRunSubscribers, broadcastToTaskSubscribers, broadcastTaskProgress } from '@sequential/websocket-broadcaster';
import { clearCache } from '@sequential/server-utilities';

export function registerTaskRoutes(app, container) {
  const repository = container.resolve('TaskRepository');
  const service = container.resolve('TaskService');

  app.get('/api/tasks', asyncHandler(async (req, res) => {
    const tasks = repository.getAll();
    res.json(tasks);
  }));

  app.post('/api/tasks/:taskName/run', asyncHandler(async (req, res) => {
    let { input } = req.body;
    const { taskName } = req.params;

    validateParam(validateTaskName, 'taskName')(taskName);
    input = sanitizeInput(input || {});

    const config = repository.getConfig(taskName);
    service.validateInputs(taskName, input, config);

    const runId = service.createRunId();
    const task = service.registerActiveTask(runId, taskName);
    logOperation('task-started', { runId, taskName, inputKeys: Object.keys(input || {}) });
    broadcastToRunSubscribers({ type: 'run-started', runId, taskName, timestamp: new Date().toISOString() });
    broadcastTaskProgress(taskName, runId, { stage: 'preparing', percentage: 0, details: 'Initializing task execution' });

    let output = null, status = 'success', error = null;
    try {
      broadcastTaskProgress(taskName, runId, { stage: 'executing', percentage: 25, details: 'Reading task code' });
      const code = repository.getCode(taskName);

      broadcastTaskProgress(taskName, runId, { stage: 'executing', percentage: 50, details: 'Running task code' });
      output = await service.executeTask(runId, taskName, code, input, task.cancelled);
      broadcastTaskProgress(taskName, runId, { stage: 'executing', percentage: 75, details: 'Task code completed' });
    } catch (execError) {
      status = task.cancelled ? 'cancelled' : 'error';
      error = execError.message;
      output = { error: error, stack: execError.stack };
      if (!task.cancelled) {
        logOperation('task-error', { runId, taskName, error: error.substring(0, 100) });
        broadcastTaskProgress(taskName, runId, { stage: 'error', percentage: 100, details: error.substring(0, 100) });
      } else {
        broadcastTaskProgress(taskName, runId, { stage: 'cancelled', percentage: 100, details: 'Task was cancelled by user' });
      }
    }

    const duration = Date.now() - task.startTime;
    const result = service.buildRunResult(runId, taskName, input, output, status, error, duration);
    service.validateMetadata(result);

    await repository.saveRun(taskName, runId, result);
    service.unregisterActiveTask(runId);
    logOperation('task-completed', { runId, taskName, status, duration });
    broadcastTaskProgress(taskName, runId, { stage: status === 'success' ? 'completed' : status, percentage: 100, details: `Task ${status === 'success' ? 'completed' : status} in ${duration}ms` });
    service.invalidateMetricsCache();
    broadcastToRunSubscribers({ type: 'run-completed', runId, taskName, status, duration, timestamp: result.timestamp });
    broadcastToTaskSubscribers(taskName, { type: 'run-completed', runId, status, duration });
    res.json(result);
  }));

  app.post('/api/tasks/:runId/cancel', asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const task = service.getActiveTask(runId);
    if (!task) {
      return res.status(404).json(createErrorResponse('TASK_NOT_FOUND', 'Task not running or already completed'));
    }
    task.cancel();
    service.unregisterActiveTask(runId);
    logOperation('task-cancelled', { runId, taskName: task.taskName });
    broadcastToRunSubscribers({ type: 'run-cancelled', runId, taskName: task.taskName, timestamp: new Date().toISOString() });
    res.json({ success: true, runId, cancelled: true, message: `Task ${runId} cancelled` });
  }));

  app.get('/api/tasks/:taskName/history', asyncHandler(async (req, res) => {
    const { taskName } = req.params;
    validateParam(validateTaskName, 'taskName')(taskName);
    const runs = repository.getRuns(taskName);
    res.json(runs);
  }));

  app.get('/api/tasks/:taskName/runs/:runId', asyncHandler(async (req, res) => {
    const { taskName, runId } = req.params;
    validateParam(validateTaskName, 'taskName')(taskName);
    if (!runId || !/^\d+/.test(runId)) {
      throw createValidationError('Invalid run ID format', 'runId');
    }
    const run = repository.getRun(taskName, runId);
    res.json(run);
  }));
}

export function getActiveTasks(container) {
  const service = container.resolve('TaskService');
  return service.getActiveTasks();
}
