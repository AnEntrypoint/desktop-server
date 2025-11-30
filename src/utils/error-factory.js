export function createErrorResponse(code, message, details = {}) {
  return {
    error: {
      code,
      message,
      details
    },
    timestamp: new Date().toISOString()
  };
}

export function createValidationError(message, field = null) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.field = field;
  return err;
}

export function createNotFoundError(resource) {
  const err = new Error(`${resource} not found`);
  err.code = 'NOT_FOUND';
  err.status = 404;
  return err;
}

export function createForbiddenError(message = 'Access denied') {
  const err = new Error(message);
  err.code = 'FORBIDDEN';
  err.status = 403;
  return err;
}

export function createServerError(message, originalError = null) {
  const err = new Error(message);
  err.code = 'INTERNAL_ERROR';
  err.status = 500;
  err.originalError = originalError;
  return err;
}
