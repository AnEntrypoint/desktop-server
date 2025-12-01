import { validateFilePath } from '../lib/utils.js';
import { createDetailedErrorResponse } from '../utils/error-logger.js';
import { broadcastToFileSubscribers } from '../utils/ws-broadcaster.js';

export function broadcastFileEvent(eventType, filePath, data = {}) {
  broadcastToFileSubscribers({
    type: eventType,
    path: filePath,
    timestamp: new Date().toISOString(),
    ...data
  });
}

export function handleFileError(operation, filePath, error, res, contentLength = 0) {
  const errorResponse = createDetailedErrorResponse(operation, filePath, error, 500);
  return res.status(errorResponse.statusCode).json(errorResponse.error);
}

export function validateAndResolvePath(filePath) {
  return validateFilePath(filePath);
}

export function startTiming() {
  return Date.now();
}

export function getDuration(startTime) {
  return Date.now() - startTime;
}
