import { asyncHandler } from '../middleware/error-handler.js';
import { createErrorResponse } from '@sequential/error-handling';

export function registerStorageObserverRoutes(app, container) {
  app.get('/api/storage/status', asyncHandler(async (req, res) => {
    const taskRepository = container.resolve('TaskRepository');
    const flowRepository = container.resolve('FlowRepository');

    const tasks = taskRepository.getAll();
    const flows = flowRepository.getAll();

    const status = {
      timestamp: new Date().toISOString(),
      storage: {
        tasks: tasks.length,
        flows: flows.length,
        totalItems: tasks.length + flows.length
      },
      memoryUsage: process.memoryUsage()
    };
    res.json(status);
  }));

  app.get('/api/storage/runs', asyncHandler((req, res) => {
    const runs = Array.from(STORAGE_STATE.runs.entries()).map(([id, data]) => ({
      id,
      ...data,
      timestamp: new Date(data.timestamp).toISOString()
    }));
    res.json({ runs, count: runs.length });
  }));

  app.get('/api/storage/runs/:runId', asyncHandler((req, res) => {
    const { runId } = req.params;
    const run = STORAGE_STATE.runs.get(runId);
    if (!run) {
      return res.status(404).json(createErrorResponse('RUN_NOT_FOUND', 'Run not found in storage'));
    }
    res.json(run);
  }));

  app.get('/api/storage/tasks', asyncHandler((req, res) => {
    const tasks = Array.from(STORAGE_STATE.tasks.entries()).map(([name, data]) => ({
      name,
      ...data
    }));
    res.json({ tasks, count: tasks.length });
  }));

  app.get('/api/storage/flows', asyncHandler((req, res) => {
    const flows = Array.from(STORAGE_STATE.flows.entries()).map(([id, data]) => ({
      id,
      ...data
    }));
    res.json({ flows, count: flows.length });
  }));

  app.get('/api/storage/tools', asyncHandler((req, res) => {
    const tools = Array.from(STORAGE_STATE.tools.entries()).map(([id, data]) => ({
      id,
      ...data
    }));
    res.json({ tools, count: tools.length });
  }));

  app.get('/api/storage/app-state', asyncHandler((req, res) => {
    const appState = Array.from(STORAGE_STATE.appState.entries()).map(([appId, state]) => ({
      appId,
      ...state
    }));
    res.json({ appState, count: appState.length });
  }));


  app.get('/api/storage/export', asyncHandler((req, res) => {
    const exported = {
      timestamp: new Date().toISOString(),
      runs: Array.from(STORAGE_STATE.runs.entries()).map(([id, data]) => ({ id, ...data })),
      tasks: Array.from(STORAGE_STATE.tasks.entries()).map(([name, data]) => ({ name, ...data })),
      flows: Array.from(STORAGE_STATE.flows.entries()).map(([id, data]) => ({ id, ...data })),
      tools: Array.from(STORAGE_STATE.tools.entries()).map(([id, data]) => ({ id, ...data })),
      appState: Array.from(STORAGE_STATE.appState.entries()).map(([appId, state]) => ({ appId, ...state }))
    };

    const filename = `storage-export-${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.json(exported);
  }));
}

