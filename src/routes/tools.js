import { validateTaskName, sanitizeInput } from '@sequential/core';
import { createError, createValidationError } from '@sequential/error-handling';
import { validateParam, validateRequired, validateType } from '@sequential/param-validation';
import { asyncHandler } from '../middleware/error-handler.js';

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
}
