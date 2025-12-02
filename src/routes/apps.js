import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../middleware/error-handler.js';
import { formatResponse, formatError } from '@sequential/response-formatting';

export function registerAppRoutes(app, appRegistry, __dirname) {
  app.get('/api/apps', asyncHandler(async (req, res) => {
    const manifests = appRegistry.getManifests();
    res.json(formatResponse({ manifests }));
  }));

  app.use('/apps/:appId', (req, res, next) => {
    const { appId } = req.params;
    const app = appRegistry.getApp(appId);
    if (!app) {
      return res.status(404).json(formatError(404, { code: 'NOT_FOUND', message: 'App not found' }));
    }

    const appPath = path.resolve(__dirname, `../../${appId}`);
    const distPath = path.resolve(appPath, 'dist');
    const requestedFile = req.params[0] || 'index.html';
    const filePath = path.resolve(distPath, requestedFile);

    let realPath;
    try {
      realPath = fs.realpathSync(filePath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        const parentDir = path.dirname(filePath);
        try {
          const realParent = fs.realpathSync(parentDir);
          realPath = path.join(realParent, path.basename(filePath));
        } catch (parentErr) {
          realPath = filePath;
        }
      } else {
        return res.status(403).json(formatError(403, { code: 'FORBIDDEN', message: 'Access denied' }));
      }
    }

    if (!realPath.startsWith(distPath + path.sep) && realPath !== distPath) {
      return res.status(403).json(formatError(403, { code: 'FORBIDDEN', message: 'Access denied: path traversal detected' }));
    }

    res.sendFile(realPath);
  });
}
