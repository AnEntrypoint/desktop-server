import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { AppRegistry } from './app-registry.js';
import http from 'http';
import logger from '@sequential/sequential-logging';
import { nowISO, createTimestamps, updateTimestamp } from '@sequential/timestamp-utilities';

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
import { registerQueueRoutes } from './routes/queue.js';
import { registerRunsRoutes } from './routes/runs.js';
import { registerAppRoutes } from './routes/apps.js';
import { registerDebugRoutes } from './routes/debug.js';
import { registerStorageObserverRoutes } from './routes/storage-observer.js';
import { registerBackgroundTaskRoutes } from './routes/background-tasks.js';
import { registerErrorLoggingRoutes } from './routes/error-logging.js';
import { registerHealthRoutes } from './routes/health.js';
import { CONFIG, taskQueueManager, queueWorkerPool, taskScheduler } from '@sequential/server-utilities';
import { registerWorkerRoutes } from './routes/workers.js';
import { registerSchedulerRoutes } from './routes/scheduler.js';
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
    logger.info('\n🚀 Starting Sequential Desktop Server...\n');

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

    container.register('QueueWorkerPool', () => queueWorkerPool, { singleton: true });
    container.register('TaskScheduler', () => taskScheduler, { singleton: true });

    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(securityHeaders);

    const corsConfig = {
      origin: process.env.CORS_ORIGIN || '*',
      methods: (process.env.CORS_METHODS || 'GET,POST,PUT,DELETE,OPTIONS').split(','),
      headers: (process.env.CORS_HEADERS || 'Content-Type,Authorization').split(','),
      maxAge: parseInt(process.env.CORS_MAX_AGE || '3600')
    };

    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', corsConfig.origin);
      res.header('Access-Control-Allow-Methods', corsConfig.methods.join(', '));
      res.header('Access-Control-Allow-Headers', corsConfig.headers.join(', '));
      res.header('Access-Control-Max-Age', corsConfig.maxAge.toString());
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
    registerQueueRoutes(app, container);
    registerWorkerRoutes(app, container);
    registerSchedulerRoutes(app, container);
    registerRunsRoutes(app, () => getActiveTasks(container));
    registerStorageObserverRoutes(app, container);
    registerBackgroundTaskRoutes(app);
    registerErrorLoggingRoutes(app);
    registerHealthRoutes(app);

    app.use(express.static(path.join(__dirname, '../../desktop-shell/dist')));
    app.use(express.static(path.join(__dirname, '../../zellous')));

    app.use(createErrorHandler());

    const httpServer = http.createServer(app);
    const { wss } = setupWebSocket(httpServer, () => getActiveTasks(container));

    backgroundTaskManager.on('task:start', (taskData) => {
      broadcastBackgroundTaskEvent({
        type: 'task:start',
        data: taskData,
        timestamp: nowISO()
      });
    });

    backgroundTaskManager.on('task:complete', (status) => {
      broadcastBackgroundTaskEvent({
        type: 'task:complete',
        status,
        timestamp: nowISO()
      });
    });

    backgroundTaskManager.on('task:failed', (status) => {
      broadcastBackgroundTaskEvent({
        type: 'task:failed',
        status,
        timestamp: nowISO()
      });
    });

    backgroundTaskManager.on('task:killed', (taskData) => {
      broadcastBackgroundTaskEvent({
        type: 'task:killed',
        data: taskData,
        timestamp: nowISO()
      });
    });

    backgroundTaskManager.on('task:progress', ({ id, progress }) => {
      broadcastBackgroundTaskEvent({
        type: 'task:progress',
        id,
        progress,
        timestamp: nowISO()
      });
    });

    const stateManager = container.resolve('StateManager');
    backgroundTaskManager.setStateManager(stateManager);
    taskQueueManager.setStateManager(stateManager);
    await taskQueueManager.loadFromStorage();

    queueWorkerPool.setDependencies(taskQueueManager, backgroundTaskManager);
    await queueWorkerPool.start();

    taskScheduler.setDependencies(taskQueueManager, stateManager);
    await taskScheduler.start();

    const { fileWatchers } = setupHotReload(app, appRegistry, __dirname);

    const baseUrl = `${PROTOCOL}://${HOSTNAME}:${PORT}`;
    const wsProtocol = PROTOCOL === 'https' ? 'wss' : 'ws';
    const wsBaseUrl = `${wsProtocol}://${HOSTNAME}:${PORT}`;

    httpServer.listen(PORT, () => {
      logger.info('\n✓ Sequential Desktop Server initialized\n');
      logger.info('Access points:');
      logger.info(`  Desktop:        ${baseUrl}`);
      logger.info(`  Apps API:       ${baseUrl}/api/apps`);
      logger.info(`  Sequential-OS:  ${baseUrl}/api/sequential-os/*`);
      logger.info(`  WebSocket:      ${wsBaseUrl}/api/runs/subscribe`);
      logger.info(`  Zellous:        ${baseUrl}/`);
      logger.info('\nRegistered apps:');
      appRegistry.getManifests().forEach(manifest => {
        logger.info(`  ${manifest.icon} ${manifest.name}: ${baseUrl}/apps/${manifest.id}/${manifest.entry}`);
      });
      logger.info('\nPress Ctrl+C to shutdown\n');
    });

    setupGracefulShutdown(httpServer, wss, fileWatchers, stateManager, queueWorkerPool, taskScheduler);

    return new Promise(() => {});

  } catch (error) {
    logger.error('\n✗ Failed to start server', error);
    throw error;
  }
}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
