import { validateTaskName, validateParam, sanitizeInput } from '@sequentialos/core';
import { createValidationError, throwValidationError } from '@sequentialos/error-handling';
import { asyncHandler } from '../middleware/error-handler.js';
import { executeTaskWithTimeout, backgroundTaskManager } from '@sequentialos/server-utilities';
import { formatResponse, formatError } from '@sequentialos/response-formatting';
import { registerCRUDRoutes } from '@sequentialos/crud-router';
import { createServiceFactory } from '@sequentialos/service-factory';

export function registerFlowRoutes(app, container) {
  const { getFlowRepository, getTaskRepository, getTaskService } = createServiceFactory(container);
  const repository = getFlowRepository();
  const taskRepository = getTaskRepository();
  const taskService = getTaskService();

  const flowHandlers = {
    create: asyncHandler(async (req, res) => {
      const { id, name, states } = req.body;
      if (!id || !name) throwValidationError('flowDefinition', 'id and name are required');
      validateParam(validateTaskName, 'id')(id);

      const sanitizedName = sanitizeInput(name);
      if (typeof sanitizedName !== 'string' || sanitizedName.length === 0) {
        throwValidationError('name', 'name must be a non-empty string');
      }

      if (states && !Array.isArray(states)) throwValidationError('states', 'states must be an array');
      if (states?.length > 0) {
        for (let i = 0; i < states.length; i++) {
          if (!states[i].id || typeof states[i].id !== 'string') {
            throwValidationError('states', `states[${i}].id is required and must be a string`);
          }
          if (!/^[a-zA-Z0-9._-]+$/.test(states[i].id)) {
            throwValidationError('states', `states[${i}].id contains invalid characters`);
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
          Object.keys(acc[state.id]).forEach(key => acc[state.id][key] === undefined && delete acc[state.id][key]);
          return acc;
        }, {})
      };

      await repository.save(id, graph, { name: sanitizedName, runner: 'flow', inputs: [] });
      res.json(formatResponse({ success: true, id, message: 'Flow saved' }));
    }),

    run: asyncHandler(async (req, res) => {
      const { flow, input } = req.body;
      if (!flow?.states) throwValidationError('flow', 'flow with states is required');

      const startTime = Date.now();
      const statesArray = Array.isArray(flow.states) ? flow.states : Object.entries(flow.states).map(([id, state]) => ({ id, ...state }));
      let currentState = statesArray.find(s => s.type === 'initial' || s.id === flow.initial);
      if (!currentState) throwValidationError('flow', 'flow must have an initial state');

      const executionLog = [];
      let result = input || {};
      let error = null;

      while (currentState?.type !== 'final') {
        executionLog.push(`Executing state: ${currentState.id}`);
        try {
          if (currentState.handlerType === 'background-task' && currentState.taskName) {
            const { id: bgTaskId } = backgroundTaskManager.spawn(currentState.taskName, [], {});
            const timeout = currentState.timeout || 30000;
            const bgResult = await Promise.race([
              backgroundTaskManager.waitFor(bgTaskId),
              new Promise((_, reject) => setTimeout(() => reject(new Error(`Background task timeout after ${timeout}ms`)), timeout))
            ]);
            result = { taskId: bgTaskId, status: bgResult.status, duration: bgResult.duration };
            if (bgResult.status !== 'completed') throw new Error(`Background task failed: ${bgResult.error || bgResult.status}`);
            executionLog.push(`Background task completed: ${bgTaskId}`);
          } else if (currentState.handlerType === 'task' && currentState.taskName) {
            const task = await taskRepository.get(currentState.taskName);
            if (!task) throw new Error(`Task not found: ${currentState.taskName}`);
            const runId = taskService.createRunId();
            result = await taskService.executeTask(runId, currentState.taskName, task.code, currentState.taskInput ? JSON.parse(currentState.taskInput) : {});
            executionLog.push(`Task output: ${JSON.stringify(result)}`);
          } else if (currentState.code) {
            result = await executeTaskWithTimeout(currentState.id, currentState.code, result, 30000);
            executionLog.push(`Code output: ${JSON.stringify(result)}`);
          }
          currentState = statesArray.find(s => s.id === currentState.onDone);
        } catch (err) {
          error = err.message;
          executionLog.push(`Error: ${err.message}`);
          const fallbackState = statesArray.find(s => s.id === currentState.onError);
          if (fallbackState) {
            currentState = fallbackState;
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
        res.json(formatResponse({ duration, finalState: currentState?.id || 'unknown', result, executionLog }));
      }
    })
  };

  registerCRUDRoutes(app, '/api/flows', {
    repository,
    resourceName: 'flow',
    pluralName: 'flows',
    asyncHandler,
    customEndpoints: (router) => {
      router.post('', flowHandlers.create);
      router.post('/run', flowHandlers.run);
    }
  });
}
