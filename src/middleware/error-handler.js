import { createErrorHandler as createAppErrorHandler } from '../errors/app-error.js';

export function createErrorHandler() {
  const appHandler = createAppErrorHandler();
  return (err, req, res, next) => {
    console.error('Error:', err);
    appHandler(err, req, res, next);
  };
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
