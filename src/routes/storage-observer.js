import { asyncHandler } from '../middleware/error-handler.js';
import { formatResponse } from '@sequentialos/response-formatting';
import { nowISO } from '@sequentialos/timestamp-utilities';
import { throwNotFound } from '@sequentialos/error-handling';
import { createServiceFactory } from '@sequentialos/service-factory';

export function registerStorageObserverRoutes(app, container) {
  const { getTaskRepository, getFlowRepository, getStateManager } = createServiceFactory(container);
  const taskRepository = getTaskRepository();
  const flowRepository = getFlowRepository();
  const stateManager = getStateManager();

  app.get('/api/storage/status', asyncHandler(async (req, res) => {
    const tasks = taskRepository.getAll(), flows = flowRepository.getAll(), stats = stateManager.getCacheStats();
    res.json(formatResponse({
      status: {
        timestamp: nowISO(),
        storage: { tasks: tasks.length, flows: flows.length, totalItems: tasks.length + flows.length },
        cache: stats,
        memoryUsage: process.memoryUsage()
      }
    }));
  }));

  app.get('/api/storage/runs', asyncHandler(async (req, res) => {
    const runs = await stateManager.getAll('runs');
    res.json(formatResponse({ runs, count: runs.length }));
  }));

  app.get('/api/storage/runs/:runId', asyncHandler(async (req, res) => {
    const run = await stateManager.get('runs', req.params.runId);
    if (!run) throwNotFound('Run', req.params.runId);
    res.json(formatResponse({ run }));
  }));

  app.get('/api/storage/tasks', asyncHandler(async (req, res) => {
    const tasks = await stateManager.getAll('tasks');
    res.json(formatResponse({ tasks, count: tasks.length }));
  }));

  app.get('/api/storage/flows', asyncHandler(async (req, res) => {
    const flows = await stateManager.getAll('flows');
    res.json(formatResponse({ flows, count: flows.length }));
  }));

  app.get('/api/storage/tools', asyncHandler(async (req, res) => {
    const tools = await stateManager.getAll('tools');
    res.json(formatResponse({ tools, count: tools.length }));
  }));

  app.get('/api/storage/app-state', asyncHandler(async (req, res) => {
    const appState = await stateManager.getAll('appState');
    res.json(formatResponse({ appState, count: appState.length }));
  }));

  app.get('/api/storage/export', asyncHandler(async (req, res) => {
    const exported = {
      timestamp: nowISO(),
      runs: await stateManager.getAll('runs'),
      tasks: await stateManager.getAll('tasks'),
      flows: await stateManager.getAll('flows'),
      tools: await stateManager.getAll('tools'),
      appState: await stateManager.getAll('appState')
    };

    const filename = `storage-export-${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.json(formatResponse({ exported }));
  }));
}

