import { createContainer } from '@sequential/dependency-injection';
import { TaskRepository } from '@sequential/data-access-layer';
import { FlowRepository } from '@sequential/data-access-layer';
import { TaskService } from '@sequential/task-execution-service';
import { CONFIG } from '../config/defaults.js';

export function setupDIContainer() {
  const container = createContainer();

  container.register('TaskRepository', () => new TaskRepository(), { singleton: true });

  container.register('FlowRepository', () => new FlowRepository(), { singleton: true });

  container.register('TaskService',
    (taskRepository) => new TaskService(taskRepository, { executionTimeoutMs: CONFIG.tasks.executionTimeoutMs }),
    {
      singleton: true,
      dependencies: ['TaskRepository']
    }
  );

  return container;
}

export function getActiveTasks(container) {
  const service = container.resolve('TaskService');
  return service.getActiveTasks();
}
