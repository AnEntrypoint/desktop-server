import { createContainer } from '@sequential/dependency-injection';
import { TaskRepository, FlowRepository, ToolRepository, FileRepository } from '@sequential/data-access-layer';
import { TaskService } from '@sequential/task-execution-service';
import { CONFIG } from '@sequential/server-utilities';

export function setupDIContainer() {
  const container = createContainer();

  container.register('TaskRepository', () => new TaskRepository(), { singleton: true });

  container.register('FlowRepository', () => new FlowRepository(), { singleton: true });

  container.register('ToolRepository', () => new ToolRepository(), { singleton: true });

  container.register('FileRepository', () => new FileRepository(), { singleton: true });

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
