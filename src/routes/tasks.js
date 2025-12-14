import { validateTaskName } from '@sequentialos/core';
import { createValidationError, throwNotFound } from '@sequentialos/error-handling';
import { validateParam, sanitizeInput } from '@sequentialos/param-validation';
import { asyncHandler, logOperation } from '../middleware/error-handler.js';
import { broadcastToRunSubscribers, broadcastToTaskSubscribers, broadcastTaskProgress } from '@sequentialos/websocket-broadcaster';
import { formatResponse } from '@sequentialos/response-formatting';
import { nowISO, createTimestamps, updateTimestamp } from '@sequentialos/timestamp-utilities';
import { createServiceFactory } from '@sequentialos/service-factory';
import { createEventBroadcaster } from '@sequentialos/event-broadcaster';
import { createOperationLogger } from '@sequentialos/operation-logger';

export function registerTaskRoutes(app, container) {
  const { getTaskRepository, getTaskService, getStateManager } = createServiceFactory(container);
  const repository = getTaskRepository();
  const service = getTaskService();
  const stateManager = getStateManager();

  const events = createEventBroadcaster({ broadcastToRunSubscribers, broadcastToTaskSubscribers, broadcastTaskProgress });
  const logger = createOperationLogger({ logOperation, logFileOperation: () => {}, logFileSuccess: () => {} });

  app.get('/api/tasks', asyncHandler(async (req, res) => {
    const tasks = await repository.getAll();
    res.json(formatResponse({ tasks }));
  }));

  app.post('/api/tasks/:taskName/run', asyncHandler(async (req, res) => {
    let { input } = req.body;
    const { taskName } = req.params;

    validateParam(validateTaskName, 'taskName')(taskName);
    input = sanitizeInput(input || {});

    const config = await repository.getConfig(taskName);
    service.validateInputs(taskName, input, config);

    const runId = service.createRunId();
    const task = service.registerActiveTask(runId, taskName);
    logger.taskStarted(runId, taskName, Object.keys(input || {}));
    events.runStarted(runId, taskName);
    events.taskProgress(taskName, runId, 'preparing', 0, 'Initializing task execution');

    let output = null, status = 'success', error = null;
    try {
      events.taskProgress(taskName, runId, 'executing', 25, 'Reading task code');
      const code = await repository.getCode(taskName);

      events.taskProgress(taskName, runId, 'executing', 50, 'Running task code');
      output = await service.executeTask(runId, taskName, code, input, task.cancelled);
      events.taskProgress(taskName, runId, 'executing', 75, 'Task code completed');
    } catch (execError) {
      status = task.cancelled ? 'cancelled' : 'error';
      error = execError.message;
      output = { error: error, stack: execError.stack };
      if (!task.cancelled) {
        logger.taskError(runId, taskName, error);
        events.taskProgress(taskName, runId, 'error', 100, error.substring(0, 100));
      } else {
        events.taskProgress(taskName, runId, 'cancelled', 100, 'Task was cancelled by user');
      }
    }

    const duration = Date.now() - task.startTime;
    const result = service.buildRunResult(runId, taskName, input, output, status, error, duration);
    service.validateMetadata(result);

    await repository.saveRun(taskName, runId, result);
    await stateManager.set('runs', runId, { ...result, taskName });
    service.unregisterActiveTask(runId);
    logger.taskCompleted(runId, taskName, status, duration);
    events.taskProgress(taskName, runId, status === 'success' ? 'completed' : status, 100, `Task ${status === 'success' ? 'completed' : status} in ${duration}ms`);
    events.runCompleted(runId, taskName, status, duration, result.timestamp);
    events.taskSubscriber(taskName, { type: 'run-completed', runId, status, duration });
    res.json(formatResponse({ result }));
  }));

  app.post('/api/tasks/:runId/cancel', asyncHandler(async (req, res) => {
    const { runId } = req.params;
    const task = service.getActiveTask(runId);
    if (!task) throwNotFound('Task', runId);
    task.cancel();
    service.unregisterActiveTask(runId);
    logger.taskCancelled(runId, task.taskName);
    events.runCancelled(runId, task.taskName);
    res.json(formatResponse({ success: true, runId, cancelled: true, message: `Task ${runId} cancelled` }));
  }));

  app.get('/api/tasks/:taskName/history', asyncHandler(async (req, res) => {
    const { taskName } = req.params;
    validateParam(validateTaskName, 'taskName')(taskName);
    const runs = repository.getRuns(taskName);
    res.json(formatResponse({ runs }));
  }));

  app.get('/api/tasks/:taskName/runs/:runId', asyncHandler(async (req, res) => {
    const { taskName, runId } = req.params;
    validateParam(validateTaskName, 'taskName')(taskName);
    if (!runId || !/^\d+/.test(runId)) {
      throw createValidationError('Invalid run ID format', 'runId');
    }
    const run = repository.getRun(taskName, runId);
    res.json(formatResponse({ run }));
  }));
}

export function getActiveTasks(container) {
  const { getTaskService } = createServiceFactory(container);
  return getTaskService().getActiveTasks();
}
