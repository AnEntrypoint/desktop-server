import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../middleware/error-handler.js';
import { formatResponse } from '@sequential/response-formatting';
import { throwNotFound, throwPathTraversal } from '@sequential/error-handling';

export function registerAppRoutes(app, appRegistry, __dirname) {
  app.get('/api/apps', asyncHandler(async (req, res) => {
    res.json(formatResponse({ manifests: appRegistry.getManifests() }));
  }));

  app.use('/apps/:appId/*', (req, res, next) => {
    const { appId } = req.params;
    const appInfo = appRegistry.getApp(appId);
    if (!appInfo) throwNotFound('App', appId);

    const appPath = path.resolve(__dirname, `../../${appId}`);
    const requestedPath = req.params[0] || 'dist/index.html';
    const filePath = path.resolve(appPath, requestedPath);

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
        throwPathTraversal(filePath);
      }
    }

    const realAppPath = fs.realpathSync(appPath);
    if (!realPath.startsWith(realAppPath + path.sep) && realPath !== realAppPath) {
      throwPathTraversal(realPath);
    }

    res.sendFile(realPath);
  });
}
