import { asyncHandler } from '../middleware/error-handler.js';
import { formatResponse, formatError } from '@sequential/response-formatting';

export function registerStorageObserverRoutes(app, container) {
  app.get('/api/storage/status', asyncHandler(async (req, res) => {
    const taskRepository = container.resolve('TaskRepository');
    const flowRepository = container.resolve('FlowRepository');
    const stateManager = container.resolve('StateManager');

    const tasks = taskRepository.getAll();
    const flows = flowRepository.getAll();
    const stats = stateManager.getCacheStats();

    const status = {
      timestamp: new Date().toISOString(),
      storage: {
        tasks: tasks.length,
        flows: flows.length,
        totalItems: tasks.length + flows.length
      },
      cache: stats,
      memoryUsage: process.memoryUsage()
    };
    res.json(formatResponse({ status }));
  }));

  app.get('/api/storage/runs', asyncHandler(async (req, res) => {
    const stateManager = container.resolve('StateManager');
    const runs = await stateManager.getAll('runs');
    res.json(formatResponse({ runs, count: runs.length }));
  }));

  app.get('/api/storage/runs/:runId', asyncHandler(async (req, res) => {
    const stateManager = container.resolve('StateManager');
    const { runId } = req.params;
    const run = await stateManager.get('runs', runId);
    if (!run) {
      return res.status(404).json(formatError(404, { code: 'RUN_NOT_FOUND', message: 'Run not found in storage' }));
    }
    res.json(formatResponse({ run }));
  }));

  app.get('/api/storage/tasks', asyncHandler(async (req, res) => {
    const stateManager = container.resolve('StateManager');
    const tasks = await stateManager.getAll('tasks');
    res.json(formatResponse({ tasks, count: tasks.length }));
  }));

  app.get('/api/storage/flows', asyncHandler(async (req, res) => {
    const stateManager = container.resolve('StateManager');
    const flows = await stateManager.getAll('flows');
    res.json(formatResponse({ flows, count: flows.length }));
  }));

  app.get('/api/storage/tools', asyncHandler(async (req, res) => {
    const stateManager = container.resolve('StateManager');
    const tools = await stateManager.getAll('tools');
    res.json(formatResponse({ tools, count: tools.length }));
  }));

  app.get('/api/storage/app-state', asyncHandler(async (req, res) => {
    const stateManager = container.resolve('StateManager');
    const appState = await stateManager.getAll('appState');
    res.json(formatResponse({ appState, count: appState.length }));
  }));

  app.get('/api/storage/export', asyncHandler(async (req, res) => {
    const stateManager = container.resolve('StateManager');
    const exported = {
      timestamp: new Date().toISOString(),
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

