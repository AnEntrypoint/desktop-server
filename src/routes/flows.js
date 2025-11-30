import path from 'path';
import fs from 'fs-extra';
import { createErrorResponse } from '../utils/error-factory.js';
import { asyncHandler } from '../middleware/error-handler.js';

export function registerFlowRoutes(app) {
  app.get('/api/flows', asyncHandler(async (req, res) => {
    const tasksDir = path.join(process.cwd(), 'tasks');
    if (!fs.existsSync(tasksDir)) {
      return res.json([]);
    }
    const flows = [];
    const tasks = fs.readdirSync(tasksDir)
      .filter(f => fs.statSync(path.join(tasksDir, f)).isDirectory());
    for (const name of tasks) {
      const graphPath = path.join(tasksDir, name, 'graph.json');
      if (fs.existsSync(graphPath)) {
        try {
          const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
          flows.push({ id: name, name, graph });
        } catch (e) {}
      }
    }
    res.json(flows);
  }));

  app.get('/api/flows/:flowId', asyncHandler(async (req, res) => {
    const graphPath = path.join(process.cwd(), 'tasks', req.params.flowId, 'graph.json');
    if (!fs.existsSync(graphPath)) {
      return res.status(404).json(createErrorResponse('FLOW_NOT_FOUND', 'Flow not found'));
    }
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    res.json({ id: req.params.flowId, graph });
  }));

  app.post('/api/flows', asyncHandler(async (req, res) => {
    const { id, name, states } = req.body;
    if (!id || !name) {
      return res.status(400).json(createErrorResponse('INVALID_INPUT', 'id and name are required'));
    }
    const taskDir = path.join(process.cwd(), 'tasks', id);
    await fs.ensureDir(taskDir);
    const graph = {
      id: id,
      initial: states?.find(s => s.type === 'initial')?.id || states?.[0]?.id || 'start',
      states: (states || []).reduce((acc, state) => {
        acc[state.id] = {
          type: state.type === 'final' ? 'final' : undefined,
          onDone: state.onDone || undefined,
          onError: state.onError || undefined
        };
        Object.keys(acc[state.id]).forEach(key =>
          acc[state.id][key] === undefined && delete acc[state.id][key]
        );
        return acc;
      }, {})
    };
    await fs.writeJSON(path.join(taskDir, 'graph.json'), graph, { spaces: 2 });
    const configPath = path.join(taskDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      await fs.writeJSON(configPath, {
        name: id,
        runner: 'flow',
        inputs: []
      }, { spaces: 2 });
    }
    res.json({ success: true, id, message: `Flow saved to ${taskDir}` });
  }));
}
