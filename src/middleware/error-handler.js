import { createErrorHandler as createAppErrorHandler } from '@sequential/error-handling';

const operationLog = [];

export function createErrorHandler() {
  return createAppErrorHandler();
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function logOperation(type, data) {
  operationLog.push({
    type,
    data,
    timestamp: new Date().toISOString()
  });
}

export function getOperationLog() {
  return operationLog;
}
