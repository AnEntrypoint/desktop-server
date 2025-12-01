import createError from 'http-errors';

export function createErrorResponse(code, message, details = {}) {
  return {
    error: { code, message, details },
    timestamp: new Date().toISOString()
  };
}

export function createValidationError(message, field = null) {
  const err = createError(400, message);
  err.code = 'VALIDATION_ERROR';
  err.field = field;
  return err;
}

export function createNotFoundError(resource) {
  return createError(404, `${resource} not found`, { code: 'NOT_FOUND' });
}

export function createForbiddenError(message = 'Access denied') {
  return createError(403, message, { code: 'FORBIDDEN' });
}

export function createServerError(message, originalError = null) {
  const err = createError(500, message, { code: 'INTERNAL_ERROR' });
  err.originalError = originalError;
  return err;
}

export function createConflictError(message = 'Resource conflict') {
  return createError(409, message, { code: 'CONFLICT' });
}

export function createUnprocessableError(message, details = {}) {
  return createError(422, message, { code: 'UNPROCESSABLE_ENTITY', details });
}

export function createBadRequestError(message) {
  return createError(400, message, { code: 'BAD_REQUEST' });
}
