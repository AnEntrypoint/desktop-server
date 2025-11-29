import path from 'path';
import fs from 'fs-extra';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class AppRegistry {
  constructor(options = {}) {
    this.apps = new Map();
    this.appDirs = options.appDirs || [];
    this.basePath = options.basePath || path.join(__dirname, '../../');
  }

  async discover() {
    console.log('Discovering apps...');

    for (const appDir of this.appDirs) {
      const fullPath = path.join(this.basePath, appDir);
      const manifestPath = path.join(fullPath, 'manifest.json');

      try {
        if (await fs.pathExists(manifestPath)) {
          const manifest = await fs.readJSON(manifestPath);
          this.apps.set(manifest.id, {
            manifest,
            basePath: fullPath
          });
          console.log(`  ✓ Registered app: ${manifest.name} (${manifest.id})`);
        }
      } catch (error) {
        console.error(`  ✗ Failed to load ${appDir}:`, error.message);
      }
    }

    console.log(`✓ Discovered ${this.apps.size} apps`);
  }

  getManifests() {
    return Array.from(this.apps.values()).map(app => app.manifest);
  }

  getApp(appId) {
    return this.apps.get(appId);
  }

  createAppRouter(appId) {
    const app = this.apps.get(appId);
    if (!app) {
      return null;
    }

    const router = express.Router();
    router.use(express.static(app.basePath));
    return router;
  }
}

export { AppRegistry };
