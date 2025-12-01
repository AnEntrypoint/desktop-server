import path from 'path';
import fs from 'fs-extra';
import { validateTaskName, sanitizeInput, validateInputSchema, validateAndSanitizeMetadata } from '../lib/utils.js';
import { createErrorResponse, createValidationError, createForbiddenError, createNotFoundError, createConflictError } from '../utils/error-factory.js';
import { validateParam } from '../middleware/param-validator.js';
import { asyncHandler, logOperation } from '../middleware/error-handler.js';
import { broadcastToRunSubscribers, broadcastToTaskSubscribers, broadcastTaskProgress } from '../utils/ws-broadcaster.js';
import { invalidateCache } from '../utils/cache.js';
import { executeTaskWithTimeout } from '../utils/task-executor.js';
import { writeFileAtomicJson } from '../utils/file-ops.js';
import { FileStore } from '../lib/file-store.js';
import { CONFIG } from '../config/defaults.js';

const activeTasks = new Map();

export function registerTaskRoutes(app) {
  const fileStore = new FileStore(path.join(process.cwd(), 'tasks'));

  app.get('/api/tasks', asyncHandler(async (req, res) => {
    const tasks = fileStore.listDirectories('config.json');
    res.json(tasks);
  }));

  app.post('/api/tasks/:taskName/run', asyncHandler(async (req, res) => {
    let { input } = req.body;
    const { taskName } = req.params;

    validateParam(validateTaskName, 'taskName')(taskName);

    input = sanitizeInput(input || {});

    const taskDir = path.join(process.cwd(), 'tasks', taskName);
    const realTaskDir = path.resolve(taskDir);
    if (!realTaskDir.startsWith(process.cwd())) {
      throw createForbiddenError(`Access to task '${taskName}' denied`);
    }

    const codePath = path.join(taskDir, 'code.js');
    if (!fs.existsSync(codePath)) {
      throw createNotFoundError(`Task '${taskName}'`);
    }

    const configPath = path.join(taskDir, 'config.json');
    let config = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (e) {
        throw createValidationError('Invalid task configuration', 'config');
      }
    }

    if (config.inputs) {
      const schemaErrors = validateInputSchema(input, config.inputs);
      if (schemaErrors) {
        throw createValidationError(schemaErrors.join('; '), 'input');
      }
    }

    const runId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${process.pid}`;
    const startTime = Date.now();
    let cancelled = false;
    activeTasks.set(runId, {
      taskName,
      startTime,
      cancel: () => { cancelled = true; }
    });
    logOperation('task-started', { runId, taskName, inputKeys: Object.keys(input || {}) });
    broadcastToRunSubscribers({ type: 'run-started', runId, taskName, timestamp: new Date().toISOString() });
    broadcastTaskProgress(taskName, runId, { stage: 'preparing', percentage: 0, details: 'Initializing task execution' });

    let output = null, status = 'success', error = null;
    try {
      broadcastTaskProgress(taskName, runId, { stage: 'executing', percentage: 25, details: 'Reading task code' });
      const code = fs.readFileSync(codePath, 'utf8');

      broadcastTaskProgress(taskName, runId, { stage: 'executing', percentage: 50, details: 'Running task code' });
      const timeoutMs = cancelled ? 0 : CONFIG.tasks.executionTimeoutMs;
      output = await executeTaskWithTimeout(taskName, code, input, timeoutMs);
      broadcastTaskProgress(taskName, runId, { stage: 'executing', percentage: 75, details: 'Task code completed' });
    } catch (execError) {
      status = cancelled ? 'cancelled' : 'error';
      error = execError.message;
      output = { error: error, stack: execError.stack };
      if (!cancelled) {
        logOperation('task-error', { runId, taskName, error: error.substring(0, 100) });
        broadcastTaskProgress(taskName, runId, { stage: 'error', percentage: 100, details: error.substring(0, 100) });
      } else {
        broadcastTaskProgress(taskName, runId, { stage: 'cancelled', percentage: 100, details: 'Task was cancelled by user' });
      }
    }

    const duration = Date.now() - startTime;
    const result = { runId, status, input, output, error, duration, timestamp: new Date().toISOString() };

    try {
      validateAndSanitizeMetadata(result);
    } catch (validationError) {
      logOperation('task-metadata-validation-failed', { runId, taskName, error: validationError.message });
      throw createValidationError(`Cannot store task result: ${validationError.message}`, 'metadata');
    }

    const runsDir = path.join(taskDir, 'runs');
    await fs.ensureDir(runsDir);
    const runPath = path.join(runsDir, `${runId}.json`);

    if (await fs.pathExists(runPath)) {
      throw createConflictError(`Run with ID ${runId} already exists`);
    }

    await writeFileAtomicJson(runPath, result);
    activeTasks.delete(runId);
    logOperation('task-completed', { runId, taskName, status, duration });
    broadcastTaskProgress(taskName, runId, { stage: status === 'success' ? 'completed' : status, percentage: 100, details: `Task ${status === 'success' ? 'completed' : status} in ${duration}ms` });
    invalidateCache('metrics');
    broadcastToRunSubscribers({ type: 'run-completed', runId, taskName, status, duration, timestamp: result.timestamp });
    broadcastToTaskSubscribers(taskName, { type: 'run-completed', runId, status, duration });
    res.json(result);
  }));

  app.post('/api/tasks/:runId/cancel', asyncHandler(async (req, res) => {
    const { runId } = req.params;
    if (!activeTasks.has(runId)) {
      return res.status(404).json(createErrorResponse('TASK_NOT_FOUND', 'Task not running or already completed'));
    }
    const task = activeTasks.get(runId);
    task.cancel();
    activeTasks.delete(runId);
    logOperation('task-cancelled', { runId, taskName: task.taskName });
    broadcastToRunSubscribers({ type: 'run-cancelled', runId, taskName: task.taskName, timestamp: new Date().toISOString() });
    res.json({ success: true, runId, cancelled: true, message: `Task ${runId} cancelled` });
  }));

  app.get('/api/tasks/:taskName/history', asyncHandler(async (req, res) => {
    const { taskName } = req.params;
    validateParam(validateTaskName, 'taskName')(taskName);

    const taskDir = path.join(process.cwd(), 'tasks', taskName);
    const realTaskDir = path.resolve(taskDir);
    if (!realTaskDir.startsWith(process.cwd())) {
      throw createForbiddenError(`Access to task '${taskName}' denied`);
    }

    const runsStore = new FileStore(path.join(taskDir, 'runs'));
    const runs = runsStore.listJsonFiles()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(runs);
  }));

  app.get('/api/tasks/:taskName/runs/:runId', asyncHandler(async (req, res) => {
    const { taskName, runId } = req.params;
    validateParam(validateTaskName, 'taskName')(taskName);
    if (!runId || !/^\d+/.test(runId)) {
      throw createValidationError('Invalid run ID format', 'runId');
    }
    const taskDir = path.join(process.cwd(), 'tasks', taskName);
    const realTaskDir = path.resolve(taskDir);
    if (!realTaskDir.startsWith(process.cwd())) {
      throw createForbiddenError(`Access to task '${taskName}' denied`);
    }
    const runPath = path.join(taskDir, 'runs', `${runId}.json`);
    if (!fs.existsSync(runPath)) {
      return res.status(404).json(createErrorResponse('RUN_NOT_FOUND', 'Run not found'));
    }
    try {
      const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      res.json(run);
    } catch (parseErr) {
      res.status(400).json(createErrorResponse('INVALID_JSON', 'Run file is corrupted or invalid JSON'));
    }
  }));
}

export function getActiveTasks() {
  return activeTasks;
}
