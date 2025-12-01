import { createValidationError } from '../utils/error-factory.js';

export function validateParam(validator, paramName) {
  return (value) => {
    try {
      validator(value);
      return value;
    } catch (e) {
      throw createValidationError(e.message, paramName);
    }
  };
}

export function validateRequired(paramName, value) {
  if (value === undefined || value === null || value === '') {
    throw createValidationError(`${paramName} is required`, paramName);
  }
  return value;
}

export function validateType(paramName, value, expectedType) {
  if (typeof value !== expectedType) {
    throw createValidationError(`${paramName} must be a ${expectedType}`, paramName);
  }
  return value;
}
