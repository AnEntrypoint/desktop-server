import { backgroundTaskManager } from '@sequential/server-utilities';
import { asyncHandler } from '../middleware/error-handler.js';

export function registerBackgroundTaskRoutes(app) {
  app.post('/api/background-tasks/spawn', asyncHandler(async (req, res) => {
    const { command, args = [], options = {} } = req.body;

    if (!command) {
      return res.status(400).json({
        error: { code: 'MISSING_COMMAND', message: 'command is required' }
      });
    }

    try {
      const result = backgroundTaskManager.spawn(command, args, options);
      res.json({
        success: true,
        id: result.id,
        pid: result.pid,
        message: `Task spawned: ${command}`
      });
    } catch (error) {
      res.status(500).json({
        error: { code: 'SPAWN_FAILED', message: error.message }
      });
    }
  }));

  app.get('/api/background-tasks/list', asyncHandler(async (req, res) => {
    const tasks = backgroundTaskManager.list();
    res.json({
      success: true,
      tasks,
      count: tasks.length
    });
  }));

  app.get('/api/background-tasks/:id/status', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const taskId = parseInt(id);
    const status = backgroundTaskManager.status(taskId);

    if (!status) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Task ${id} not found` }
      });
    }

    res.json({
      success: true,
      status
    });
  }));

  app.get('/api/background-tasks/:id/output', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const taskId = parseInt(id);
    const output = backgroundTaskManager.getOutput(taskId);

    if (!output) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Task ${id} not found` }
      });
    }

    res.json({
      success: true,
      stdout: output.stdout,
      stderr: output.stderr
    });
  }));

  app.post('/api/background-tasks/:id/kill', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const taskId = parseInt(id);
    const killed = backgroundTaskManager.kill(taskId);

    if (!killed) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Task ${id} not found or not running` }
      });
    }

    res.json({
      success: true,
      message: `Task ${id} killed`
    });
  }));

  app.post('/api/background-tasks/:id/wait', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const taskId = parseInt(id);
    const status = await backgroundTaskManager.waitFor(taskId);

    if (!status) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Task ${id} not found` }
      });
    }

    res.json({
      success: true,
      status
    });
  }));
}
