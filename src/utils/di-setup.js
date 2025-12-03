import path from 'path';
import os from 'os';
import { createContainer } from '@sequential/dependency-injection';
import { TaskRepository, FlowRepository, ToolRepository, FileRepository } from '@sequential/data-access-layer';
import { TaskService } from '@sequential/task-execution-service';
import { CONFIG } from '@sequential/server-utilities';
import { delay, withRetry } from '@sequential/async-patterns';

export function setupDIContainer() {
  const container = createContainer();

  const ecosystemPath = process.env.ECOSYSTEM_PATH || path.join(os.homedir(), 'sequential-ecosystem');
  const tasksDir = path.join(ecosystemPath, 'tasks');
  const flowsDir = path.join(ecosystemPath, 'flows');
  const toolsDir = path.join(ecosystemPath, 'tools');

  container.register('TaskRepository', () => new TaskRepository(tasksDir), { singleton: true });

  container.register('FlowRepository', () => new FlowRepository(flowsDir), { singleton: true });

  container.register('ToolRepository', () => new ToolRepository(toolsDir), { singleton: true });

  container.register('FileRepository', () => new FileRepository(), { singleton: true });

  container.register('TaskService',
    (taskRepository, toolRepository) => new TaskService(taskRepository, toolRepository, { executionTimeoutMs: CONFIG.tasks.executionTimeoutMs }),
    {
      singleton: true,
      dependencies: ['TaskRepository', 'ToolRepository']
    }
  );

  return container;
}

export function getActiveTasks(container) {
  const service = container.resolve('TaskService');
  return service.getActiveTasks();
}
