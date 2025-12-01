import { registerFileReadOperations } from './file-read-operations.js';
import { registerFileWriteOperations } from './file-write-operations.js';
import { registerFileTransformOperations } from './file-transform-operations.js';
import { createServerError } from '@sequential/error-handling';

export function registerFileRoutes(app, container) {
  if (!container) throw createServerError('Container required for FileRoutes');
  registerFileReadOperations(app);
  registerFileWriteOperations(app);
  registerFileTransformOperations(app);
}
