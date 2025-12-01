import { registerFileReadOperations } from './file-read-operations.js';
import { registerFileWriteOperations } from './file-write-operations.js';
import { registerFileTransformOperations } from './file-transform-operations.js';

export function registerFileRoutes(app, container) {
  if (!container) throw new Error('Container required for FileRoutes');
  registerFileReadOperations(app);
  registerFileWriteOperations(app);
  registerFileTransformOperations(app);
}
