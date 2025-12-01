import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { AppRegistry } from './app-registry.js';
import { createRequire } from 'module';
import { watch } from 'fs';
import { WebSocketServer } from 'ws';
import http from 'http';

import { createRequestLogger } from './middleware/request-logger.js';
import { createRateLimitMiddleware, createWebSocketRateLimiter, checkWebSocketRateLimit } from './middleware/rate-limit.js';
import { createErrorHandler, asyncHandler, logOperation } from './middleware/error-handler.js';
import { addRunSubscriber, removeRunSubscriber, addTaskSubscriber, removeTaskSubscriber, addFileSubscriber, removeFileSubscriber, broadcastToRunSubscribers } from './utils/ws-broadcaster.js';
import { registerSequentialOsRoutes } from './routes/sequential-os.js';
import { registerFileRoutes } from './routes/files.js';
import { registerTaskRoutes, getActiveTasks } from './routes/tasks.js';
import { registerFlowRoutes } from './routes/flows.js';
import { registerToolRoutes } from './routes/tools.js';
import { registerRunsRoutes } from './routes/runs.js';
import { registerAppRoutes } from './routes/apps.js';
import { registerDebugRoutes } from './routes/debug.js';
import { registerStorageObserverRoutes } from './routes/storage-observer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const sequentialMachinePath = path.join(__dirname, '../../sequential-machine');

let resolvedMachinePath;
try {
  resolvedMachinePath = fs.realpathSync(sequentialMachinePath);
} catch (err) {
  console.error('Failed to resolve sequential-machine path:', err.message);
  throw new Error('Cannot initialize StateKit: sequential-machine directory not found or inaccessible');
}

if (!resolvedMachinePath.includes('sequential-machine')) {
  throw new Error('Invalid sequential-machine path: potential symlink attack detected');
}

let { StateKit };
try {
  ({ StateKit } = require(resolvedMachinePath));
} catch (err) {
  console.error('Failed to load StateKit from:', resolvedMachinePath);
  throw new Error(`Cannot load StateKit: ${err.message}`);
}

const PORT = process.env.PORT || 8003;
const HOME_DIR = os.homedir();
const STATEKIT_DIR = process.env.SEQUENTIAL_MACHINE_DIR || path.join(HOME_DIR, '.sequential-machine');
const WORK_DIR = process.env.SEQUENTIAL_MACHINE_WORK || path.join(STATEKIT_DIR, 'work');
const VFS_DIR = process.env.VFS_DIR || path.join(HOME_DIR, '.sequential-vfs');
const ZELLOUS_DATA_DIR = process.env.ZELLOUS_DATA || path.join(HOME_DIR, '.zellous-data');

async function ensureDirectories() {
  await fs.ensureDir(STATEKIT_DIR);
  await fs.ensureDir(WORK_DIR);
  await fs.ensureDir(path.join(STATEKIT_DIR, 'layers'));
  await fs.ensureDir(VFS_DIR);
  await fs.ensureDir(ZELLOUS_DATA_DIR);
  console.log('✓ Directories initialized');
  console.log(`  StateKit: ${STATEKIT_DIR}`);
  console.log(`  VFS: ${VFS_DIR}`);
  console.log(`  Zellous: ${ZELLOUS_DATA_DIR}`);
}

async function initializeStateKit() {
  const kit = new StateKit({
    stateDir: STATEKIT_DIR,
    workdir: WORK_DIR
  });

  const status = await kit.status();
  console.log(`✓ StateKit initialized (${status.added.length + status.modified.length + status.deleted.length} uncommitted changes)`);

  return kit;
}

