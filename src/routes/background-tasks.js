import { backgroundTaskManager } from '@sequential/server-utilities';
import { asyncHandler } from '../middleware/error-handler.js';
import { formatResponse, formatError } from '@sequential/response-formatting';

export function registerBackgroundTaskRoutes(app) {
  app.post('/api/background-tasks/spawn', asyncHandler(async (req, res) => {
    const { command, args = [], options = {} } = req.body;

    if (!command) {
      return res.status(400).json(formatError(400, { code: 'MISSING_COMMAND', message: 'command is required' }));
    }

    try {
      const result = backgroundTaskManager.spawn(command, args, options);
      res.json(formatResponse({ id: result.id, pid: result.pid, message: `Task spawned: ${command}` }));
    } catch (error) {
      res.status(500).json(formatError(500, { code: 'SPAWN_FAILED', message: error.message }));
    }
  }));

  app.get('/api/background-tasks/list', asyncHandler(async (req, res) => {
    const tasks = backgroundTaskManager.list();
    res.json(formatResponse({ tasks, count: tasks.length }));
  }));

  app.get('/api/background-tasks/:id/status', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const taskId = parseInt(id);
    const status = backgroundTaskManager.status(taskId);

    if (!status) {
      return res.status(404).json(formatError(404, { code: 'NOT_FOUND', message: `Task ${id} not found` }));
    }

    res.json(formatResponse({ status }));
  }));

  app.get('/api/background-tasks/:id/output', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const taskId = parseInt(id);
    const output = backgroundTaskManager.getOutput(taskId);

    if (!output) {
      return res.status(404).json(formatError(404, { code: 'NOT_FOUND', message: `Task ${id} not found` }));
    }

    res.json(formatResponse({ stdout: output.stdout, stderr: output.stderr }));
  }));

  app.post('/api/background-tasks/:id/kill', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const taskId = parseInt(id);
    const killed = backgroundTaskManager.kill(taskId);

    if (!killed) {
      return res.status(404).json(formatError(404, { code: 'NOT_FOUND', message: `Task ${id} not found or not running` }));
    }

    res.json(formatResponse({ message: `Task ${id} killed` }));
  }));

  app.post('/api/background-tasks/:id/wait', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const taskId = parseInt(id);
    const status = await backgroundTaskManager.waitFor(taskId);

    if (!status) {
      return res.status(404).json(formatError(404, { code: 'NOT_FOUND', message: `Task ${id} not found` }));
    }

    res.json(formatResponse({ status }));
  }));

  app.get('/api/background-tasks/history', asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '100'), 1000);
    const history = await backgroundTaskManager.getHistory(limit);

    res.json(formatResponse({ history, count: history.length }));
  }));

  app.post('/api/background-tasks/:id/progress', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { percent, stage, details } = req.body;
    const taskId = parseInt(id);

    if (percent === undefined) {
      return res.status(400).json(formatError(400, { code: 'MISSING_PERCENT', message: 'percent is required' }));
    }

    const success = backgroundTaskManager.updateProgress(taskId, percent, stage, details);

    if (!success) {
      return res.status(404).json(formatError(404, { code: 'NOT_FOUND', message: `Task ${id} not found` }));
    }

    res.json(formatResponse({ message: `Task ${id} progress updated to ${percent}%`, progress: backgroundTaskManager.status(taskId).progress }));
  }));
}
