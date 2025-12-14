import { createErrorHandler as createAppErrorHandler } from '@sequentialos/error-handling';
import { nowISO, createTimestamps, updateTimestamp } from '@sequentialos/timestamp-utilities';

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
    timestamp: nowISO()
  });
}

export function getOperationLog() {
  return operationLog;
}
