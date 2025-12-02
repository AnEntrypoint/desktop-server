import path from 'path';
import fs from 'fs-extra';
import { asyncHandler } from '../middleware/error-handler.js';
import { CONFIG } from '@sequential/server-utilities';
import { logFileOperation, logFileSuccess, createServerError } from '@sequential/error-handling';
import { writeFileAtomicString } from '@sequential/file-operations';
import { validate } from '@sequential/param-validation';
import { validateFileName } from '@sequential/core';
import { formatResponse, formatError } from '@sequential/response-formatting';

function validateAndResolvePath(filePath) {
  if (!filePath) throw createServerError('File path required');
  const realPath = path.resolve(filePath);
  if (!realPath.startsWith(process.cwd())) {
    throw createServerError('Path traversal not allowed');
  }
  return realPath;
}

function startTiming() {
  return Date.now();
}

function getDuration(startTime) {
  return Date.now() - startTime;
}

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

  // READ OPERATIONS
  app.get('/api/files/current-path', (req, res) => {
    res.json(formatResponse({ path: process.cwd() }));
  });

  app.get('/api/files/list', asyncHandler(async (req, res) => {
    const dir = req.query.dir || process.cwd();
    const realPath = validateAndResolvePath(dir);
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
    const startTime = startTiming();
    try {
      const realPath = validateAndResolvePath(filePath);
      const stat = await fs.stat(realPath);
      if (stat.isDirectory()) {
        return res.status(400).json(formatError(400, { code: 'INVALID_OPERATION', message: 'Cannot read directory' }));
      }
      if (stat.size > CONFIG.files.maxSizeBytes) {
        const maxMb = Math.round(CONFIG.files.maxSizeBytes / (1024 * 1024));
        const error = new Error(`File too large (max ${maxMb}MB)`);
        error.code = 'FILE_TOO_LARGE';
        logFileOperation('read', filePath, error, { size: stat.size, limit: CONFIG.files.maxSizeBytes });
        return res.status(400).json(formatError(400, { code: error.code, message: error.message }));
      }
      const content = await fs.readFile(realPath, 'utf8');
      const duration = getDuration(startTime);
      logFileSuccess('read', filePath, duration, { size: stat.size });
      res.json(formatResponse({ path: realPath, size: stat.size, content, modified: stat.mtime }));
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('read', filePath, error, { duration });
      handleFileError('read', filePath, error, res);
    }
  }));

  // WRITE OPERATIONS
  app.post('/api/files/save', asyncHandler(async (req, res) => {
    const { path: filePath, content } = req.body;
    const startTime = startTiming();

    validate()
      .required('path', filePath)
      .required('content', content)
      .type('content', content, 'string')
      .execute();

    try {
      const realPath = validateAndResolvePath(filePath);
      await writeFileAtomicString(realPath, content);
      const duration = getDuration(startTime);
      logFileSuccess('save', filePath, duration, { size: content.length });
      res.json(formatResponse({ path: realPath, success: true }));
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('save', filePath, error, { duration, contentLength: content?.length || 0 });
      handleFileError('save', filePath, error, res);
    }
  }));

  app.post('/api/files/write', asyncHandler(async (req, res) => {
    const { path: filePath, content } = req.body;
    const startTime = startTiming();

    validate()
      .required('filePath', filePath)
      .required('content', content)
      .type('content', content, 'string')
      .execute();

    try {
      const realPath = validateAndResolvePath(filePath);
      const isNew = !await fs.pathExists(realPath);
      await writeFileAtomicString(realPath, content);
      const duration = getDuration(startTime);
      logFileSuccess('write', filePath, duration, { size: content.length, isNew });
      broadcastFileEvent(isNew ? 'file-created' : 'file-modified', filePath);
      res.json(formatResponse({ path: realPath, size: content.length, success: true }));
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('write', filePath, error, { duration, contentLength: content?.length || 0 });
      handleFileError('write', filePath, error, res);
    }
  }));

  app.post('/api/files/mkdir', asyncHandler(async (req, res) => {
    const { path: dirPath } = req.body;
    const startTime = startTiming();

    validate()
      .required('dirPath', dirPath)
      .type('dirPath', dirPath, 'string')
      .execute();

    try {
      const realPath = validateAndResolvePath(dirPath);
      await fs.ensureDir(realPath);
      const duration = getDuration(startTime);
      logFileSuccess('mkdir', dirPath, duration);
      broadcastFileEvent('directory-created', dirPath);
      res.json(formatResponse({ path: realPath, success: true }));
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('mkdir', dirPath, error, { duration });
      handleFileError('mkdir', dirPath, error, res);
    }
  }));

  app.delete('/api/files', asyncHandler(async (req, res) => {
    const filePath = req.query.path || req.body?.path;
    const startTime = startTiming();

    validate()
      .required('filePath', filePath)
      .type('filePath', filePath, 'string')
      .execute();

    try {
      const realPath = validateAndResolvePath(filePath);
      await fs.remove(realPath);
      const duration = getDuration(startTime);
      logFileSuccess('delete', filePath, duration);
      broadcastFileEvent('file-deleted', filePath);
      res.json(formatResponse({ path: realPath, success: true }));
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('delete', filePath, error, { duration });
      handleFileError('delete', filePath, error, res);
    }
  }));

  // TRANSFORM OPERATIONS
  app.post('/api/files/rename', asyncHandler(async (req, res) => {
    const { path: filePath, newName } = req.body;
    const startTime = startTiming();

    validate()
      .required('filePath', filePath)
      .required('newName', newName)
      .execute();

    try {
      validateFileName(newName);
      const realPath = validateAndResolvePath(filePath);
      const dir = path.dirname(realPath);
      const newPath = path.join(dir, newName);
      validateAndResolvePath(newPath);
      await fs.rename(realPath, newPath);
      const duration = getDuration(startTime);
      const newRelativePath = filePath.substring(0, filePath.lastIndexOf('/') + 1) + newName;
      logFileSuccess('rename', filePath, duration, { newName });
      broadcastFileEvent('file-renamed', filePath, { newPath: newRelativePath });
      res.json(formatResponse({ oldPath: realPath, newPath: newPath, success: true }));
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('rename', filePath, error, { duration, newName });
      handleFileError('rename', filePath, error, res);
    }
  }));

  app.post('/api/files/copy', asyncHandler(async (req, res) => {
    const { path: filePath, newPath: destPath } = req.body;
    const startTime = startTiming();

    validate()
      .required('filePath', filePath)
      .required('destPath', destPath)
      .type('filePath', filePath, 'string')
      .type('destPath', destPath, 'string')
      .execute();

    try {
      const realPath = validateAndResolvePath(filePath);
      const realDest = validateAndResolvePath(destPath);
      await fs.ensureDir(path.dirname(realDest));
      await fs.copy(realPath, realDest);
      const duration = getDuration(startTime);
      logFileSuccess('copy', filePath, duration, { destination: destPath });
      broadcastFileEvent('file-copied', filePath, { destPath: destPath });
      res.json(formatResponse({ sourcePath: realPath, destPath: realDest, success: true }));
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('copy', filePath, error, { duration, destination: destPath });
      handleFileError('copy', filePath, error, res);
    }
  }));
}
