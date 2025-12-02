import { validateTaskName } from '@sequential/core';
import { createError, createValidationError } from '@sequential/error-handling';
import { validateParam, sanitizeInput } from '@sequential/param-validation';
import { asyncHandler } from '../middleware/error-handler.js';
import { executeTaskWithTimeout, backgroundTaskManager } from '@sequential/server-utilities';
import { formatResponse, formatError } from '@sequential/response-formatting';

export function registerFlowRoutes(app, container) {
  const repository = container.resolve('FlowRepository');
  const taskRepository = container.resolve('TaskRepository');
  const taskService = container.resolve('TaskService');

  app.get('/api/flows', asyncHandler(async (req, res) => {
    const flows = await repository.getAll();
    res.json(formatResponse(flows));
  }));

  app.get('/api/flows/:flowId', asyncHandler(async (req, res) => {
    const { flowId } = req.params;
    validateParam(validateTaskName, 'flowId')(flowId);
    const flow = await repository.get(flowId);
    res.json(formatResponse(flow));
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
          handlerType: state.handlerType,
          taskName: state.taskName,
          taskInput: state.taskInput,
          timeout: state.timeout || undefined,
          code: state.code,
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
    res.json(formatResponse({ success: true, id, message: 'Flow saved' }));
  }));

  app.post('/api/flows/run', asyncHandler(async (req, res) => {
    const { flowId, flow, input } = req.body;
    if (!flow || !flow.states) {
      throw createValidationError('flow with states is required', 'flow');
    }

    const startTime = Date.now();

    const statesArray = Array.isArray(flow.states)
      ? flow.states
      : Object.entries(flow.states).map(([id, state]) => ({ id, ...state }));

    let currentState = statesArray.find(s => s.type === 'initial' || s.id === flow.initial);
    if (!currentState) {
      throw createValidationError('flow must have an initial state', 'flow');
    }

    const executionLog = [];
    let result = input || {};
    let error = null;

    while (currentState && currentState.type !== 'final') {
      executionLog.push(`Executing state: ${currentState.id}`);
      try {
        if (currentState.handlerType === 'background-task' && currentState.taskName) {
          const { id: bgTaskId } = backgroundTaskManager.spawn(currentState.taskName, [], {});
          const timeout = currentState.timeout || 30000;
          const bgResult = await Promise.race([
            backgroundTaskManager.waitFor(bgTaskId),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Background task timeout after ${timeout}ms`)), timeout)
            )
          ]);
          result = { taskId: bgTaskId, status: bgResult.status, duration: bgResult.duration };
          if (bgResult.status !== 'completed') {
            throw new Error(`Background task failed: ${bgResult.error || bgResult.status}`);
          }
          executionLog.push(`Background task completed: ${bgTaskId}`);
        } else if (currentState.handlerType === 'task' && currentState.taskName) {
          const task = await taskRepository.get(currentState.taskName);
          if (!task) {
            throw new Error(`Task not found: ${currentState.taskName}`);
          }
          const taskInput = currentState.taskInput ? JSON.parse(currentState.taskInput) : {};
          const runId = taskService.createRunId();
          result = await taskService.executeTask(runId, currentState.taskName, task.code, taskInput);
          executionLog.push(`Task output: ${JSON.stringify(result)}`);
        } else if (currentState.code) {
          const code = currentState.code;
          result = await executeTaskWithTimeout(currentState.id, code, result, 30000);
          executionLog.push(`Code output: ${JSON.stringify(result)}`);
        }

        const nextStateId = currentState.onDone;
        currentState = statesArray.find(s => s.id === nextStateId);
      } catch (err) {
        error = err.message;
        executionLog.push(`Error: ${err.message}`);
        const fallbackStateId = currentState.onError;
        if (fallbackStateId) {
          currentState = statesArray.find(s => s.id === fallbackStateId);
          error = null;
        } else {
          break;
        }
      }
    }

    const duration = Date.now() - startTime;
    if (error) {
      res.status(500).json(formatError(500, { code: 'FLOW_EXECUTION_FAILED', message: error, duration, executionLog }));
    } else {
      res.json(formatResponse({
        duration,
        finalState: currentState?.id || 'unknown',
        result,
        executionLog
      }));
    }
  }));
}
