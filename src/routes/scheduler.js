import { asyncHandler } from '../middleware/error-handler.js';
import { formatResponse } from '@sequential/response-formatting';
import { parseResourceId, requireResource } from '@sequential/route-helpers';
import { nowISO } from '@sequential/timestamp-utilities';
import { throwValidationError, throwNotFound } from '@sequential/error-handling';
import { createServiceFactory } from '@sequential/service-factory';

export function registerSchedulerRoutes(app, container) {
  const { getTaskScheduler } = createServiceFactory(container);
  const taskScheduler = getTaskScheduler();

  app.post('/api/scheduler/schedule', asyncHandler(async (req, res) => {
    const { taskName, args, type, executeAt, cronExpression, intervalMs } = req.body;
    if (!taskName) throwValidationError('taskName', 'taskName is required');
    if (!type || !['once', 'recurring', 'interval'].includes(type)) {
      throwValidationError('type', 'type must be one of: once, recurring, interval');
    }

    let result;
    if (type === 'once') {
      if (!executeAt) throwValidationError('executeAt', 'executeAt is required for once schedules');
      result = taskScheduler.scheduleOnce(taskName, args || [], executeAt);
    } else if (type === 'recurring') {
      if (!cronExpression) throwValidationError('cronExpression', 'cronExpression is required for recurring schedules');
      result = taskScheduler.scheduleRecurring(taskName, args || [], cronExpression);
    } else {
      if (!intervalMs) throwValidationError('intervalMs', 'intervalMs is required for interval schedules');
      result = taskScheduler.scheduleInterval(taskName, args || [], intervalMs);
    }
    res.status(201).json(formatResponse({ schedule: { id: result.id, taskName, type, status: result.status, createdAt: nowISO() } }));
  }));

  app.get('/api/scheduler/scheduled', asyncHandler(async (req, res) => {
    const schedules = taskScheduler.getAllSchedules();
    res.json(formatResponse({ count: schedules.length, schedules }));
  }));

  app.get('/api/scheduler/stats', asyncHandler(async (req, res) => {
    res.json(formatResponse({ stats: taskScheduler.getStats() }));
  }));

  app.get('/api/scheduler/:id', asyncHandler(async (req, res) => {
    const schedule = taskScheduler.getSchedule(req.params.id);
    requireResource(schedule, 'Schedule', req.params.id);
    res.json(formatResponse({ schedule }));
  }));

  app.delete('/api/scheduler/:id', asyncHandler(async (req, res) => {
    const result = taskScheduler.cancel(req.params.id);
    if (!result.success) throwNotFound('Schedule', req.params.id);
    res.json(formatResponse({ message: 'Schedule cancelled' }));
  }));

  app.get('/api/scheduler/:id/history', asyncHandler(async (req, res) => {
    const schedule = taskScheduler.getSchedule(req.params.id);
    requireResource(schedule, 'Schedule', req.params.id);
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const history = taskScheduler.getExecutionHistory(req.params.id, limit);
    res.json(formatResponse({ count: history.length, limit, history }));
  }));

  app.put('/api/scheduler/:id', asyncHandler(async (req, res) => {
    const result = taskScheduler.update(req.params.id, req.body);
    if (!result.success) throwNotFound('Schedule', req.params.id);
    const schedule = taskScheduler.getSchedule(req.params.id);
    res.json(formatResponse({ message: 'Schedule updated', schedule }));
  }));
}
