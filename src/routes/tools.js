import { validateTaskName, sanitizeInput } from '@sequential/core';
import { createError, createValidationError } from '@sequential/error-handling';
import { validateParam, validateRequired, validateType } from '@sequential/param-validation';
import { asyncHandler } from '../middleware/error-handler.js';
import { executeTaskWithTimeout } from '@sequential/server-utilities';

export function registerToolRoutes(app, container) {
  const repository = container.resolve('ToolRepository');

  app.get('/api/tools', asyncHandler(async (req, res) => {
    const tools = await repository.getAll();
    res.json(tools);
  }));

  app.post('/api/tools', asyncHandler(async (req, res) => {
    const { name, definition } = req.body;

    validateRequired('name', name);
    validateType('name', name, 'string');
    validateParam(validateTaskName, 'name')(name);

    if (definition && typeof definition !== 'object') {
      throw createValidationError('definition must be an object', 'definition');
    }

    const tool = { id: name, name: sanitizeInput(name), ...(definition || {}), timestamp: new Date().toISOString() };
    await repository.save(name, tool);
    res.json(tool);
  }));

  app.put('/api/tools/:id', asyncHandler(async (req, res) => {
    const { definition } = req.body;
    const { id } = req.params;

    validateRequired('id', id);
    validateType('id', id, 'string');
    validateParam(validateTaskName, 'id')(id);

    if (definition && typeof definition !== 'object') {
      throw createValidationError('definition must be an object', 'definition');
    }

    const tool = { id, ...(definition || {}), timestamp: new Date().toISOString() };
    await repository.save(id, tool);
    res.json(tool);
  }));

  app.delete('/api/tools/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    validateRequired('id', id);
    validateType('id', id, 'string');
    validateParam(validateTaskName, 'id')(id);

    await repository.delete(id);
    res.json({ success: true, id });
  }));

  app.post('/api/tools/test', asyncHandler(async (req, res) => {
    const { toolName, implementation, input } = req.body;

    validateRequired('toolName', toolName);
    validateRequired('implementation', implementation);
    validateType('toolName', toolName, 'string');
    validateType('implementation', implementation, 'string');

    const startTime = Date.now();
    try {
      const result = await executeTaskWithTimeout(toolName, implementation, input || {}, 30000);
      const duration = Date.now() - startTime;
      res.json({ success: true, output: result, duration });
    } catch (error) {
      const duration = Date.now() - startTime;
      res.json({ success: false, error: error.message, stack: error.stack, duration });
    }
  }));

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

    res.json({
      valid: invalid.length === 0,
      validated: packages.length,
      invalid,
      warning: invalid.length > 0 ? `These packages may not be available in the execution environment: ${invalid.join(', ')}` : null
    });
  }));
}
