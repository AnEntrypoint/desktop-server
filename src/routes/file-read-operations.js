import path from 'path';
import fs from 'fs-extra';
import { asyncHandler } from '../middleware/error-handler.js';
import { CONFIG } from '@sequential/server-utilities';
import { logFileOperation, logFileSuccess } from '@sequential/error-handling';
import { writeFileAtomicString } from '@sequential/file-operations';
import { validateAndResolvePath, startTiming, getDuration, handleFileError } from './file-operations-utils.js';

export function registerFileReadOperations(app) {
  app.get('/api/files/current-path', (req, res) => {
    res.json({ path: process.cwd() });
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
    res.json({ directory: realPath, files: items.sort((a, b) => a.name.localeCompare(b.name)) });
  }));

  app.get('/api/files/read', asyncHandler(async (req, res) => {
    const filePath = req.query.path;
    const startTime = startTiming();
    try {
      const realPath = validateAndResolvePath(filePath);
      const stat = await fs.stat(realPath);
      if (stat.isDirectory()) {
        return res.status(400).json({ error: { code: 'INVALID_OPERATION', message: 'Cannot read directory' } });
      }
      if (stat.size > CONFIG.files.maxSizeBytes) {
        const maxMb = Math.round(CONFIG.files.maxSizeBytes / (1024 * 1024));
        logFileOperation('read', filePath, new Error('File too large'), { size: stat.size, limit: CONFIG.files.maxSizeBytes });
        return res.status(400).json({ error: { code: 'FILE_TOO_LARGE', message: `File too large (max ${maxMb}MB)` } });
      }
      const content = await fs.readFile(realPath, 'utf8');
      const duration = getDuration(startTime);
      logFileSuccess('read', filePath, duration, { size: stat.size });
      res.json({ path: realPath, size: stat.size, content, modified: stat.mtime });
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('read', filePath, error, { duration });
      return handleFileError('read', filePath, error, res);
    }
  }));

  app.post('/api/files/save', asyncHandler(async (req, res) => {
    const { path: filePath, content } = req.body;
    const startTime = startTiming();

    if (!filePath) {
      throw new Error('path is required');
    }
    if (content === undefined || content === null) {
      throw new Error('content is required');
    }
    if (typeof content !== 'string') {
      throw new Error('content must be a string');
    }

    try {
      const realPath = validateAndResolvePath(filePath);
      await writeFileAtomicString(realPath, content);
      const duration = getDuration(startTime);
      logFileSuccess('save', filePath, duration, { size: content.length });
      res.json({ path: realPath, success: true });
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('save', filePath, error, { duration, contentLength: content?.length || 0 });
      return handleFileError('save', filePath, error, res);
    }
  }));
}
