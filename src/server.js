import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { AppRegistry } from './app-registry.js';
import http from 'http';

import { createRequestLogger } from '@sequential/server-utilities';
import { createRateLimitMiddleware } from '@sequential/input-sanitization';
import { createErrorHandler } from './middleware/error-handler.js';
import { securityHeaders } from './middleware/security-headers.js';
import { registerSequentialOsRoutes } from './routes/sequential-os.js';
import { registerFileRoutes } from './routes/files.js';
import { registerVfsRoutes } from './routes/vfs.js';
import { registerTaskRoutes, getActiveTasks } from './routes/tasks.js';
import { registerFlowRoutes } from './routes/flows.js';
import { registerToolRoutes } from './routes/tools.js';
import { registerRunsRoutes } from './routes/runs.js';
import { registerAppRoutes } from './routes/apps.js';
import { registerDebugRoutes } from './routes/debug.js';
import { registerStorageObserverRoutes } from './routes/storage-observer.js';
import { registerBackgroundTaskRoutes } from './routes/background-tasks.js';
import { CONFIG } from '@sequential/server-utilities';
import { setupDIContainer } from './utils/di-setup.js';
import { ensureDirectories, loadStateKit, initializeStateKit, validateEnvironment } from './utils/initialization.js';
import { setupHotReload, closeFileWatchers } from './utils/hot-reload.js';
import { setupWebSocket } from './utils/websocket-setup.js';
import { setupGracefulShutdown } from './utils/graceful-shutdown.js';
import { StateManager, FileSystemAdapter } from '@sequential/persistent-state';
import { backgroundTaskManager } from '@sequential/server-utilities';
import { broadcastBackgroundTaskEvent } from '@sequential/websocket-broadcaster';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = CONFIG.server.port;
const HOSTNAME = CONFIG.server.hostname;
const PROTOCOL = CONFIG.server.protocol;

async function main() {
  try {
    console.log('\n🚀 Starting Sequential Desktop Server...\n');

    validateEnvironment();

    const dirConfig = {};
    const { STATEKIT_DIR, WORK_DIR } = await ensureDirectories(dirConfig);

    const StateKit = loadStateKit();
    const kit = await initializeStateKit(StateKit, STATEKIT_DIR, WORK_DIR);

    const appRegistry = new AppRegistry({
      appDirs: [
        'app-terminal',
        'app-debugger',
        'app-flow-editor',
        'app-task-editor',
        'app-code-editor',
        'app-tool-editor',
        'app-task-debugger',
        'app-flow-debugger',
        'app-run-observer',
        'app-file-browser'
      ]
    });

    await appRegistry.discover();

    const container = setupDIContainer();

    const stateDir = path.join(WORK_DIR, '.state');
    container.register('StateManager', () => {
      const stateAdapter = new FileSystemAdapter(stateDir);
      return new StateManager(stateAdapter, {
        maxCacheSize: parseInt(process.env.STATE_CACHE_SIZE || '5000'),
        cacheTTL: parseInt(process.env.STATE_TTL_MS || '600000'),
        cleanupInterval: parseInt(process.env.STATE_CLEANUP_INTERVAL_MS || '60000')
      });
    }, { singleton: true });

    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(securityHeaders);

    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Max-Age', '3600');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      next();
    });

    app.use((req, res, next) => {
      req.requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      res.header('X-Request-ID', req.requestId);
      next();
    });

    app.use('/api/', createRequestLogger());
    app.use('/api/', createRateLimitMiddleware(100, 60000));

    registerDebugRoutes(app, container);
    registerAppRoutes(app, appRegistry, __dirname);
    registerSequentialOsRoutes(app, kit, STATEKIT_DIR);
    registerFileRoutes(app, container);
    registerVfsRoutes(app, container);
    registerTaskRoutes(app, container);
    registerFlowRoutes(app, container);
    registerToolRoutes(app, container);
    registerRunsRoutes(app, () => getActiveTasks(container));
    registerStorageObserverRoutes(app, container);
    registerBackgroundTaskRoutes(app);

    app.use(express.static(path.join(__dirname, '../../desktop-shell/dist')));
    app.use(express.static(path.join(__dirname, '../../zellous')));

    app.use(createErrorHandler());

    const httpServer = http.createServer(app);
    const { wss } = setupWebSocket(httpServer, () => getActiveTasks(container));

    backgroundTaskManager.on('task:start', (taskData) => {
      broadcastBackgroundTaskEvent({
        type: 'task:start',
        data: taskData,
        timestamp: new Date().toISOString()
      });
    });

    backgroundTaskManager.on('task:complete', (status) => {
      broadcastBackgroundTaskEvent({
        type: 'task:complete',
        status,
        timestamp: new Date().toISOString()
      });
    });

    backgroundTaskManager.on('task:failed', (status) => {
      broadcastBackgroundTaskEvent({
        type: 'task:failed',
        status,
        timestamp: new Date().toISOString()
      });
    });

    backgroundTaskManager.on('task:killed', (taskData) => {
      broadcastBackgroundTaskEvent({
        type: 'task:killed',
        data: taskData,
        timestamp: new Date().toISOString()
      });
    });

    backgroundTaskManager.on('task:progress', ({ id, progress }) => {
      broadcastBackgroundTaskEvent({
        type: 'task:progress',
        id,
        progress,
        timestamp: new Date().toISOString()
      });
    });

    const stateManager = container.resolve('StateManager');
    backgroundTaskManager.setStateManager(stateManager);

    const { fileWatchers } = setupHotReload(app, appRegistry, __dirname);

    const baseUrl = `${PROTOCOL}://${HOSTNAME}:${PORT}`;
    const wsProtocol = PROTOCOL === 'https' ? 'wss' : 'ws';
    const wsBaseUrl = `${wsProtocol}://${HOSTNAME}:${PORT}`;

    httpServer.listen(PORT, () => {
      console.log('\n✓ Sequential Desktop Server initialized\n');
      console.log('Access points:');
      console.log(`  Desktop:        ${baseUrl}`);
      console.log(`  Apps API:       ${baseUrl}/api/apps`);
      console.log(`  Sequential-OS:  ${baseUrl}/api/sequential-os/*`);
      console.log(`  WebSocket:      ${wsBaseUrl}/api/runs/subscribe`);
      console.log(`  Zellous:        ${baseUrl}/`);
      console.log('\nRegistered apps:');
      appRegistry.getManifests().forEach(manifest => {
        console.log(`  ${manifest.icon} ${manifest.name}: ${baseUrl}/apps/${manifest.id}/${manifest.entry}`);
      });
      console.log('\nPress Ctrl+C to shutdown\n');
    });

    setupGracefulShutdown(httpServer, wss, fileWatchers, stateManager);

    return new Promise(() => {});

  } catch (error) {
    console.error('\n✗ Failed to start server');
    console.error(`  Error: ${error.message}`);
    throw error;
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
