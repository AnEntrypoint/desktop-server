import path from 'path';
import fs from 'fs-extra';
import { validateTaskName, sanitizeInput } from '../lib/utils.js';
import { createErrorResponse, createValidationError } from '../utils/error-factory.js';
import { asyncHandler } from '../middleware/error-handler.js';

export function registerToolRoutes(app) {
  app.get('/api/tools', asyncHandler(async (req, res) => {
    const toolsDir = path.join(process.cwd(), '.tools');
    if (!fs.existsSync(toolsDir)) {
      return res.json([]);
    }
    const tools = fs.readdirSync(toolsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(toolsDir, f), 'utf8'));
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
    res.json(tools);
  }));

  app.post('/api/tools', asyncHandler(async (req, res) => {
    const { name, definition } = req.body;

    if (!name) {
      throw createValidationError('name is required', 'name');
    }
    if (typeof name !== 'string') {
      throw createValidationError('name must be a string', 'name');
    }
    try {
      validateTaskName(name);
    } catch (e) {
      throw createValidationError(e.message, 'name');
    }

    if (definition && typeof definition !== 'object') {
      throw createValidationError('definition must be an object', 'definition');
    }

    const toolsDir = path.join(process.cwd(), '.tools');
    await fs.ensureDir(toolsDir);
    const tool = { id: name, name: sanitizeInput(name), ...(definition || {}), timestamp: new Date().toISOString() };
    await fs.writeJSON(path.join(toolsDir, `${name}.json`), tool);
    res.json(tool);
  }));

  app.put('/api/tools/:id', asyncHandler(async (req, res) => {
    const { definition } = req.body;
    const { id } = req.params;

    if (!id) {
      throw createValidationError('id is required', 'id');
    }
    if (typeof id !== 'string') {
      throw createValidationError('id must be a string', 'id');
    }
    try {
      validateTaskName(id);
    } catch (e) {
      throw createValidationError(e.message, 'id');
    }

    if (definition && typeof definition !== 'object') {
      throw createValidationError('definition must be an object', 'definition');
    }

    const toolsDir = path.join(process.cwd(), '.tools');
    const toolPath = path.join(toolsDir, `${id}.json`);
    if (!fs.existsSync(toolPath)) {
      return res.status(404).json(createErrorResponse('TOOL_NOT_FOUND', 'Tool not found'));
    }
    const tool = { id, ...(definition || {}), timestamp: new Date().toISOString() };
    await fs.writeJSON(toolPath, tool);
    res.json(tool);
  }));

  app.delete('/api/tools/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!id) {
      throw createValidationError('id is required', 'id');
    }
    if (typeof id !== 'string') {
      throw createValidationError('id must be a string', 'id');
    }
    try {
      validateTaskName(id);
    } catch (e) {
      throw createValidationError(e.message, 'id');
    }

    const toolsDir = path.join(process.cwd(), '.tools');
    const toolPath = path.join(toolsDir, `${id}.json`);
    if (!fs.existsSync(toolPath)) {
      return res.status(404).json(createErrorResponse('TOOL_NOT_FOUND', 'Tool not found'));
    }
    await fs.remove(toolPath);
    res.json({ success: true, id });
  }));
}
