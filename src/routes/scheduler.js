import { asyncHandler } from '../middleware/error-handler.js';

export function registerSchedulerRoutes(app, container) {
  const taskScheduler = container.resolve('TaskScheduler');

  app.post('/api/scheduler/schedule', asyncHandler(async (req, res) => {
    const { taskName, args, type, executeAt, cronExpression, intervalMs } = req.body;

    if (!taskName) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'taskName is required' }
      });
    }

    if (!type || !['once', 'recurring', 'interval'].includes(type)) {
      return res.status(400).json({
        error: { code: 'INVALID_INPUT', message: 'type must be one of: once, recurring, interval' }
      });
    }

    let result;

    if (type === 'once') {
      if (!executeAt) {
        return res.status(400).json({
          error: { code: 'INVALID_INPUT', message: 'executeAt is required for once schedules' }
        });
      }
      result = taskScheduler.scheduleOnce(taskName, args || [], executeAt);
    } else if (type === 'recurring') {
      if (!cronExpression) {
        return res.status(400).json({
          error: { code: 'INVALID_INPUT', message: 'cronExpression is required for recurring schedules' }
        });
      }
      result = taskScheduler.scheduleRecurring(taskName, args || [], cronExpression);
    } else if (type === 'interval') {
      if (!intervalMs) {
        return res.status(400).json({
          error: { code: 'INVALID_INPUT', message: 'intervalMs is required for interval schedules' }
        });
      }
      result = taskScheduler.scheduleInterval(taskName, args || [], intervalMs);
    }

    res.status(201).json({
      success: true,
      schedule: {
        id: result.id,
        taskName,
        type,
        status: result.status,
        createdAt: new Date().toISOString()
      }
    });
  }));

  app.get('/api/scheduler/scheduled', asyncHandler(async (req, res) => {
    const schedules = taskScheduler.getAllSchedules();
    res.json({
      success: true,
      count: schedules.length,
      schedules
    });
  }));

  app.get('/api/scheduler/stats', asyncHandler(async (req, res) => {
    const stats = taskScheduler.getStats();
    res.json({
      success: true,
      stats
    });
  }));

  app.get('/api/scheduler/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const schedule = taskScheduler.getSchedule(id);

    if (!schedule) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Schedule ${id} not found` }
      });
    }

    res.json({
      success: true,
      schedule
    });
  }));

  app.delete('/api/scheduler/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = taskScheduler.cancel(id);

    if (!result.success) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: result.error }
      });
    }

    res.json({
      success: true,
      message: 'Schedule cancelled'
    });
  }));

  app.get('/api/scheduler/:id/history', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;

    const schedule = taskScheduler.getSchedule(id);
    if (!schedule) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Schedule ${id} not found` }
      });
    }

    const history = taskScheduler.getExecutionHistory(id, limit);

    res.json({
      success: true,
      count: history.length,
      limit,
      history
    });
  }));

  app.put('/api/scheduler/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const result = taskScheduler.update(id, updates);

    if (!result.success) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: result.error }
      });
    }

    const schedule = taskScheduler.getSchedule(id);

    res.json({
      success: true,
      message: 'Schedule updated',
      schedule
    });
  }));
}
