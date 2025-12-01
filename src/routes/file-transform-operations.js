import path from 'path';
import fs from 'fs-extra';
import { validate } from '../middleware/validation-chain.js';
import { validateFileName } from '../lib/utils.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { logFileOperation, logFileSuccess } from '../utils/error-logger.js';
import { broadcastFileEvent, validateAndResolvePath, startTiming, getDuration, handleFileError } from './file-operations-utils.js';

export function registerFileTransformOperations(app) {
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
      res.json({ oldPath: realPath, newPath: newPath, success: true });
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('rename', filePath, error, { duration, newName });
      return handleFileError('rename', filePath, error, res);
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
      res.json({ sourcePath: realPath, destPath: realDest, success: true });
    } catch (error) {
      const duration = getDuration(startTime);
      logFileOperation('copy', filePath, error, { duration, destination: destPath });
      return handleFileError('copy', filePath, error, res);
    }
  }));
}
