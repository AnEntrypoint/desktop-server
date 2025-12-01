import {
  createValidationError as createValidationErrorImpl,
  createNotFoundError as createNotFoundErrorImpl,
  createForbiddenError as createForbiddenErrorImpl,
  createConflictError as createConflictErrorImpl,
  createUnprocessableError as createUnprocessableErrorImpl,
  createBadRequestError as createBadRequestErrorImpl,
  createServerError as createServerErrorImpl
} from '../errors/app-error.js';

export function createErrorResponse(code, message, details = {}) {
  return {
    error: { code, message, details },
    timestamp: new Date().toISOString()
  };
}

export function createValidationError(message, field = null) {
  const err = createValidationErrorImpl(message, field);
  err.field = field;
  return err;
}

export function createNotFoundError(resource) {
  return createNotFoundErrorImpl(resource);
}

export function createForbiddenError(message = 'Access denied') {
  return createForbiddenErrorImpl(message);
}

export function createServerError(message, originalError = null) {
  return createServerErrorImpl(message, originalError);
}

export function createConflictError(message = 'Resource conflict') {
  return createConflictErrorImpl(message);
}

export function createUnprocessableError(message, details = {}) {
  return createUnprocessableErrorImpl(message, details);
}

export function createBadRequestError(message) {
  return createBadRequestErrorImpl(message);
}
