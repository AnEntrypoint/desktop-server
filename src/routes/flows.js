import { validateTaskName, sanitizeInput } from '@sequential/core';
import { createError, createValidationError } from '@sequential/error-handling';
import { validateParam } from '@sequential/param-validation';
import { asyncHandler } from '../middleware/error-handler.js';
import { executeTaskWithTimeout } from '@sequential/server-utilities';

export function registerFlowRoutes(app, container) {
  const repository = container.resolve('FlowRepository');
  const taskRepository = container.resolve('TaskRepository');

  app.get('/api/flows', asyncHandler(async (req, res) => {
    const flows = await repository.getAll();
    res.json(flows);
  }));

  app.get('/api/flows/:flowId', asyncHandler(async (req, res) => {
    const { flowId } = req.params;
    validateParam(validateTaskName, 'flowId')(flowId);
    const flow = await repository.get(flowId);
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

  app.post('/api/flows/run', asyncHandler(async (req, res) => {
    const { flowId, flow, input } = req.body;
    if (!flow || !flow.states) {
      throw createValidationError('flow with states is required', 'flow');
    }

    const startTime = Date.now();
    let currentState = flow.states.find(s => s.type === 'initial');
    if (!currentState) {
      throw createValidationError('flow must have an initial state', 'flow');
    }

    const executionLog = [];
    let result = input || {};
    let error = null;

    while (currentState && currentState.type !== 'final') {
      executionLog.push(`Executing state: ${currentState.id}`);
      try {
        if (currentState.handlerType === 'task' && currentState.taskName) {
          const task = await taskRepository.get(currentState.taskName);
          if (!task) {
            throw new Error(`Task not found: ${currentState.taskName}`);
          }
          const taskInput = currentState.taskInput ? JSON.parse(currentState.taskInput) : {};
          result = await executeTaskWithTimeout(currentState.taskName, task.code, taskInput, 30000);
          executionLog.push(`Task output: ${JSON.stringify(result)}`);
        } else if (currentState.code) {
          const code = currentState.code;
          result = await executeTaskWithTimeout(currentState.id, code, result, 30000);
          executionLog.push(`Code output: ${JSON.stringify(result)}`);
        }

        const nextStateId = currentState.onDone;
        currentState = flow.states.find(s => s.id === nextStateId);
      } catch (err) {
        error = err.message;
        executionLog.push(`Error: ${err.message}`);
        const fallbackStateId = currentState.onError;
        if (fallbackStateId) {
          currentState = flow.states.find(s => s.id === fallbackStateId);
          error = null;
        } else {
          break;
        }
      }
    }

    const duration = Date.now() - startTime;
    if (error) {
      res.json({ success: false, error, duration, executionLog });
    } else {
      res.json({
        success: true,
        duration,
        finalState: currentState?.id || 'unknown',
        result,
        executionLog
      });
    }
  }));
}
