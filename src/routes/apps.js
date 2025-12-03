import path from 'path';
import { asyncHandler } from '../middleware/error-handler.js';
import { formatResponse } from '@sequential/response-formatting';
import { throwNotFound } from '@sequential/error-handling';
import { resolveAppPath } from '@sequential/app-path-resolver';

export function registerAppRoutes(app, appRegistry, __dirname) {
  app.get('/api/apps', asyncHandler(async (req, res) => {
    res.json(formatResponse({ manifests: appRegistry.getManifests() }));
  }));

  app.use('/apps/:appId/*', (req, res, next) => {
    const { appId } = req.params;
    const appInfo = appRegistry.getApp(appId);
    if (!appInfo) throwNotFound('App', appId);

    const appPath = path.resolve(__dirname, `../../${appId}`);
    const requestedPath = path.join(appPath, req.params[0] || 'dist/index.html');
    const realPath = resolveAppPath(requestedPath, appPath);
    res.sendFile(realPath);
  });
}
