import path from 'path';
import fs from 'fs-extra';
import { createErrorResponse } from '../utils/error-factory.js';
import { asyncHandler } from '../middleware/error-handler.js';

export function registerSequentialOsRoutes(app, kit, STATEKIT_DIR) {
  app.get('/api/sequential-os/status', asyncHandler(async (req, res) => {
    const status = await kit.status();
    res.json(status);
  }));

  app.post('/api/sequential-os/run', asyncHandler(async (req, res) => {
    const { instruction } = req.body;
    if (!instruction) {
      return res.status(400).json(createErrorResponse('INVALID_INPUT', 'instruction is required'));
    }
    const result = await kit.run(instruction);
    res.json(result);
  }));

  app.post('/api/sequential-os/exec', asyncHandler(async (req, res) => {
    const { instruction } = req.body;
    if (!instruction) {
      return res.status(400).json(createErrorResponse('INVALID_INPUT', 'instruction is required'));
    }
    const result = await kit.exec(instruction);
    res.json({ output: result, success: true });
  }));

  app.get('/api/sequential-os/history', asyncHandler(async (req, res) => {
    const history = await kit.history();
    res.json(history);
  }));

  app.post('/api/sequential-os/checkout', asyncHandler(async (req, res) => {
    const { ref } = req.body;
    if (!ref) {
      return res.status(400).json(createErrorResponse('INVALID_INPUT', 'ref is required'));
    }
    await kit.checkout(ref);
    res.json({ success: true, ref });
  }));

  app.get('/api/sequential-os/tags', asyncHandler(async (req, res) => {
    const tags = kit.tags();
    res.json(tags);
  }));

  app.post('/api/sequential-os/tag', asyncHandler(async (req, res) => {
    const { name, ref } = req.body;
    if (!name) {
      return res.status(400).json(createErrorResponse('INVALID_INPUT', 'name is required'));
    }
    kit.tag(name, ref);
    res.json({ success: true, name, ref });
  }));

  app.get('/api/sequential-os/inspect/:hash', asyncHandler(async (req, res) => {
    const { hash } = req.params;
    const layerPath = path.join(STATEKIT_DIR, 'layers', hash);
    if (!fs.existsSync(layerPath)) {
      return res.status(404).json(createErrorResponse('LAYER_NOT_FOUND', 'Layer not found'));
    }
    const files = [];
    const getAllFiles = (dir, base = '') => {
      const items = fs.readdirSync(dir);
      items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          getAllFiles(fullPath, path.join(base, item));
        } else {
          files.push(path.join(base, item));
        }
      });
    };
    getAllFiles(layerPath);
    const stats = fs.statSync(layerPath);
    res.json({ hash, files, size: stats.size || 0 });
  }));

  app.post('/api/sequential-os/diff', asyncHandler(async (req, res) => {
    const { file, hash1, hash2 } = req.body;
    if (!file || !hash1 || !hash2) {
      return res.status(400).json(createErrorResponse('INVALID_INPUT', 'file, hash1, and hash2 are required'));
    }
    const layerPath1 = path.join(STATEKIT_DIR, 'layers', hash1, file);
    const layerPath2 = path.join(STATEKIT_DIR, 'layers', hash2, file);

    if (!fs.existsSync(layerPath1) || !fs.existsSync(layerPath2)) {
      return res.status(404).json(createErrorResponse('FILE_NOT_FOUND', 'File not found in one or both layers'));
    }

    const content1 = fs.readFileSync(layerPath1, 'utf-8');
    const content2 = fs.readFileSync(layerPath2, 'utf-8');

    res.json({
      file,
      hash1,
      hash2,
      content1,
      content2,
      identical: content1 === content2
    });
  }));
}
