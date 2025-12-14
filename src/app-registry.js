import path from 'path';
import fs from 'fs-extra';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createValidationError } from '@sequentialos/error-handling';
import logger from '@sequentialos/sequential-logging';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class AppRegistry {
  constructor(options = {}) {
    this.apps = new Map();
    this.appDirs = options.appDirs || [];
    this.basePath = options.basePath || path.join(__dirname, '../../');
  }

  validateManifest(manifest, appDir) {
    const errors = [];

    if (!manifest.id || typeof manifest.id !== 'string') {
      errors.push('id is required and must be a string');
    }
    if (!manifest.name || typeof manifest.name !== 'string') {
      errors.push('name is required and must be a string');
    }
    if (!manifest.entry || typeof manifest.entry !== 'string') {
      errors.push('entry is required and must be a string');
    }

    if (manifest.version && typeof manifest.version !== 'string') {
      errors.push('version must be a string if provided');
    }

    if (manifest.icon && typeof manifest.icon !== 'string') {
      errors.push('icon must be a string if provided');
    }

    if (manifest.window && typeof manifest.window !== 'object') {
      errors.push('window must be an object if provided');
    }

    if (manifest.capabilities && !Array.isArray(manifest.capabilities)) {
      errors.push('capabilities must be an array if provided');
    }

    if (manifest.description && typeof manifest.description !== 'string') {
      errors.push('description must be a string if provided');
    }

    if (errors.length > 0) {
      throw createValidationError(`Invalid manifest for ${appDir}: ${errors.join('; ')}`, 'manifest');
    }

    return true;
  }

  async discover() {
    logger.info('Discovering apps...');

    for (const appDir of this.appDirs) {
      const fullPath = path.join(this.basePath, appDir);
      const manifestPath = path.join(fullPath, 'manifest.json');

      try {
        if (await fs.pathExists(manifestPath)) {
          const manifest = await fs.readJSON(manifestPath);
          this.validateManifest(manifest, appDir);
          this.apps.set(manifest.id, {
            manifest,
            basePath: fullPath
          });
          logger.info(`  ✓ Registered app: ${manifest.name} (${manifest.id})`);
        }
      } catch (error) {
        logger.error(`  ✗ Failed to load ${appDir}:`, error.message);
      }
    }

    const ecosystemPath = process.env.ECOSYSTEM_PATH;
    if (ecosystemPath) {
      const localAppsDir = path.join(ecosystemPath, '.sequential', 'apps');
      try {
        if (await fs.pathExists(localAppsDir)) {
          const appDirs = await fs.readdir(localAppsDir);
          for (const appDir of appDirs) {
            const appPath = path.join(localAppsDir, appDir);
            const manifestPath = path.join(appPath, 'manifest.json');
            try {
              if (await fs.pathExists(manifestPath)) {
                const manifest = await fs.readJSON(manifestPath);
                this.validateManifest(manifest, appDir);
                this.apps.set(manifest.id, {
                  manifest,
                  basePath: appPath
                });
                logger.info(`  ✓ Registered local app: ${manifest.name} (${manifest.id})`);
              }
            } catch (error) {
              logger.error(`  ✗ Failed to load local app ${appDir}:`, error.message);
            }
          }
        }
      } catch (error) {
        logger.error(`  ✗ Failed to discover local apps:`, error.message);
      }
    }

    logger.info(`✓ Discovered ${this.apps.size} apps`);
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
