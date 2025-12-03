import { backgroundTaskManager } from '@sequential/server-utilities';
import { asyncHandler } from '../middleware/error-handler.js';
import { formatResponse } from '@sequential/response-formatting';
import { parseResourceId, requireResource, parsePagination } from '@sequential/route-helpers';
import { throwValidationError, throwNotFound } from '@sequential/error-handling';

export function registerBackgroundTaskRoutes(app) {
  app.post('/api/background-tasks/spawn', asyncHandler(async (req, res) => {
    const { command, args = [], options = {} } = req.body;
    if (!command) throwValidationError('command', 'command is required');
    const result = backgroundTaskManager.spawn(command, args, options);
    res.json(formatResponse({ id: result.id, pid: result.pid, message: `Task spawned: ${command}` }));
  }));

  app.get('/api/background-tasks/list', asyncHandler(async (req, res) => {
    const tasks = backgroundTaskManager.list();
    res.json(formatResponse({ tasks, count: tasks.length }));
  }));

  app.get('/api/background-tasks/:id/status', parseResourceId('id'), asyncHandler(async (req, res) => {
    const status = backgroundTaskManager.status(req.resourceId);
    requireResource(status, 'Task', req.resourceId);
    res.json(formatResponse({ status }));
  }));

  app.get('/api/background-tasks/:id/output', parseResourceId('id'), asyncHandler(async (req, res) => {
    const output = backgroundTaskManager.getOutput(req.resourceId);
    requireResource(output, 'Task output', req.resourceId);
    res.json(formatResponse({ stdout: output.stdout, stderr: output.stderr }));
  }));

  app.post('/api/background-tasks/:id/kill', parseResourceId('id'), asyncHandler(async (req, res) => {
    const killed = backgroundTaskManager.kill(req.resourceId);
    if (!killed) throwNotFound('Task', req.resourceId);
    res.json(formatResponse({ message: `Task ${req.resourceId} killed` }));
  }));

  app.post('/api/background-tasks/:id/wait', parseResourceId('id'), asyncHandler(async (req, res) => {
    const status = await backgroundTaskManager.waitFor(req.resourceId);
    requireResource(status, 'Task', req.resourceId);
    res.json(formatResponse({ status }));
  }));

  app.get('/api/background-tasks/history', asyncHandler(async (req, res) => {
    const { limit } = parsePagination(req, { limit: 100, offset: 0 });
    const history = await backgroundTaskManager.getHistory(limit);
    res.json(formatResponse({ history, count: history.length }));
  }));

  app.post('/api/background-tasks/:id/progress', parseResourceId('id'), asyncHandler(async (req, res) => {
    const { percent, stage, details } = req.body;
    if (percent === undefined) throwValidationError('percent', 'percent is required');
    const success = backgroundTaskManager.updateProgress(req.resourceId, percent, stage, details);
    if (!success) throwNotFound('Task', req.resourceId);
    res.json(formatResponse({ message: `Task ${req.resourceId} progress updated to ${percent}%`, progress: backgroundTaskManager.status(req.resourceId).progress }));
  }));
}