async function main() {
  try {
    console.log('\n🚀 Starting Sequential Desktop Server...\n');

    await ensureDirectories();
    const kit = await initializeStateKit();

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

    const app = express();
    app.use(express.json({ limit: '50mb' }));

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

    registerDebugRoutes(app);
    registerAppRoutes(app, appRegistry, __dirname);
    registerSequentialOsRoutes(app, kit, STATEKIT_DIR);
    registerFileRoutes(app);
    registerTaskRoutes(app);
    registerFlowRoutes(app);
    registerToolRoutes(app);
    registerRunsRoutes(app, getActiveTasks);
    registerStorageObserverRoutes(app);

    app.use(express.static(path.join(__dirname, '../../desktop-shell/dist')));
    app.use(express.static(path.join(__dirname, '../../zellous')));

    app.use(createErrorHandler());

    const httpServer = http.createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    createWebSocketRateLimiter();

    httpServer.on('upgrade', (req, socket, head) => {
      const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for'] || '127.0.0.1';
      const limiter = checkWebSocketRateLimit(clientIp);

      if (!limiter.isAllowed()) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\n\r\n');
        socket.write(JSON.stringify({ error: 'Too many WebSocket connections from this IP', remaining: 0 }));
        socket.destroy();
        return;
      }

      if (req.url.startsWith('/api/runs/subscribe')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          if (!limiter.add(ws)) {
            ws.close(1008, 'Per-IP connection limit exceeded');
            return;
          }
          const subscriptionId = `run-${Date.now()}`;
          addRunSubscriber(subscriptionId, ws);

          ws.on('error', (error) => {
            console.error(`WebSocket error [${subscriptionId}]:`, error.message);
            removeRunSubscriber(subscriptionId);
            limiter.remove(ws);
            try {
              ws.close(1011, 'Internal server error');
            } catch (e) {}
          });

          ws.on('close', () => {
            removeRunSubscriber(subscriptionId);
            limiter.remove(ws);
          });

          try {
            const activeTasks = getActiveTasks();
            ws.send(JSON.stringify({ type: 'connected', activeRuns: activeTasks.size }));
          } catch (e) {
            console.error(`Failed to send initial message [${subscriptionId}]:`, e.message);
          }
        });
      } else if (req.url.match(/^\/api\/tasks\/([^/]+)\/subscribe$/)) {
        const taskName = req.url.match(/^\/api\/tasks\/([^/]+)\/subscribe$/)[1];
        wss.handleUpgrade(req, socket, head, (ws) => {
          if (!limiter.add(ws)) {
            ws.close(1008, 'Per-IP connection limit exceeded');
            return;
          }
          addTaskSubscriber(taskName, ws);

          ws.on('error', (error) => {
            console.error(`WebSocket error [${taskName}]:`, error.message);
            removeTaskSubscriber(taskName, ws);
            limiter.remove(ws);
            try {
              ws.close(1011, 'Internal server error');
            } catch (e) {}
          });

          ws.on('close', () => {
            removeTaskSubscriber(taskName, ws);
            limiter.remove(ws);
          });

          try {
            ws.send(JSON.stringify({ type: 'connected', taskName }));
          } catch (e) {
            console.error(`Failed to send initial message for task [${taskName}]:`, e.message);
          }
        });
      } else if (req.url.startsWith('/api/files/subscribe')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          if (!limiter.add(ws)) {
            ws.close(1008, 'Per-IP connection limit exceeded');
            return;
          }
          addFileSubscriber(ws);

          ws.on('error', (error) => {
            console.error('WebSocket error [files]:',  error.message);
            removeFileSubscriber(ws);
            limiter.remove(ws);
            try {
              ws.close(1011, 'Internal server error');
            } catch (e) {}
          });

          ws.on('close', () => {
            removeFileSubscriber(ws);
            limiter.remove(ws);
          });

          try {
            ws.send(JSON.stringify({ type: 'connected', message: 'File subscription established' }));
          } catch (e) {
            console.error('Failed to send initial message for files:', e.message);
          }
        });
      } else {
        socket.destroy();
      }
    });

    const server = httpServer.listen(PORT, () => {
      console.log('\n✓ Sequential Desktop Server initialized\n');
      console.log('Access points:');
      console.log(`  Desktop:        http://localhost:${PORT}`);
      console.log(`  Apps API:       http://localhost:${PORT}/api/apps`);
      console.log(`  Sequential-OS:  http://localhost:${PORT}/api/sequential-os/*`);
      console.log(`  WebSocket:      ws://localhost:${PORT}/api/runs/subscribe`);
      console.log(`  Zellous:        http://localhost:${PORT}/`);
      console.log('\nRegistered apps:');
      appRegistry.getManifests().forEach(manifest => {
        console.log(`  ${manifest.icon} ${manifest.name}: http://localhost:${PORT}/apps/${manifest.id}/${manifest.entry}`);
      });
      console.log('\nPress Ctrl+C to shutdown\n');
    });

    const hotReloadClients = [];
    const fileWatchers = [];

    app.get('/dev/reload', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      hotReloadClients.push(res);

      req.on('close', () => {
        const index = hotReloadClients.indexOf(res);
        if (index !== -1) {
          hotReloadClients.splice(index, 1);
        }
      });

      req.on('error', () => {
        const index = hotReloadClients.indexOf(res);
        if (index !== -1) {
          hotReloadClients.splice(index, 1);
        }
      });
    });

    function notifyReload(file) {
      console.log(`\n🔥 Hot reload: ${path.basename(file)}`);
      for (let i = hotReloadClients.length - 1; i >= 0; i--) {
        const client = hotReloadClients[i];
        try {
          client.write(`data: ${JSON.stringify({ type: 'reload', file })}\n\n`);
        } catch (err) {
          hotReloadClients.splice(i, 1);
        }
      }
    }

    const watchPaths = [
      path.join(__dirname, '../../desktop-shell/dist'),
      ...appRegistry.getManifests().map(app =>
        path.join(__dirname, `../../${app.id}/dist`)
      )
    ];

    watchPaths.forEach(watchPath => {
      if (fs.existsSync(watchPath)) {
        const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
          if (filename && (filename.endsWith('.html') || filename.endsWith('.js') || filename.endsWith('.css'))) {
            notifyReload(path.join(watchPath, filename));
          }
        });
        fileWatchers.push(watcher);
        console.log(`  👁️  Watching: ${path.relative(path.join(__dirname, '../..'), watchPath)}`);
      }
    });

    process.on('SIGINT', () => {
      console.log('\n\nShutting down...');
      fileWatchers.forEach(watcher => watcher.close());
      process.exit(0);
    });

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
