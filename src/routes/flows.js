import path from 'path';
import fs from 'fs-extra';
import { validateTaskName, sanitizeInput } from '../lib/utils.js';
import { createErrorResponse, createValidationError, createForbiddenError } from '../utils/error-factory.js';
import { validateParam } from '../middleware/param-validator.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { writeFileAtomicJson } from '../utils/file-ops.js';
import { FileStore } from '../lib/file-store.js';

export function registerFlowRoutes(app) {
  const tasksStore = new FileStore(path.join(process.cwd(), 'tasks'));

  app.get('/api/flows', asyncHandler(async (req, res) => {
    const tasks = tasksStore.listDirectories();
    const flows = [];
    for (const task of tasks) {
      const graphPath = path.join(process.cwd(), 'tasks', task.id, 'graph.json');
      if (fs.existsSync(graphPath)) {
        try {
          const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
          flows.push({ id: task.id, name: task.name, graph });
        } catch (e) {}
      }
    }
    res.json(flows);
  }));

  app.get('/api/flows/:flowId', asyncHandler(async (req, res) => {
    const { flowId } = req.params;
    validateParam(validateTaskName, 'flowId')(flowId);

    const taskDir = path.join(process.cwd(), 'tasks', flowId);
    const realTaskDir = path.resolve(taskDir);
    if (!realTaskDir.startsWith(process.cwd())) {
      throw createForbiddenError(`Access to flow '${flowId}' denied`);
    }

    const graphPath = path.join(taskDir, 'graph.json');
    if (!fs.existsSync(graphPath)) {
      return res.status(404).json(createErrorResponse('FLOW_NOT_FOUND', 'Flow not found'));
    }

    try {
      const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
      res.json({ id: flowId, graph });
    } catch (e) {
      throw createValidationError('Invalid flow file format', 'graph');
    }
  }));

  app.post('/api/flows', asyncHandler(async (req, res) => {
    const { id, name, states } = req.body;

    if (!id || !name) {
      throw createValidationError('id and name are required', 'flowDefinition');
    }

    validateParam(validateTaskName, 'id')(id);

    const sanitizedName = sanitizeInput(name);
    if (typeof sanitizedName !== 'string' || sanitizedName.length === 0) {
      throw createValidationError('name must be a non-empty string', 'name');
    }

    if (states && !Array.isArray(states)) {
      throw createValidationError('states must be an array', 'states');
    }

    if (states && states.length > 0) {
      for (let i = 0; i < states.length; i++) {
        const state = states[i];
        if (!state.id || typeof state.id !== 'string') {
          throw createValidationError(`states[${i}].id is required and must be a string`, 'states');
        }
        if (!/^[a-zA-Z0-9._-]+$/.test(state.id)) {
          throw createValidationError(`states[${i}].id contains invalid characters`, 'states');
        }
      }
    }

    const taskDir = path.join(process.cwd(), 'tasks', id);
    const realTaskDir = path.resolve(taskDir);
    if (!realTaskDir.startsWith(process.cwd())) {
      throw createForbiddenError(`Access to flow '${id}' denied`);
    }

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

    await writeFileAtomicJson(path.join(taskDir, 'graph.json'), graph);
    const configPath = path.join(taskDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      await writeFileAtomicJson(configPath, {
        name: sanitizedName,
        runner: 'flow',
        inputs: []
      });
    }
    res.json({ success: true, id, message: `Flow saved to ${taskDir}` });
  }));
}
