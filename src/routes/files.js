import path from 'path';
import fs from 'fs-extra';
import { validateFilePath, validateFileName } from '../lib/utils.js';
import { createErrorResponse, createValidationError } from '../utils/error-factory.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { broadcastToFileSubscribers } from '../utils/ws-broadcaster.js';

export function registerFileRoutes(app) {
  app.get('/api/files/current-path', (req, res) => {
    res.json({ path: process.cwd() });
  });

  app.get('/api/files/list', asyncHandler(async (req, res) => {
    const dir = req.query.dir || process.cwd();
    const realPath = validateFilePath(dir);
    const files = await fs.readdir(realPath, { withFileTypes: true });
    const items = await Promise.all(files.map(async (file) => {
      const filePath = path.join(realPath, file.name);
      const stat = await fs.stat(filePath);
      return {
        name: file.name,
        type: file.isDirectory() ? 'dir' : 'file',
        size: stat.size,
        modified: stat.mtime,
        isDirectory: file.isDirectory()
      };
    }));
    res.json({ directory: realPath, files: items.sort((a, b) => a.name.localeCompare(b.name)) });
  }));

  app.get('/api/files/read', asyncHandler(async (req, res) => {
    const filePath = req.query.path;
    const realPath = validateFilePath(filePath);
    const stat = await fs.stat(realPath);
    if (stat.isDirectory()) {
      return res.status(400).json(createErrorResponse('INVALID_OPERATION', 'Cannot read directory'));
    }
    if (stat.size > 10 * 1024 * 1024) {
      return res.status(400).json(createErrorResponse('FILE_TOO_LARGE', 'File too large (max 10MB)'));
    }
    const content = await fs.readFile(realPath, 'utf8');
    res.json({ path: realPath, size: stat.size, content, modified: stat.mtime });
  }));

  app.post('/api/files/write', asyncHandler(async (req, res) => {
    const { path: filePath, content } = req.body;
    if (content === undefined) {
      return res.status(400).json(createErrorResponse('INVALID_INPUT', 'Content is required'));
    }
    const realPath = validateFilePath(filePath);
    await fs.ensureDir(path.dirname(realPath));
    const isNew = !fs.existsSync(realPath);
    await fs.writeFile(realPath, content, 'utf8');
    broadcastToFileSubscribers({ type: isNew ? 'file-created' : 'file-modified', path: filePath, timestamp: new Date().toISOString() });
    res.json({ path: realPath, size: content.length, success: true });
  }));

  app.post('/api/files/mkdir', asyncHandler(async (req, res) => {
    const { path: dirPath } = req.body;
    const realPath = validateFilePath(dirPath);
    await fs.ensureDir(realPath);
    broadcastToFileSubscribers({ type: 'directory-created', path: dirPath, timestamp: new Date().toISOString() });
    res.json({ path: realPath, success: true });
  }));

  app.delete('/api/files', asyncHandler(async (req, res) => {
    const filePath = req.query.path || req.body?.path;
    const realPath = validateFilePath(filePath);
    await fs.remove(realPath);
    broadcastToFileSubscribers({ type: 'file-deleted', path: filePath, timestamp: new Date().toISOString() });
    res.json({ path: realPath, success: true });
  }));

  app.post('/api/files/rename', asyncHandler(async (req, res) => {
    const { path: filePath, newName } = req.body;
    if (!newName) throw createValidationError('newName is required', 'newName');

    try {
      validateFileName(newName);
    } catch (e) {
      throw createValidationError(e.message, 'newName');
    }

    const realPath = validateFilePath(filePath);
    const dir = path.dirname(realPath);
    const newPath = path.join(dir, newName);
    validateFilePath(newPath);
    await fs.rename(realPath, newPath);
    const newRelativePath = filePath.substring(0, filePath.lastIndexOf('/') + 1) + newName;
    broadcastToFileSubscribers({ type: 'file-renamed', oldPath: filePath, newPath: newRelativePath, timestamp: new Date().toISOString() });
    res.json({ oldPath: realPath, newPath: newPath, success: true });
  }));

  app.post('/api/files/copy', asyncHandler(async (req, res) => {
    const { path: filePath, newPath: destPath } = req.body;
    if (!filePath) return res.status(400).json(createErrorResponse('INVALID_INPUT', 'path is required'));
    if (!destPath) return res.status(400).json(createErrorResponse('INVALID_INPUT', 'newPath is required'));
    const realPath = validateFilePath(filePath);
    const realDest = validateFilePath(destPath);
    await fs.ensureDir(path.dirname(realDest));
    await fs.copy(realPath, realDest);
    broadcastToFileSubscribers({ type: 'file-copied', sourcePath: filePath, destPath: destPath, timestamp: new Date().toISOString() });
    res.json({ sourcePath: realPath, destPath: realDest, success: true });
  }));

  app.post('/api/files/save', asyncHandler(async (req, res) => {
    const { path: filePath, content } = req.body;
    if (!content) {
      return res.status(400).json(createErrorResponse('INVALID_INPUT', 'Content is required'));
    }
    const realPath = validateFilePath(filePath);
    await fs.ensureDir(path.dirname(realPath));
    await fs.writeFile(realPath, content, 'utf8');
    res.json({ path: realPath, success: true });
  }));
}
