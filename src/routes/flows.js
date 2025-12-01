import { validateTaskName, sanitizeInput } from '../lib/utils.js';
import { createError, createValidationError } from '@sequential/error-handling';
import { createParamValidator } from '@sequential/param-validation';
import { asyncHandler } from '../middleware/error-handler.js';

export function registerFlowRoutes(app, container) {
  const repository = container.resolve('FlowRepository');

  app.get('/api/flows', asyncHandler(async (req, res) => {
    const flows = repository.getAll();
    res.json(flows);
  }));

  app.get('/api/flows/:flowId', asyncHandler(async (req, res) => {
    const { flowId } = req.params;
    validateParam(validateTaskName, 'flowId')(flowId);
    const flow = repository.get(flowId);
    res.json(flow);
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

    const graph = {
      id,
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

    const config = { name: sanitizedName, runner: 'flow', inputs: [] };
    await repository.save(id, graph, config);
    res.json({ success: true, id, message: 'Flow saved' });
  }));
}
