import path from 'path';
import fs from 'fs-extra';
import { validateFilePath, validateFileName } from '../lib/utils.js';
import { createErrorResponse, createValidationError } from '../utils/error-factory.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { broadcastToFileSubscribers } from '../utils/ws-broadcaster.js';
import { CONFIG } from '../config/defaults.js';
import { logFileOperation, logFileSuccess, logBatchFileOperation, createDetailedErrorResponse } from '../utils/error-logger.js';
import { writeFileAtomicString } from '../utils/file-ops.js';

export function registerFileRoutes(app, container) {
  if (!container) throw new Error('Container required for FileRoutes');
  const fileRepository = container.resolve('FileRepository');
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
    const startTime = Date.now();
    try {
      const realPath = validateFilePath(filePath);
      const stat = await fs.stat(realPath);
      if (stat.isDirectory()) {
        return res.status(400).json(createErrorResponse('INVALID_OPERATION', 'Cannot read directory'));
      }
      if (stat.size > CONFIG.files.maxSizeBytes) {
        const maxMb = Math.round(CONFIG.files.maxSizeBytes / (1024 * 1024));
        logFileOperation('read', filePath, new Error('File too large'), { size: stat.size, limit: CONFIG.files.maxSizeBytes });
        return res.status(400).json(createErrorResponse('FILE_TOO_LARGE', `File too large (max ${maxMb}MB)`));
      }
      const content = await fs.readFile(realPath, 'utf8');
      const duration = Date.now() - startTime;
      logFileSuccess('read', filePath, duration, { size: stat.size });
      res.json({ path: realPath, size: stat.size, content, modified: stat.mtime });
    } catch (error) {
      const duration = Date.now() - startTime;
      logFileOperation('read', filePath, error, { duration });
      const errorResponse = createDetailedErrorResponse('read', filePath, error, 500);
      res.status(errorResponse.statusCode).json(errorResponse.error);
    }
  }));

  app.post('/api/files/write', asyncHandler(async (req, res) => {
    const { path: filePath, content } = req.body;
    const startTime = Date.now();

    if (!filePath) {
      throw createValidationError('path is required', 'filePath');
    }
    if (content === undefined || content === null) {
      throw createValidationError('content is required', 'content');
    }
    if (typeof content !== 'string') {
      throw createValidationError('content must be a string', 'content');
    }

    try {
      const realPath = validateFilePath(filePath);
      const isNew = !fs.existsSync(realPath);
      await writeFileAtomicString(realPath, content);
      const duration = Date.now() - startTime;
      logFileSuccess('write', filePath, duration, { size: content.length, isNew });
      broadcastToFileSubscribers({ type: isNew ? 'file-created' : 'file-modified', path: filePath, timestamp: new Date().toISOString() });
      res.json({ path: realPath, size: content.length, success: true });
    } catch (error) {
      const duration = Date.now() - startTime;
      logFileOperation('write', filePath, error, { duration, contentLength: content?.length || 0 });
      const errorResponse = createDetailedErrorResponse('write', filePath, error, 500);
      res.status(errorResponse.statusCode).json(errorResponse.error);
    }
  }));

  app.post('/api/files/mkdir', asyncHandler(async (req, res) => {
    const { path: dirPath } = req.body;
    const startTime = Date.now();

    if (!dirPath) {
      throw createValidationError('path is required', 'dirPath');
    }
    if (typeof dirPath !== 'string') {
      throw createValidationError('path must be a string', 'dirPath');
    }

    try {
      const realPath = validateFilePath(dirPath);
      await fs.ensureDir(realPath);
      const duration = Date.now() - startTime;
      logFileSuccess('mkdir', dirPath, duration);
      broadcastToFileSubscribers({ type: 'directory-created', path: dirPath, timestamp: new Date().toISOString() });
      res.json({ path: realPath, success: true });
    } catch (error) {
      const duration = Date.now() - startTime;
      logFileOperation('mkdir', dirPath, error, { duration });
      const errorResponse = createDetailedErrorResponse('mkdir', dirPath, error, 500);
      res.status(errorResponse.statusCode).json(errorResponse.error);
    }
  }));

  app.delete('/api/files', asyncHandler(async (req, res) => {
    const filePath = req.query.path || req.body?.path;
    const startTime = Date.now();

    if (!filePath) {
      throw createValidationError('path is required', 'filePath');
    }
    if (typeof filePath !== 'string') {
      throw createValidationError('path must be a string', 'filePath');
    }

    try {
      const realPath = validateFilePath(filePath);
      await fs.remove(realPath);
      const duration = Date.now() - startTime;
      logFileSuccess('delete', filePath, duration);
      broadcastToFileSubscribers({ type: 'file-deleted', path: filePath, timestamp: new Date().toISOString() });
      res.json({ path: realPath, success: true });
    } catch (error) {
      const duration = Date.now() - startTime;
      logFileOperation('delete', filePath, error, { duration });
      const errorResponse = createDetailedErrorResponse('delete', filePath, error, 500);
      res.status(errorResponse.statusCode).json(errorResponse.error);
    }
  }));

  app.post('/api/files/rename', asyncHandler(async (req, res) => {
    const { path: filePath, newName } = req.body;
    const startTime = Date.now();
    if (!newName) throw createValidationError('newName is required', 'newName');

    try {
      validateFileName(newName);
      const realPath = validateFilePath(filePath);
      const dir = path.dirname(realPath);
      const newPath = path.join(dir, newName);
      validateFilePath(newPath);
      await fs.rename(realPath, newPath);
      const duration = Date.now() - startTime;
      const newRelativePath = filePath.substring(0, filePath.lastIndexOf('/') + 1) + newName;
      logFileSuccess('rename', filePath, duration, { newName });
      broadcastToFileSubscribers({ type: 'file-renamed', oldPath: filePath, newPath: newRelativePath, timestamp: new Date().toISOString() });
      res.json({ oldPath: realPath, newPath: newPath, success: true });
    } catch (error) {
      const duration = Date.now() - startTime;
      logFileOperation('rename', filePath, error, { duration, newName });
      const errorResponse = createDetailedErrorResponse('rename', filePath, error, 500);
      res.status(errorResponse.statusCode).json(errorResponse.error);
    }
  }));

  app.post('/api/files/copy', asyncHandler(async (req, res) => {
    const { path: filePath, newPath: destPath } = req.body;
    const startTime = Date.now();

    if (!filePath) {
      throw createValidationError('path is required', 'filePath');
    }
    if (!destPath) {
      throw createValidationError('newPath is required', 'destPath');
    }
    if (typeof filePath !== 'string' || typeof destPath !== 'string') {
      throw createValidationError('path and newPath must be strings', 'copyParams');
    }

    try {
      const realPath = validateFilePath(filePath);
      const realDest = validateFilePath(destPath);
      await fs.ensureDir(path.dirname(realDest));
      await fs.copy(realPath, realDest);
      const duration = Date.now() - startTime;
      logFileSuccess('copy', filePath, duration, { destination: destPath });
      broadcastToFileSubscribers({ type: 'file-copied', sourcePath: filePath, destPath: destPath, timestamp: new Date().toISOString() });
      res.json({ sourcePath: realPath, destPath: realDest, success: true });
    } catch (error) {
      const duration = Date.now() - startTime;
      logFileOperation('copy', filePath, error, { duration, destination: destPath });
      const errorResponse = createDetailedErrorResponse('copy', filePath, error, 500);
      res.status(errorResponse.statusCode).json(errorResponse.error);
    }
  }));

  app.post('/api/files/save', asyncHandler(async (req, res) => {
    const { path: filePath, content } = req.body;
    const startTime = Date.now();

    if (!filePath) {
      throw createValidationError('path is required', 'filePath');
    }
    if (content === undefined || content === null) {
      throw createValidationError('content is required', 'content');
    }
    if (typeof content !== 'string') {
      throw createValidationError('content must be a string', 'content');
    }

    try {
      const realPath = validateFilePath(filePath);
      await writeFileAtomicString(realPath, content);
      const duration = Date.now() - startTime;
      logFileSuccess('save', filePath, duration, { size: content.length });
      res.json({ path: realPath, success: true });
    } catch (error) {
      const duration = Date.now() - startTime;
      logFileOperation('save', filePath, error, { duration, contentLength: content?.length || 0 });
      const errorResponse = createDetailedErrorResponse('save', filePath, error, 500);
      res.status(errorResponse.statusCode).json(errorResponse.error);
    }
  }));
}
