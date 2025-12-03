import { validateTaskName } from '@sequential/core';
import { createError, createValidationError, throwValidationError, throwNotFound } from '@sequential/error-handling';
import { validateParam, validateRequired, validateType, sanitizeInput } from '@sequential/param-validation';
import { asyncHandler } from '../middleware/error-handler.js';
import { executeTaskWithTimeout } from '@sequential/server-utilities';
import { formatResponse } from '@sequential/response-formatting';
import { validateRequest } from '@sequential/request-validator';
import { nowISO, createTimestamps, updateTimestamp } from '@sequential/timestamp-utilities';
import { delay, withRetry } from '@sequential/async-patterns';
import { createCRUDRouter, registerCRUDRoutes } from '@sequential/crud-router';
import { injectDependencies } from '@sequential/dependency-middleware';

export function registerToolRoutes(app, container) {
  const repository = container.resolve('ToolRepository');

  const toolHandlers = {
    test: asyncHandler(async (req, res) => {
      const { toolName, implementation, input } = req.body;

      validateRequired('toolName', toolName);
      validateRequired('implementation', implementation);
      validateType('toolName', toolName, 'string');
      validateType('implementation', implementation, 'string');

      const startTime = Date.now();
      const result = await executeTaskWithTimeout(toolName, implementation, input || {}, 30000);
      const duration = Date.now() - startTime;
      res.json(formatResponse({ output: result, duration }));
    })
  };

  registerCRUDRoutes(app, '/api/tools', {
    repository,
    resourceName: 'tool',
    pluralName: 'tools',
    asyncHandler,
    customEndpoints: (router) => {
      router.post('/test', toolHandlers.test);
    }
  });

  app.post('/api/tools/validate-imports', asyncHandler(async (req, res) => {
    const { packages } = req.body;

    if (!Array.isArray(packages)) {
      throw createValidationError('packages must be an array', 'packages');
    }

    const invalid = [];
    const commonPackages = [
      'axios', 'lodash', 'moment', 'date-fns', 'uuid', 'crypto-js',
      'qs', 'dotenv', 'express', 'cors', 'multer', 'body-parser',
      'jsonwebtoken', 'bcrypt', 'validator', 'joi', 'yup',
      'node-fetch', 'xml2js', 'csv-parse', 'pdf-parse', 'cheerio'
    ];

    for (const pkg of packages) {
      if (!commonPackages.includes(pkg.toLowerCase())) {
        invalid.push(pkg);
      }
    }

    res.json(formatResponse({
      valid: invalid.length === 0,
      validated: packages.length,
      invalid,
      warning: invalid.length > 0 ? `These packages may not be available in the execution environment: ${invalid.join(', ')}` : null
    }));
  }));
}
