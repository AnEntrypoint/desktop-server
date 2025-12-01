export class AppError extends Error {
  constructor(httpCode, code, message, category = null, details = {}) {
    super(message);
    this.httpCode = httpCode;
    this.code = code;
    this.category = category;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      category: this.category,
      details: this.details,
      timestamp: this.timestamp
    };
  }
}

export const ERROR_CODES = {
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', httpCode: 400, category: 'validation' },
  NOT_FOUND: { code: 'NOT_FOUND', httpCode: 404, category: 'resource' },
  FORBIDDEN: { code: 'FORBIDDEN', httpCode: 403, category: 'authorization' },
  CONFLICT: { code: 'CONFLICT', httpCode: 409, category: 'conflict' },
  UNPROCESSABLE_ENTITY: { code: 'UNPROCESSABLE_ENTITY', httpCode: 422, category: 'data' },
  BAD_REQUEST: { code: 'BAD_REQUEST', httpCode: 400, category: 'request' },
  INTERNAL_SERVER_ERROR: { code: 'INTERNAL_SERVER_ERROR', httpCode: 500, category: 'server' },
  FILE_NOT_FOUND: { code: 'FILE_NOT_FOUND', httpCode: 404, category: 'file' },
  FILE_TOO_LARGE: { code: 'FILE_TOO_LARGE', httpCode: 413, category: 'file' },
  PATH_TRAVERSAL: { code: 'PATH_TRAVERSAL', httpCode: 403, category: 'security' }
};

export function createError(errorDef, message, details = {}) {
  return new AppError(errorDef.httpCode, errorDef.code, message, errorDef.category, details);
}

export function createValidationError(message, field = null) {
  return createError(ERROR_CODES.VALIDATION_ERROR, message, { field });
}

export function createNotFoundError(resource) {
  return createError(ERROR_CODES.NOT_FOUND, `${resource} not found`, { resource });
}

export function createForbiddenError(message = 'Access denied') {
  return createError(ERROR_CODES.FORBIDDEN, message);
}

export function createConflictError(message = 'Resource conflict') {
  return createError(ERROR_CODES.CONFLICT, message);
}

export function createUnprocessableError(message, details = {}) {
  return createError(ERROR_CODES.UNPROCESSABLE_ENTITY, message, details);
}

export function createBadRequestError(message) {
  return createError(ERROR_CODES.BAD_REQUEST, message);
}

export function createServerError(message, originalError = null) {
  return createError(ERROR_CODES.INTERNAL_SERVER_ERROR, message, { originalError: originalError?.message });
}

export function createFileError(code, message, details = {}) {
  const errorDef = ERROR_CODES[code] || ERROR_CODES.INTERNAL_SERVER_ERROR;
  return createError(errorDef, message, details);
}

export function categorizeError(error) {
  if (error instanceof AppError) return error.category || 'unknown';
  if (error.code?.includes('ENOENT')) return 'file';
  if (error.code?.includes('EACCES')) return 'authorization';
  if (error.code?.includes('EISDIR')) return 'resource';
  return 'unknown';
}

export function createErrorHandler() {
  return (err, req, res, next) => {
    const appError = err instanceof AppError ? err : new AppError(500, 'INTERNAL_SERVER_ERROR', err.message || 'Unknown error', 'server');

    res.status(appError.httpCode).json({
      error: {
        code: appError.code,
        message: appError.message,
        category: appError.category,
        requestId: req.requestId,
        ...(appError.details && Object.keys(appError.details).length > 0 && { details: appError.details }),
        ...(process.env.DEBUG && { stack: err.stack })
      },
      timestamp: appError.timestamp
    });
  };
}
