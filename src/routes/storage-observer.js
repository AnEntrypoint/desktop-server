import { asyncHandler } from '../middleware/error-handler.js';
import { createErrorResponse } from '../utils/error-factory.js';

const storageState = {
  runs: new Map(),
  tasks: new Map(),
  flows: new Map(),
  tools: new Map(),
  appState: new Map()
};

export function registerStorageObserverRoutes(app) {
  app.get('/api/storage/status', asyncHandler((req, res) => {
    const status = {
      timestamp: new Date().toISOString(),
      storage: {
        runs: storageState.runs.size,
        tasks: storageState.tasks.size,
        flows: storageState.flows.size,
        tools: storageState.tools.size,
        appState: storageState.appState.size
      },
      totalItems: Array.from(storageState).reduce((acc, [, map]) => acc + map.size, 0),
      memoryUsage: process.memoryUsage()
    };
    res.json(status);
  }));

  app.get('/api/storage/runs', asyncHandler((req, res) => {
    const runs = Array.from(storageState.runs.entries()).map(([id, data]) => ({
      id,
      ...data,
      timestamp: new Date(data.timestamp).toISOString()
    }));
    res.json({ runs, count: runs.length });
  }));

  app.get('/api/storage/runs/:runId', asyncHandler((req, res) => {
    const { runId } = req.params;
    const run = storageState.runs.get(runId);
    if (!run) {
      return res.status(404).json(createErrorResponse('RUN_NOT_FOUND', 'Run not found in storage'));
    }
    res.json(run);
  }));

  app.get('/api/storage/tasks', asyncHandler((req, res) => {
    const tasks = Array.from(storageState.tasks.entries()).map(([name, data]) => ({
      name,
      ...data
    }));
    res.json({ tasks, count: tasks.length });
  }));

  app.get('/api/storage/flows', asyncHandler((req, res) => {
    const flows = Array.from(storageState.flows.entries()).map(([id, data]) => ({
      id,
      ...data
    }));
    res.json({ flows, count: flows.length });
  }));

  app.get('/api/storage/tools', asyncHandler((req, res) => {
    const tools = Array.from(storageState.tools.entries()).map(([id, data]) => ({
      id,
      ...data
    }));
    res.json({ tools, count: tools.length });
  }));

  app.get('/api/storage/app-state', asyncHandler((req, res) => {
    const appState = Array.from(storageState.appState.entries()).map(([appId, state]) => ({
      appId,
      ...state
    }));
    res.json({ appState, count: appState.length });
  }));

  app.post('/api/storage/store/:type/:id', asyncHandler((req, res) => {
    const { type, id } = req.params;
    const data = req.body;

    if (!['runs', 'tasks', 'flows', 'tools', 'appState'].includes(type)) {
      return res.status(400).json(createErrorResponse('INVALID_TYPE', 'Invalid storage type'));
    }

    const map = storageState[type];
    map.set(id, { ...data, storedAt: new Date().toISOString() });

    res.json({ success: true, type, id, stored: map.has(id) });
  }));

  app.get('/api/storage/clear/:type', asyncHandler((req, res) => {
    const { type } = req.params;

    if (type === 'all') {
      Object.values(storageState).forEach(map => map.clear());
      return res.json({ success: true, message: 'All storage cleared' });
    }

    if (!storageState[type]) {
      return res.status(400).json(createErrorResponse('INVALID_TYPE', 'Invalid storage type'));
    }

    const count = storageState[type].size;
    storageState[type].clear();
    res.json({ success: true, type, cleared: count });
  }));

  app.get('/api/storage/export', asyncHandler((req, res) => {
    const exported = {
      timestamp: new Date().toISOString(),
      runs: Array.from(storageState.runs.entries()).map(([id, data]) => ({ id, ...data })),
      tasks: Array.from(storageState.tasks.entries()).map(([name, data]) => ({ name, ...data })),
      flows: Array.from(storageState.flows.entries()).map(([id, data]) => ({ id, ...data })),
      tools: Array.from(storageState.tools.entries()).map(([id, data]) => ({ id, ...data })),
      appState: Array.from(storageState.appState.entries()).map(([appId, state]) => ({ appId, ...state }))
    };

    const filename = `storage-export-${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.json(exported);
  }));
}

export function getStorageState() {
  return storageState;
}

export function storeRun(runId, runData) {
  storageState.runs.set(runId, { ...runData, storedAt: new Date().toISOString() });
}

export function storeTask(taskName, taskData) {
  storageState.tasks.set(taskName, { ...taskData, storedAt: new Date().toISOString() });
}

export function storeFlow(flowId, flowData) {
  storageState.flows.set(flowId, { ...flowData, storedAt: new Date().toISOString() });
}

export function storeTool(toolId, toolData) {
  storageState.tools.set(toolId, { ...toolData, storedAt: new Date().toISOString() });
}

export function storeAppState(appId, state) {
  storageState.appState.set(appId, { ...state, storedAt: new Date().toISOString() });
}
