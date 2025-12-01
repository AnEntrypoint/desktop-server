import path from 'path';
import fs from 'fs-extra';
import { validateTaskName, sanitizeInput } from '../lib/utils.js';
import { createErrorResponse, createValidationError } from '../utils/error-factory.js';
import { validateParam, validateRequired, validateType } from '../middleware/param-validator.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { writeFileAtomicJson } from '../utils/file-ops.js';
import { FileStore } from '../lib/file-store.js';

export function registerToolRoutes(app) {
  const toolsStore = new FileStore(path.join(process.cwd(), '.tools'));

  app.get('/api/tools', asyncHandler(async (req, res) => {
    const tools = toolsStore.listJsonFiles();
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
    const toolPath = path.join(process.cwd(), '.tools', `${name}.json`);
    await fs.ensureDir(path.dirname(toolPath));
    await writeFileAtomicJson(toolPath, tool);
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

    const toolPath = path.join(process.cwd(), '.tools', `${id}.json`);
    if (!fs.existsSync(toolPath)) {
      return res.status(404).json(createErrorResponse('TOOL_NOT_FOUND', 'Tool not found'));
    }
    const tool = { id, ...(definition || {}), timestamp: new Date().toISOString() };
    await writeFileAtomicJson(toolPath, tool);
    res.json(tool);
  }));

  app.delete('/api/tools/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    validateRequired('id', id);
    validateType('id', id, 'string');
    validateParam(validateTaskName, 'id')(id);

    const toolPath = path.join(process.cwd(), '.tools', `${id}.json`);
    if (!fs.existsSync(toolPath)) {
      return res.status(404).json(createErrorResponse('TOOL_NOT_FOUND', 'Tool not found'));
    }
    await fs.remove(toolPath);
    res.json({ success: true, id });
  }));
}
