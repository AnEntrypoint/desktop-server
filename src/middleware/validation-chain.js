import { createValidationError, createBadRequestError } from '../utils/error-factory.js';

export class ValidationChain {
  constructor() {
    this.errors = [];
  }

  required(field, value) {
    if (!value) {
      this.errors.push({ field, message: `${field} is required` });
    }
    return this;
  }

  requireEach(fields, obj) {
    fields.forEach(field => {
      if (!obj[field]) {
        this.errors.push({ field, message: `${field} is required` });
      }
    });
    return this;
  }

  type(field, value, expectedType) {
    if (typeof value !== expectedType) {
      this.errors.push({ field, message: `${field} must be ${expectedType}, got ${typeof value}` });
    }
    return this;
  }

  types(validations) {
    validations.forEach(({ field, value, type }) => {
      if (typeof value !== type) {
        this.errors.push({ field, message: `${field} must be ${type}` });
      }
    });
    return this;
  }

  notEmpty(field, value, message = null) {
    if (typeof value === 'string' && !value.trim()) {
      this.errors.push({ field, message: message || `${field} cannot be empty` });
    }
    if (Array.isArray(value) && value.length === 0) {
      this.errors.push({ field, message: message || `${field} cannot be empty` });
    }
    return this;
  }

  length(field, value, { min = 0, max = Infinity } = {}) {
    const len = typeof value === 'string' || Array.isArray(value) ? value.length : 0;
    if (len < min || len > max) {
      this.errors.push({ field, message: `${field} length must be between ${min} and ${max}` });
    }
    return this;
  }

  matches(field, value, regex, message = null) {
    if (typeof value === 'string' && !regex.test(value)) {
      this.errors.push({ field, message: message || `${field} format is invalid` });
    }
    return this;
  }

  custom(field, validator) {
    const result = validator();
    if (result !== true) {
      this.errors.push({ field, message: result || `${field} validation failed` });
    }
    return this;
  }

  oneOf(field, value, allowedValues) {
    if (!allowedValues.includes(value)) {
      this.errors.push({ field, message: `${field} must be one of: ${allowedValues.join(', ')}` });
    }
    return this;
  }

  execute() {
    if (this.errors.length > 0) {
      const firstError = this.errors[0];
      throw createValidationError(firstError.message, firstError.field);
    }
    return true;
  }

  throwAll() {
    if (this.errors.length > 0) {
      throw createBadRequestError(`Validation failed: ${this.errors.map(e => e.message).join('; ')}`);
    }
    return true;
  }

  getErrors() {
    return this.errors;
  }

  hasErrors() {
    return this.errors.length > 0;
  }

  clear() {
    this.errors = [];
    return this;
  }
}

export function validate() {
  return new ValidationChain();
}
