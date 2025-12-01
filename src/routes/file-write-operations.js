import fs from 'fs-extra';
import { validate } from '@sequential/param-validation';
import { asyncHandler } from '../middleware/error-handler.js';
import { logFileOperation, logFileSuccess } from '@sequential/error-handling';
import { writeFileAtomicString } from '@sequential/file-operations';
import { broadcastFileEvent, validateAndResolvePath, startTiming, getDuration, handleFileError } from './file-operations-utils.js';

export function registerFileWriteOperations(app) {
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
      const isNew = !fs.existsSync(realPath);
      await writeFileAtomicString(realPath, content);
      const duration = getDuration(startTime);
      logFileSuccess('write', filePath, duration, { size: content.length, isNew });
      broadcastFileEvent(isNew ? 'file-created' : 'file-modified', filePath);
      res.json({ path: realPath, size: content.length, success: true });
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('write', filePath, error, { duration, contentLength: content?.length || 0 });
      return handleFileError('write', filePath, error, res);
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
      res.json({ path: realPath, success: true });
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('mkdir', dirPath, error, { duration });
      return handleFileError('mkdir', dirPath, error, res);
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
      res.json({ path: realPath, success: true });
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('delete', filePath, error, { duration });
      return handleFileError('delete', filePath, error, res);
    }
  }));
}
