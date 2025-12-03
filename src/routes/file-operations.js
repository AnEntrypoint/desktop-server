import path from 'path';
import fs from 'fs-extra';
import { asyncHandler } from '../middleware/error-handler.js';
import { CONFIG, createTimer } from '@sequential/server-utilities';
import { createServerError } from '@sequential/error-handling';
import { writeFileAtomicString } from '@sequential/file-operations';
import { validate, validatePath } from '@sequential/param-validation';
import { validateFileName } from '@sequential/core';
import { formatResponse, formatError } from '@sequential/response-formatting';
import { validateRequest } from '@sequential/request-validator';
import { createOperationLogger } from '@sequential/operation-logger';

function handleFileError(operation, filePath, error, res) {
  const statusCode = error.httpCode || 500;
  res.status(statusCode).json(formatError(statusCode, {
    code: error.code || 'FILE_OPERATION_FAILED',
    message: error.message || `File ${operation} failed`
  }));
}

function broadcastFileEvent(eventType, filePath, metadata = {}) {
  // Broadcast event to connected WebSocket clients
  // Implementation depends on WebSocket manager in container
  // This is a stub - actual implementation would emit via websocket
}

export function registerFileRoutes(app, container) {
  if (!container) throw createServerError('Container required for FileRoutes');
  const logger = createOperationLogger({ logOperation: () => {}, logFileOperation: (op, path, err, meta) => {}, logFileSuccess: (op, path, dur, meta) => {} });

  // READ OPERATIONS
  app.get('/api/files/current-path', (req, res) => {
    res.json(formatResponse({ path: process.cwd() }));
  });

  app.get('/api/files/list', asyncHandler(async (req, res) => {
    const dir = req.query.dir || process.cwd();
    const realPath = validatePath(dir);
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
    res.json(formatResponse({ directory: realPath, files: items.sort((a, b) => a.name.localeCompare(b.name)) }));
  }));

  app.get('/api/files/read', asyncHandler(async (req, res) => {
    const filePath = req.query.path;
    const timer = createTimer();
    try {
      const realPath = validatePath(filePath);
      const stat = await fs.stat(realPath);
      if (stat.isDirectory()) {
        return res.status(400).json(formatError(400, { code: 'INVALID_OPERATION', message: 'Cannot read directory' }));
      }
      if (stat.size > CONFIG.files.maxSizeBytes) {
        const maxMb = Math.round(CONFIG.files.maxSizeBytes / (1024 * 1024));
        const error = new Error(`File too large (max ${maxMb}MB)`);
        error.code = 'FILE_TOO_LARGE';
        logger.fileOperation('read', filePath, error, { size: stat.size, limit: CONFIG.files.maxSizeBytes });
        return res.status(400).json(formatError(400, { code: error.code, message: error.message }));
      }
      const content = await fs.readFile(realPath, 'utf8');
      logger.fileSuccess('read', filePath, timer.elapsed(), { size: stat.size });
      res.json(formatResponse({ path: realPath, size: stat.size, content, modified: stat.mtime }));
    } catch (error) {
      logger.fileOperation('read', filePath, error, { duration: timer.elapsed() });
      handleFileError('read', filePath, error, res);
    }
  }));

  // WRITE OPERATIONS
  app.post('/api/files/save', asyncHandler(async (req, res) => {
    const { path: filePath, content } = req.body;
    const timer = createTimer();

    validate()
      .required('path', filePath)
      .required('content', content)
      .type('content', content, 'string')
      .execute();

    try {
      const realPath = validatePath(filePath);
      await writeFileAtomicString(realPath, content);
      logger.fileSuccess('save', filePath, timer.elapsed(), { size: content.length });
      res.json(formatResponse({ path: realPath, success: true }));
    } catch (error) {
      logger.fileOperation('save', filePath, error, { duration: timer.elapsed(), contentLength: content?.length || 0 });
      handleFileError('save', filePath, error, res);
    }
  }));

  app.post('/api/files/write', asyncHandler(async (req, res) => {
    const { path: filePath, content } = req.body;
    const timer = createTimer();

    validate()
      .required('filePath', filePath)
      .required('content', content)
      .type('content', content, 'string')
      .execute();

    try {
      const realPath = validatePath(filePath);
      const isNew = !await fs.pathExists(realPath);
      await writeFileAtomicString(realPath, content);
      logger.fileSuccess('write', filePath, timer.elapsed(), { size: content.length, isNew });
      broadcastFileEvent(isNew ? 'file-created' : 'file-modified', filePath);
      res.json(formatResponse({ path: realPath, size: content.length, success: true }));
    } catch (error) {
      logger.fileOperation('write', filePath, error, { duration: timer.elapsed(), contentLength: content?.length || 0 });
      handleFileError('write', filePath, error, res);
    }
  }));

  app.post('/api/files/mkdir', asyncHandler(async (req, res) => {
    const { path: dirPath } = req.body;
    const timer = createTimer();

    validate()
      .required('dirPath', dirPath)
      .type('dirPath', dirPath, 'string')
      .execute();

    try {
      const realPath = validatePath(dirPath);
      await fs.ensureDir(realPath);
      logger.fileSuccess('mkdir', dirPath, timer.elapsed());
      broadcastFileEvent('directory-created', dirPath);
      res.json(formatResponse({ path: realPath, success: true }));
    } catch (error) {
      logger.fileOperation('mkdir', dirPath, error, { duration: timer.elapsed() });
      handleFileError('mkdir', dirPath, error, res);
    }
  }));

  app.delete('/api/files', asyncHandler(async (req, res) => {
    const filePath = req.query.path || req.body?.path;
    const timer = createTimer();

    validate()
      .required('filePath', filePath)
      .type('filePath', filePath, 'string')
      .execute();

    try {
      const realPath = validatePath(filePath);
      await fs.remove(realPath);
      logger.fileSuccess('delete', filePath, timer.elapsed());
      broadcastFileEvent('file-deleted', filePath);
      res.json(formatResponse({ path: realPath, success: true }));
    } catch (error) {
      logger.fileOperation('delete', filePath, error, { duration: timer.elapsed() });
      handleFileError('delete', filePath, error, res);
    }
  }));

  // TRANSFORM OPERATIONS
  app.post('/api/files/rename', asyncHandler(async (req, res) => {
    const { path: filePath, newName } = req.body;
    const timer = createTimer();

    validate()
      .required('filePath', filePath)
      .required('newName', newName)
      .execute();

    try {
      validateFileName(newName);
      const realPath = validatePath(filePath);
      const dir = path.dirname(realPath);
      const newPath = path.join(dir, newName);
      validatePath(newPath);
      await fs.rename(realPath, newPath);
      const newRelativePath = filePath.substring(0, filePath.lastIndexOf('/') + 1) + newName;
      logger.fileSuccess('rename', filePath, timer.elapsed(), { newName });
      broadcastFileEvent('file-renamed', filePath, { newPath: newRelativePath });
      res.json(formatResponse({ oldPath: realPath, newPath: newPath, success: true }));
    } catch (error) {
      logger.fileOperation('rename', filePath, error, { duration: timer.elapsed(), newName });
      handleFileError('rename', filePath, error, res);
    }
  }));

  app.post('/api/files/copy', asyncHandler(async (req, res) => {
    const { path: filePath, newPath: destPath } = req.body;
    const timer = createTimer();

    validate()
      .required('filePath', filePath)
      .required('destPath', destPath)
      .type('filePath', filePath, 'string')
      .type('destPath', destPath, 'string')
      .execute();

    try {
      const realPath = validatePath(filePath);
      const realDest = validatePath(destPath);
      await fs.ensureDir(path.dirname(realDest));
      await fs.copy(realPath, realDest);
      logger.fileSuccess('copy', filePath, timer.elapsed(), { destination: destPath });
      broadcastFileEvent('file-copied', filePath, { destPath: destPath });
      res.json(formatResponse({ sourcePath: realPath, destPath: realDest, success: true }));
    } catch (error) {
      logger.fileOperation('copy', filePath, error, { duration: timer.elapsed(), destination: destPath });
      handleFileError('copy', filePath, error, res);
    }
  }));
}
