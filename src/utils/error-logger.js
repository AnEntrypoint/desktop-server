import { CONFIG } from '../config/defaults.js';

const ERROR_CATEGORIES = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  PATH_TRAVERSAL: 'PATH_TRAVERSAL',
  INVALID_INPUT: 'INVALID_INPUT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  ENCODING_ERROR: 'ENCODING_ERROR',
  DISK_SPACE: 'DISK_SPACE',
  OPERATION_FAILED: 'OPERATION_FAILED',
  UNKNOWN: 'UNKNOWN'
};

function categorizeError(error) {
  const message = error.message || '';
  const code = error.code || '';

  if (code === 'ENOENT' || message.includes('not found')) {
    return ERROR_CATEGORIES.FILE_NOT_FOUND;
  }
  if (code === 'EACCES' || code === 'EPERM' || message.includes('Permission denied')) {
    return ERROR_CATEGORIES.PERMISSION_DENIED;
  }
  if (message.includes('path traversal')) {
    return ERROR_CATEGORIES.PATH_TRAVERSAL;
  }
  if (message.includes('Invalid') || message.includes('invalid')) {
    return ERROR_CATEGORIES.INVALID_INPUT;
  }
  if (message.includes('too large') || code === 'EFBIG') {
    return ERROR_CATEGORIES.FILE_TOO_LARGE;
  }
  if (message.includes('encoding') || code === 'EILSEQ') {
    return ERROR_CATEGORIES.ENCODING_ERROR;
  }
  if (code === 'ENOSPC') {
    return ERROR_CATEGORIES.DISK_SPACE;
  }

  return ERROR_CATEGORIES.UNKNOWN;
}

function getStackTrace(error, limit = 5) {
  if (!error.stack) return [];
  return error.stack.split('\n').slice(1, limit + 1).map(line => line.trim());
}

export function logFileOperation(operation, filePath, error, context = {}) {
  const category = categorizeError(error);
  const timestamp = new Date().toISOString();
  const stackTrace = getStackTrace(error);

  const logEntry = {
    timestamp,
    operation,
    category,
    filePath,
    error: {
      message: error.message || 'Unknown error',
      code: error.code || null,
      stack: stackTrace
    },
    context,
    severity: getSeverity(category)
  };

  if (process.env.DEBUG || category === ERROR_CATEGORIES.PATH_TRAVERSAL) {
    console.error(`[FileOp:${category}] ${operation} failed on ${filePath}:`, logEntry);
  }

  return logEntry;
}

export function logFileSuccess(operation, filePath, duration = 0, metadata = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    operation,
    status: 'success',
    filePath,
    durationMs: duration,
    metadata,
    severity: 'info'
  };

  if (process.env.DEBUG) {
    console.log(`[FileOp:Success] ${operation} completed in ${duration}ms`);
  }

  return logEntry;
}

export function logBatchFileOperation(operation, fileCount, error, duration = 0) {
  const category = error ? categorizeError(error) : 'SUCCESS';
  const timestamp = new Date().toISOString();

  const logEntry = {
    timestamp,
    operation,
    category,
    fileCount,
    durationMs: duration,
    error: error ? {
      message: error.message || 'Unknown error',
      code: error.code || null
    } : null,
    severity: error ? getSeverity(category) : 'info'
  };

  if (process.env.DEBUG || error) {
    console.log(`[FileOp:Batch] ${operation} on ${fileCount} files:`, logEntry);
  }

  return logEntry;
}

function getSeverity(category) {
  switch (category) {
    case ERROR_CATEGORIES.PATH_TRAVERSAL:
    case ERROR_CATEGORIES.PERMISSION_DENIED:
      return 'critical';
    case ERROR_CATEGORIES.FILE_NOT_FOUND:
    case ERROR_CATEGORIES.FILE_TOO_LARGE:
    case ERROR_CATEGORIES.DISK_SPACE:
      return 'error';
    case ERROR_CATEGORIES.ENCODING_ERROR:
    case ERROR_CATEGORIES.INVALID_INPUT:
      return 'warning';
    default:
      return 'info';
  }
}

export function createDetailedErrorResponse(operation, filePath, error, statusCode = 500) {
  const category = categorizeError(error);
  const userMessage = getUserFriendlyMessage(category, operation);

  return {
    error: {
      code: category,
      message: userMessage,
      operation,
      filePath,
      timestamp: new Date().toISOString(),
      ...(process.env.DEBUG && {
        details: {
          originalError: error.message,
          errorCode: error.code,
          stack: getStackTrace(error, 3)
        }
      })
    },
    statusCode
  };
}

function getUserFriendlyMessage(category, operation) {
  const messages = {
    FILE_NOT_FOUND: `Could not find the specified file or directory`,
    PERMISSION_DENIED: `You do not have permission to ${operation} this file`,
    PATH_TRAVERSAL: `Access denied: invalid file path`,
    INVALID_INPUT: `Invalid file path or parameters provided`,
    FILE_TOO_LARGE: `File is too large to ${operation}`,
    ENCODING_ERROR: `Unable to read file: encoding error`,
    DISK_SPACE: `Insufficient disk space for this operation`,
    OPERATION_FAILED: `File operation failed. Please try again`,
    UNKNOWN: `An unexpected error occurred during file operation`
  };

  return messages[category] || messages.UNKNOWN;
}

export const ErrorCategories = ERROR_CATEGORIES;
