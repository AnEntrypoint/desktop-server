import path from 'path';
import { asyncHandler } from '../middleware/error-handler.js';

export function registerAppRoutes(app, appRegistry, __dirname) {
  app.get('/api/apps', asyncHandler(async (req, res) => {
    const manifests = appRegistry.getManifests();
    res.json(manifests);
  }));

  app.use('/apps/:appId', (req, res, next) => {
    const { appId } = req.params;
    const app = appRegistry.getApp(appId);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }
    const appPath = path.join(__dirname, `../../${appId}`);
    res.sendFile(path.join(appPath, 'dist', req.params[0] || 'index.html'));
  });
}
