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
import { Worker } from 'worker_threads';
import { validateFilePath, readJsonFile, writeJsonFile, getAllFiles, truncateString } from './lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const sequentialMachinePath = path.join(__dirname, '../../sequential-machine');
const { StateKit } = require(sequentialMachinePath);

const PORT = process.env.PORT || 8003;
const HOME_DIR = os.homedir();
const STATEKIT_DIR = process.env.SEQUENTIAL_MACHINE_DIR || path.join(HOME_DIR, '.sequential-machine');
const WORK_DIR = process.env.SEQUENTIAL_MACHINE_WORK || path.join(STATEKIT_DIR, 'work');
const VFS_DIR = process.env.VFS_DIR || path.join(HOME_DIR, '.sequential-vfs');
const ZELLOUS_DATA_DIR = process.env.ZELLOUS_DATA || path.join(HOME_DIR, '.zellous-data');

const runSubscribers = new Map();
const taskSubscribers = new Map();
const fileSubscribers = new Set();
const activeTasks = new Map();

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

function broadcastToRunSubscribers(message) {
  const data = JSON.stringify(message);
  runSubscribers.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function broadcastToTaskSubscribers(taskName, message) {
  if (!taskSubscribers.has(taskName)) return;
  const data = JSON.stringify(message);
  taskSubscribers.get(taskName).forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function broadcastToFileSubscribers(message) {
  const data = JSON.stringify(message);
  fileSubscribers.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function createErrorResponse(code, message, details = {}) {
  return {
    error: {
      code,
      message,
      details
    },
    timestamp: new Date().toISOString()
  };
}

async function executeTaskWithTimeout(taskName, code, input, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Task execution timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      const fn = new Function('fetch', 'input', `${code}; return myTask(input);`);
      Promise.resolve(fn(fetch, input || {}))
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function validateInput(data, schema) {
  if (!schema) return true;
  if (schema.type === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return { valid: false, error: 'Expected object' };
    }
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in data)) {
          return { valid: false, error: `Missing required field: ${key}` };
        }
      }
    }
    if (schema.properties) {
      for (const key in schema.properties) {
        if (key in data) {
          const result = validateInput(data[key], schema.properties[key]);
          if (!result.valid) return result;
        }
      }
    }
    return { valid: true };
  } else if (schema.type === 'string') {
    if (typeof data !== 'string') {
      return { valid: false, error: `Expected string, got ${typeof data}` };
    }
    if (schema.minLength && data.length < schema.minLength) {
      return { valid: false, error: `String too short (min ${schema.minLength})` };
    }
    if (schema.maxLength && data.length > schema.maxLength) {
      return { valid: false, error: `String too long (max ${schema.maxLength})` };
    }
    return { valid: true };
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof data !== 'number' || (schema.type === 'integer' && !Number.isInteger(data))) {
      return { valid: false, error: `Expected ${schema.type}` };
    }
    if (schema.minimum !== undefined && data < schema.minimum) {
      return { valid: false, error: `Number below minimum (${schema.minimum})` };
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      return { valid: false, error: `Number above maximum (${schema.maximum})` };
    }
    return { valid: true };
  } else if (schema.type === 'boolean') {
    if (typeof data !== 'boolean') {
      return { valid: false, error: 'Expected boolean' };
    }
    return { valid: true };
  } else if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      return { valid: false, error: 'Expected array' };
    }
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        const result = validateInput(data[i], schema.items);
        if (!result.valid) return result;
      }
    }
    return { valid: true };
  }
  return { valid: true };
}

const rateLimitMap = new Map();
const requestLog = [];
const maxLogSize = 1000;

function createRateLimitMiddleware(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    const now = Date.now();

    if (!rateLimitMap.has(ip)) {
      rateLimitMap.set(ip, []);
    }

    const timestamps = rateLimitMap.get(ip);
    const recentRequests = timestamps.filter(t => now - t < windowMs);

    if (recentRequests.length >= maxRequests) {
      return res.status(429).json(createErrorResponse('RATE_LIMIT_EXCEEDED', `Too many requests. Limit: ${maxRequests} per ${windowMs}ms`, { retryAfter: windowMs / 1000 }));
    }

    recentRequests.push(now);
    rateLimitMap.set(ip, recentRequests);
    next();
  };
}

function createRequestLogger(slowThresholdMs = 1000) {
  return (req, res, next) => {
    const requestId = Math.random().toString(36).substring(7);
    const startTime = Date.now();

    req.requestId = requestId;
    const originalJson = res.json;
    res.json = function(data) {
      const duration = Date.now() - startTime;
      const isSlow = duration > slowThresholdMs;
      const bodySize = JSON.stringify(data).length;

      const logEntry = {
        requestId,
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        query: Object.keys(req.query).length > 0 ? req.query : undefined,
        status: res.statusCode,
        duration: `${duration}ms`,
        slow: isSlow,
        bodySize: `${bodySize}B`,
        ip: req.ip || 'unknown',
        userAgent: req.get('user-agent')?.substring(0, 100)
      };

      if (requestLog.length >= maxLogSize) {
        requestLog.shift();
      }
      requestLog.push(logEntry);

      const level = isSlow ? '⚠️ ' : res.statusCode >= 400 ? '❌' : '✓';
      if (process.env.DEBUG || isSlow || res.statusCode >= 400) {
        console.log(`${level} [${requestId}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
        if (isSlow) console.log(`   Slow request detected (threshold: ${slowThresholdMs}ms)`);
        if (res.statusCode >= 400) console.log(`   Error response: ${JSON.stringify(data).substring(0, 200)}`);
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

const wsConnectionMap = new Map();
const WS_MAX_CONNECTIONS_PER_IP = 10;
const WS_CONNECTION_CLEANUP_INTERVAL = 60000;

function createWebSocketRateLimiter() {
  setInterval(() => {
    const now = Date.now();
    wsConnectionMap.forEach((connections, ip) => {
      const validConnections = connections.filter(c => c.ws.readyState === 1);
      if (validConnections.length === 0) {
        wsConnectionMap.delete(ip);
      } else {
        wsConnectionMap.set(ip, validConnections);
      }
    });
  }, WS_CONNECTION_CLEANUP_INTERVAL);

  return {
    canConnect(ip) {
      if (!wsConnectionMap.has(ip)) {
        wsConnectionMap.set(ip, []);
        return true;
      }
      const connections = wsConnectionMap.get(ip);
      const validConnections = connections.filter(c => c.ws.readyState === 1);
      wsConnectionMap.set(ip, validConnections);
      return validConnections.length < WS_MAX_CONNECTIONS_PER_IP;
    },
    addConnection(ip, ws) {
      if (!wsConnectionMap.has(ip)) {
        wsConnectionMap.set(ip, []);
      }
      wsConnectionMap.get(ip).push({ ws, timestamp: Date.now() });
      ws.on('close', () => {
        const connections = wsConnectionMap.get(ip);
        if (connections) {
          const idx = connections.findIndex(c => c.ws === ws);
          if (idx !== -1) connections.splice(idx, 1);
          if (connections.length === 0) wsConnectionMap.delete(ip);
        }
      });
    }
  };
}

const wsRateLimiter = createWebSocketRateLimiter();

const operationLog = [];
const maxOperationLogSize = 500;

function logOperation(operation, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    operation,
    ...details
  };

  if (operationLog.length >= maxOperationLogSize) {
    operationLog.shift();
  }
  operationLog.push(entry);

  if (process.env.DEBUG) {
    console.log(`[${operation}] ${JSON.stringify(details).substring(0, 150)}`);
  }

  return entry;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function createValidationError(message, field = null) {
  const err = new Error(message);
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  err.field = field;
  return err;
}

function createNotFoundError(resource) {
  const err = new Error(`${resource} not found`);
  err.code = 'NOT_FOUND';
  err.status = 404;
  return err;
}

function createForbiddenError(message = 'Access denied') {
  const err = new Error(message);
  err.code = 'FORBIDDEN';
  err.status = 403;
  return err;
}

function createServerError(message, originalError = null) {
  const err = new Error(message);
  err.code = 'INTERNAL_ERROR';
  err.status = 500;
  err.originalError = originalError;
  return err;
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
    app.use(express.json());
    app.use('/api/', createRequestLogger());
    app.use('/api/', createRateLimitMiddleware(100, 60000));

    app.get('/api/logs', (req, res) => {
      const filter = req.query.filter;
      const limit = parseInt(req.query.limit) || 50;
      let logs = requestLog.slice(-limit);

      if (filter === 'slow') {
        logs = logs.filter(l => l.slow);
      } else if (filter === 'errors') {
        logs = logs.filter(l => l.status >= 400);
      }

      res.json({ logs, total: requestLog.length, limit: maxLogSize });
    });

    app.get('/api/operations-log', (req, res) => {
      const limit = parseInt(req.query.limit) || 50;
      const operation = req.query.operation;
      let logs = operationLog.slice(-limit);

      if (operation) {
        logs = logs.filter(l => l.operation === operation);
      }

      res.json({ logs, total: operationLog.length, limit: maxOperationLogSize });
    });

    app.get('/api/apps', (req, res) => {
      res.json(appRegistry.getManifests());
    });

    app.use('/apps/:appId', (req, res, next) => {
      const router = appRegistry.createAppRouter(req.params.appId);
      if (!router) {
        return res.status(404).send('App not found');
      }
      router(req, res, next);
    });

    app.get('/api/sequential-os/status', async (req, res) => {
      try {
        const status = await kit.status();
        res.json(status);
      } catch (error) {
        console.error('Status error:', error);
        res.status(500).json(createErrorResponse('SEQUENTIAL_OS_ERROR', error.message));
      }
    });

    app.post('/api/sequential-os/run', async (req, res) => {
      try {
        const { instruction } = req.body;
        if (!instruction) {
          return res.status(400).json(createErrorResponse('INVALID_INPUT', 'instruction is required'));
        }
        const result = await kit.run(instruction);
        res.json(result);
      } catch (error) {
        console.error('Run error:', error);
        res.status(500).json(createErrorResponse('SEQUENTIAL_OS_ERROR', error.message));
      }
    });

    app.post('/api/sequential-os/exec', async (req, res) => {
      try {
        const { instruction } = req.body;
        if (!instruction) {
          return res.status(400).json(createErrorResponse('INVALID_INPUT', 'instruction is required'));
        }
        const result = await kit.exec(instruction);
        res.json({ output: result, success: true });
      } catch (error) {
        console.error('Exec error:', error);
        res.status(500).json(createErrorResponse('SEQUENTIAL_OS_ERROR', error.message));
      }
    });

    app.get('/api/sequential-os/history', async (req, res) => {
      try {
        const history = await kit.history();
        res.json(history);
      } catch (error) {
        console.error('History error:', error);
        res.status(500).json(createErrorResponse('SEQUENTIAL_OS_ERROR', error.message));
      }
    });

    app.post('/api/sequential-os/checkout', async (req, res) => {
      try {
        const { ref } = req.body;
        if (!ref) {
          return res.status(400).json(createErrorResponse('INVALID_INPUT', 'ref is required'));
        }
        await kit.checkout(ref);
        res.json({ success: true, ref });
      } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json(createErrorResponse('SEQUENTIAL_OS_ERROR', error.message));
      }
    });

    app.get('/api/sequential-os/tags', async (req, res) => {
      try {
        const tags = kit.tags();
        res.json(tags);
      } catch (error) {
        console.error('Tags error:', error);
        res.status(500).json(createErrorResponse('SEQUENTIAL_OS_ERROR', error.message));
      }
    });

    app.post('/api/sequential-os/tag', async (req, res) => {
      try {
        const { name, ref } = req.body;
        if (!name) {
          return res.status(400).json(createErrorResponse('INVALID_INPUT', 'name is required'));
        }
        kit.tag(name, ref);
        res.json({ success: true, name, ref });
      } catch (error) {
        console.error('Tag error:', error);
        res.status(500).json(createErrorResponse('SEQUENTIAL_OS_ERROR', error.message));
      }
    });

    app.get('/api/sequential-os/inspect/:hash', async (req, res) => {
      try {
        const { hash } = req.params;
        const layerPath = path.join(STATEKIT_DIR, 'layers', hash);
        if (!fs.existsSync(layerPath)) {
          return res.status(404).json(createErrorResponse('LAYER_NOT_FOUND', 'Layer not found'));
        }
        const files = [];
        const getAllFiles = (dir, base = '') => {
          const items = fs.readdirSync(dir);
          items.forEach(item => {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              getAllFiles(fullPath, path.join(base, item));
            } else {
              files.push(path.join(base, item));
            }
          });
        };
        getAllFiles(layerPath);
        const stats = fs.statSync(layerPath);
        res.json({ hash, files, size: stats.size || 0 });
      } catch (error) {
        console.error('Inspect error:', error);
        res.status(500).json(createErrorResponse('SEQUENTIAL_OS_ERROR', error.message));
      }
    });

    app.post('/api/sequential-os/diff', async (req, res) => {
      try {
        const { file, hash1, hash2 } = req.body;
        if (!file || !hash1 || !hash2) {
          return res.status(400).json(createErrorResponse('INVALID_INPUT', 'file, hash1, and hash2 are required'));
        }
        const file1Path = path.join(STATEKIT_DIR, 'layers', hash1, file);
        const file2Path = path.join(STATEKIT_DIR, 'layers', hash2, file);
        const content1 = fs.existsSync(file1Path) ? fs.readFileSync(file1Path, 'utf8') : '';
        const content2 = fs.existsSync(file2Path) ? fs.readFileSync(file2Path, 'utf8') : '';
        res.json({ file, content1, content2 });
      } catch (error) {
        console.error('Diff error:', error);
        res.status(500).json(createErrorResponse('SEQUENTIAL_OS_ERROR', error.message));
      }
    });

    app.get('/api/files/current-path', (req, res) => {
      res.json({ path: process.cwd() });
    });

    app.get('/api/files/list', async (req, res) => {
      try {
        const dir = req.query.dir || process.cwd();
        const realPath = validateFilePath(dir);
        const files = await fs.readdir(realPath, { withFileTypes: true });
        const items = await Promise.all(files.map(async (file) => {
          const filePath = path.join(realPath, file.name);
          const stat = await fs.stat(filePath);
          return {
            name: file.name,
            type: file.isDirectory() ? 'dir' : 'file',
            size: stat.size,
            modified: stat.mtime,
            isDirectory: file.isDirectory()
          };
        }));
        res.json({ directory: realPath, files: items.sort((a, b) => a.name.localeCompare(b.name)) });
      } catch (error) {
        res.status(500).json(createErrorResponse('FILE_ERROR', error.message));
      }
    });

    app.get('/api/files/read', async (req, res) => {
      try {
        const filePath = req.query.path;
        const realPath = validateFilePath(filePath);
        const stat = await fs.stat(realPath);
        if (stat.isDirectory()) {
          return res.status(400).json(createErrorResponse('INVALID_OPERATION', 'Cannot read directory'));
        }
        if (stat.size > 10 * 1024 * 1024) {
          return res.status(400).json(createErrorResponse('FILE_TOO_LARGE', 'File too large (max 10MB)'));
        }
        const content = await fs.readFile(realPath, 'utf8');
        res.json({ path: realPath, size: stat.size, content, modified: stat.mtime });
      } catch (error) {
        res.status(500).json(createErrorResponse('FILE_ERROR', error.message));
      }
    });

    app.post('/api/files/write', async (req, res) => {
      try {
        const { path: filePath, content } = req.body;
        if (content === undefined) {
          return res.status(400).json(createErrorResponse('INVALID_INPUT', 'Content is required'));
        }
        const realPath = validateFilePath(filePath);
        await fs.ensureDir(path.dirname(realPath));
        const isNew = !fs.existsSync(realPath);
        await fs.writeFile(realPath, content, 'utf8');
        broadcastToFileSubscribers({ type: isNew ? 'file-created' : 'file-modified', path: filePath, timestamp: new Date().toISOString() });
        res.json({ path: realPath, size: content.length, success: true });
      } catch (error) {
        res.status(500).json(createErrorResponse('FILE_ERROR', error.message));
      }
    });

    app.post('/api/files/mkdir', async (req, res) => {
      try {
        const { path: dirPath } = req.body;
        const realPath = validateFilePath(dirPath);
        await fs.ensureDir(realPath);
        broadcastToFileSubscribers({ type: 'directory-created', path: dirPath, timestamp: new Date().toISOString() });
        res.json({ path: realPath, success: true });
      } catch (error) {
        res.status(500).json(createErrorResponse('FILE_ERROR', error.message));
      }
    });

    app.delete('/api/files', async (req, res) => {
      try {
        const filePath = req.query.path || req.body?.path;
        const realPath = validateFilePath(filePath);
        await fs.remove(realPath);
        broadcastToFileSubscribers({ type: 'file-deleted', path: filePath, timestamp: new Date().toISOString() });
        res.json({ path: realPath, success: true });
      } catch (error) {
        res.status(500).json(createErrorResponse('FILE_ERROR', error.message));
      }
    });

    app.post('/api/files/rename', async (req, res) => {
      try {
        const { path: filePath, newName } = req.body;
        if (!newName) return res.status(400).json(createErrorResponse('INVALID_INPUT', 'newName is required'));
        if (typeof newName !== 'string' || newName.includes('/') || newName.includes('\\') || newName.startsWith('.')) {
          return res.status(400).json(createErrorResponse('INVALID_INPUT', 'Invalid filename: contains invalid characters'));
        }
        const realPath = validateFilePath(filePath);
        const dir = path.dirname(realPath);
        const newPath = path.join(dir, newName);
        validateFilePath(newPath);
        await fs.rename(realPath, newPath);
        const newRelativePath = filePath.substring(0, filePath.lastIndexOf('/') + 1) + newName;
        broadcastToFileSubscribers({ type: 'file-renamed', oldPath: filePath, newPath: newRelativePath, timestamp: new Date().toISOString() });
        res.json({ oldPath: realPath, newPath: newPath, success: true });
      } catch (error) {
        res.status(500).json(createErrorResponse('FILE_ERROR', error.message));
      }
    });

    app.post('/api/files/copy', async (req, res) => {
      try {
        const { path: filePath, newPath: destPath } = req.body;
        if (!filePath) return res.status(400).json(createErrorResponse('INVALID_INPUT', 'path is required'));
        if (!destPath) return res.status(400).json(createErrorResponse('INVALID_INPUT', 'newPath is required'));
        const realPath = validateFilePath(filePath);
        const realDest = validateFilePath(destPath);
        await fs.ensureDir(path.dirname(realDest));
        await fs.copy(realPath, realDest);
        broadcastToFileSubscribers({ type: 'file-copied', sourcePath: filePath, destPath: destPath, timestamp: new Date().toISOString() });
        res.json({ sourcePath: realPath, destPath: realDest, success: true });
      } catch (error) {
        res.status(500).json(createErrorResponse('FILE_ERROR', error.message));
      }
    });

    app.get('/api/tasks', asyncHandler(async (req, res) => {
      const tasksDir = path.join(process.cwd(), 'tasks');
      if (!fs.existsSync(tasksDir)) {
        return res.json([]);
      }
      const tasks = fs.readdirSync(tasksDir)
        .filter(f => fs.statSync(path.join(tasksDir, f)).isDirectory())
        .map(name => {
          const configPath = path.join(tasksDir, name, 'config.json');
          let config = { name, id: name };
          if (fs.existsSync(configPath)) {
            try {
              config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
            } catch (parseErr) {
              if (process.env.DEBUG) {
                console.warn(`Failed to parse ${configPath}: ${parseErr.message}`);
              }
            }
          }
          return config;
        });
      res.json(tasks);
    }));

    app.post('/api/tasks/:taskName/run', asyncHandler(async (req, res) => {
      const { input } = req.body;
      const { taskName } = req.params;

      if (!taskName || typeof taskName !== 'string') {
        throw createValidationError('Task name must be a non-empty string', 'taskName');
      }

      const taskDir = path.join(process.cwd(), 'tasks', taskName);
      const realTaskDir = path.resolve(taskDir);
      if (!realTaskDir.startsWith(process.cwd())) {
        throw createForbiddenError(`Access to task '${taskName}' denied`);
      }

      const codePath = path.join(taskDir, 'code.js');
      if (!fs.existsSync(codePath)) {
        throw createNotFoundError(`Task '${taskName}'`);
      }

      const runId = Date.now().toString();
      const startTime = Date.now();
      activeTasks.set(runId, { taskName, startTime });
      logOperation('task-started', { runId, taskName, inputKeys: Object.keys(input || {}) });
      broadcastToRunSubscribers({ type: 'run-started', runId, taskName, timestamp: new Date().toISOString() });

      let output = null, status = 'success', error = null;
      try {
        const code = fs.readFileSync(codePath, 'utf8');
        output = await executeTaskWithTimeout(taskName, code, input, 30000);
      } catch (execError) {
        status = 'error';
        error = execError.message;
        output = { error: error, stack: execError.stack };
        logOperation('task-error', { runId, taskName, error: error.substring(0, 100) });
      }

      const duration = Date.now() - startTime;
      const result = { runId, status, input, output, error, duration, timestamp: new Date().toISOString() };
      const runsDir = path.join(taskDir, 'runs');
      await fs.ensureDir(runsDir);
      await fs.writeJSON(path.join(runsDir, `${runId}.json`), result);
      activeTasks.delete(runId);
      logOperation('task-completed', { runId, taskName, status, duration });
      broadcastToRunSubscribers({ type: 'run-completed', runId, taskName, status, duration, timestamp: result.timestamp });
      broadcastToTaskSubscribers(taskName, { type: 'run-completed', runId, status, duration });
      res.json(result);
    }));

    app.post('/api/tasks/:runId/cancel', async (req, res) => {
      try {
        const { runId } = req.params;
        if (!activeTasks.has(runId)) {
          return res.status(404).json(createErrorResponse('TASK_NOT_FOUND', 'Task not running or already completed'));
        }
        const task = activeTasks.get(runId);
        activeTasks.delete(runId);
        broadcastToRunSubscribers({ type: 'run-cancelled', runId, taskName: task.taskName, timestamp: new Date().toISOString() });
        res.json({ success: true, runId, cancelled: true, message: `Task ${runId} cancelled` });
      } catch (error) {
        res.status(500).json(createErrorResponse('TASK_ERROR', error.message));
      }
    });

    app.get('/api/tasks/:taskName/history', async (req, res) => {
      try {
        const runsDir = path.join(process.cwd(), 'tasks', req.params.taskName, 'runs');
        if (!fs.existsSync(runsDir)) {
          return res.json([]);
        }
        const runs = fs.readdirSync(runsDir)
          .filter(f => f.endsWith('.json'))
          .map(f => {
            try {
              return JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'));
            } catch (e) {
              return null;
            }
          })
          .filter(Boolean)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.json(runs);
      } catch (error) {
        res.status(500).json(createErrorResponse('TASK_ERROR', error.message));
      }
    });

    app.get('/api/tasks/:taskName/runs/:runId', async (req, res) => {
      try {
        const runPath = path.join(process.cwd(), 'tasks', req.params.taskName, 'runs', `${req.params.runId}.json`);
        if (!fs.existsSync(runPath)) {
          return res.status(404).json(createErrorResponse('RUN_NOT_FOUND', 'Run not found'));
        }
        const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
        res.json(run);
      } catch (error) {
        res.status(500).json(createErrorResponse('TASK_ERROR', error.message));
      }
    });

    app.get('/api/flows', async (req, res) => {
      try {
        const tasksDir = path.join(process.cwd(), 'tasks');
        if (!fs.existsSync(tasksDir)) {
          return res.json([]);
        }
        const flows = [];
        const tasks = fs.readdirSync(tasksDir)
          .filter(f => fs.statSync(path.join(tasksDir, f)).isDirectory());
        for (const name of tasks) {
          const graphPath = path.join(tasksDir, name, 'graph.json');
          if (fs.existsSync(graphPath)) {
            try {
              const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
              flows.push({ id: name, name, graph });
            } catch (e) {}
          }
        }
        res.json(flows);
      } catch (error) {
        res.status(500).json(createErrorResponse('FLOW_ERROR', error.message));
      }
    });

    app.get('/api/flows/:flowId', async (req, res) => {
      try {
        const graphPath = path.join(process.cwd(), 'tasks', req.params.flowId, 'graph.json');
        if (!fs.existsSync(graphPath)) {
          return res.status(404).json(createErrorResponse('FLOW_NOT_FOUND', 'Flow not found'));
        }
        const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
        res.json({ id: req.params.flowId, graph });
      } catch (error) {
        res.status(500).json(createErrorResponse('FLOW_ERROR', error.message));
      }
    });

    app.post('/api/flows', async (req, res) => {
      try {
        const { id, name, states } = req.body;
        if (!id || !name) {
          return res.status(400).json(createErrorResponse('INVALID_INPUT', 'id and name are required'));
        }
        const taskDir = path.join(process.cwd(), 'tasks', id);
        await fs.ensureDir(taskDir);
        const graph = {
          id: id,
          initial: states?.find(s => s.type === 'initial')?.id || states?.[0]?.id || 'start',
          states: (states || []).reduce((acc, state) => {
            acc[state.id] = {
              type: state.type === 'final' ? 'final' : undefined,
              onDone: state.onDone || undefined,
              onError: state.onError || undefined
            };
            Object.keys(acc[state.id]).forEach(key =>
              acc[state.id][key] === undefined && delete acc[state.id][key]
            );
            return acc;
          }, {})
        };
        await fs.writeJSON(path.join(taskDir, 'graph.json'), graph, { spaces: 2 });
        const configPath = path.join(taskDir, 'config.json');
        if (!fs.existsSync(configPath)) {
          await fs.writeJSON(configPath, {
            name: id,
            runner: 'flow',
            inputs: []
          }, { spaces: 2 });
        }
        res.json({ success: true, id, message: `Flow saved to ${taskDir}` });
      } catch (error) {
        res.status(500).json(createErrorResponse('FLOW_ERROR', error.message));
      }
    });

    app.post('/api/files/save', async (req, res) => {
      try {
        const { path: filePath, content } = req.body;
        if (!filePath || content === undefined) {
          return res.status(400).json(createErrorResponse('INVALID_INPUT', 'path and content are required'));
        }
        const fullPath = path.join(process.cwd(), filePath);
        const dir = path.dirname(fullPath);
        await fs.ensureDir(dir);
        await fs.writeFile(fullPath, content, 'utf8');
        res.json({ success: true, path: filePath, message: 'File saved successfully' });
      } catch (error) {
        res.status(500).json(createErrorResponse('FILE_ERROR', error.message));
      }
    });

    app.get('/api/tools', async (req, res) => {
      try {
        const toolsDir = path.join(process.cwd(), '.tools');
        if (!fs.existsSync(toolsDir)) {
          return res.json([]);
        }
        const tools = fs.readdirSync(toolsDir)
          .filter(f => f.endsWith('.json'))
          .map(f => {
            try {
              return JSON.parse(fs.readFileSync(path.join(toolsDir, f), 'utf8'));
            } catch (e) {
              return null;
            }
          })
          .filter(Boolean);
        res.json(tools);
      } catch (error) {
        res.status(500).json(createErrorResponse('TOOL_ERROR', error.message));
      }
    });

    app.post('/api/tools', async (req, res) => {
      try {
        const { name, definition } = req.body;
        if (!name) {
          return res.status(400).json(createErrorResponse('INVALID_INPUT', 'name is required'));
        }
        const toolsDir = path.join(process.cwd(), '.tools');
        await fs.ensureDir(toolsDir);
        const tool = { id: name, name, ...definition, timestamp: new Date().toISOString() };
        await fs.writeJSON(path.join(toolsDir, `${name}.json`), tool);
        res.json(tool);
      } catch (error) {
        res.status(500).json(createErrorResponse('TOOL_ERROR', error.message));
      }
    });

    app.put('/api/tools/:id', async (req, res) => {
      try {
        const { definition } = req.body;
        const toolsDir = path.join(process.cwd(), '.tools');
        const toolPath = path.join(toolsDir, `${req.params.id}.json`);
        if (!fs.existsSync(toolPath)) {
          return res.status(404).json(createErrorResponse('TOOL_NOT_FOUND', 'Tool not found'));
        }
        const tool = { id: req.params.id, ...definition, timestamp: new Date().toISOString() };
        await fs.writeJSON(toolPath, tool);
        res.json(tool);
      } catch (error) {
        res.status(500).json(createErrorResponse('TOOL_ERROR', error.message));
      }
    });

    app.delete('/api/tools/:id', async (req, res) => {
      try {
        const toolsDir = path.join(process.cwd(), '.tools');
        const toolPath = path.join(toolsDir, `${req.params.id}.json`);
        if (!fs.existsSync(toolPath)) {
          return res.status(404).json(createErrorResponse('TOOL_NOT_FOUND', 'Tool not found'));
        }
        await fs.remove(toolPath);
        res.json({ success: true, id: req.params.id });
      } catch (error) {
        res.status(500).json(createErrorResponse('TOOL_ERROR', error.message));
      }
    });

    app.get('/api/runs', async (req, res) => {
      try {
        const tasksDir = path.join(process.cwd(), 'tasks');
        if (!fs.existsSync(tasksDir)) {
          return res.json([]);
        }
        const allRuns = [];
        const tasks = fs.readdirSync(tasksDir)
          .filter(f => fs.statSync(path.join(tasksDir, f)).isDirectory());
        for (const taskName of tasks) {
          const runsDir = path.join(tasksDir, taskName, 'runs');
          if (fs.existsSync(runsDir)) {
            const runs = fs.readdirSync(runsDir)
              .filter(f => f.endsWith('.json'))
              .map(f => {
                try {
                  const run = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'));
                  return { ...run, taskName };
                } catch (e) {
                  return null;
                }
              })
              .filter(Boolean);
            allRuns.push(...runs);
          }
        }
        res.json(allRuns.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
      } catch (error) {
        res.status(500).json(createErrorResponse('TASK_ERROR', error.message));
      }
    });

    app.get('/api/metrics', async (req, res) => {
      try {
        const allRuns = [];
        const tasksDir = path.join(process.cwd(), 'tasks');
        if (fs.existsSync(tasksDir)) {
          const tasks = fs.readdirSync(tasksDir)
            .filter(f => fs.statSync(path.join(tasksDir, f)).isDirectory());
          for (const taskName of tasks) {
            const runsDir = path.join(tasksDir, taskName, 'runs');
            if (fs.existsSync(runsDir)) {
              const runs = fs.readdirSync(runsDir)
                .filter(f => f.endsWith('.json'))
                .map(f => {
                  try {
                    return JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'));
                  } catch (e) {
                    return null;
                  }
                })
                .filter(Boolean);
              allRuns.push(...runs);
            }
          }
        }
        const total = allRuns.length;
        const successful = allRuns.filter(r => r.status === 'success').length;
        const failed = allRuns.filter(r => r.status === 'error').length;
        const durations = allRuns.map(r => r.duration || 0).filter(d => d > 0);
        const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
        res.json({
          totalRuns: total,
          activeRuns: activeTasks.size,
          successfulRuns: successful,
          failedRuns: failed,
          successRate: total > 0 ? (successful / total * 100).toFixed(2) : 0,
          averageDuration: Math.round(avgDuration)
        });
      } catch (error) {
        res.status(500).json(createErrorResponse('METRICS_ERROR', error.message));
      }
    });

    const hotReloadClients = [];

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
    });

    function notifyReload(file) {
      console.log(`\n🔥 Hot reload: ${path.basename(file)}`);
      hotReloadClients.forEach(client => {
        client.write(`data: ${JSON.stringify({ type: 'reload', file })}\n\n`);
      });
    }

    const watchPaths = [
      path.join(__dirname, '../../desktop-shell/dist'),
      ...appRegistry.getManifests().map(app =>
        path.join(__dirname, `../../${app.id}/dist`)
      )
    ];

    watchPaths.forEach(watchPath => {
      if (fs.existsSync(watchPath)) {
        watch(watchPath, { recursive: true }, (eventType, filename) => {
          if (filename && (filename.endsWith('.html') || filename.endsWith('.js') || filename.endsWith('.css'))) {
            notifyReload(path.join(watchPath, filename));
          }
        });
        console.log(`  👁️  Watching: ${path.relative(path.join(__dirname, '../..'), watchPath)}`);
      }
    });

    app.use(express.static(path.join(__dirname, '../../desktop-shell/dist')));

    app.use(express.static(path.join(__dirname, '../../zellous')));

    app.use((err, req, res, next) => {
      const status = err.status || 500;
      const code = err.code || 'INTERNAL_ERROR';
      const message = err.message || 'Internal server error';
      const details = {};

      if (err.field) {
        details.field = err.field;
      }

      if (process.env.DEBUG && err.originalError) {
        details.originalError = err.originalError.message;
      }

      res.status(status).json(createErrorResponse(code, message, details));
    });

    const httpServer = http.createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
      const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for'] || '127.0.0.1';

      if (!wsRateLimiter.canConnect(clientIp)) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        socket.destroy();
        return;
      }

      if (req.url.startsWith('/api/runs/subscribe')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wsRateLimiter.addConnection(clientIp, ws);
          const subscriptionId = `run-${Date.now()}`;
          runSubscribers.set(subscriptionId, ws);
          ws.on('close', () => runSubscribers.delete(subscriptionId));
          ws.send(JSON.stringify({ type: 'connected', activeRuns: activeTasks.size }));
        });
      } else if (req.url.match(/^\/api\/tasks\/([^/]+)\/subscribe$/)) {
        const taskName = req.url.match(/^\/api\/tasks\/([^/]+)\/subscribe$/)[1];
        wss.handleUpgrade(req, socket, head, (ws) => {
          wsRateLimiter.addConnection(clientIp, ws);
          if (!taskSubscribers.has(taskName)) {
            taskSubscribers.set(taskName, new Set());
          }
          taskSubscribers.get(taskName).add(ws);
          ws.on('close', () => {
            taskSubscribers.get(taskName).delete(ws);
            if (taskSubscribers.get(taskName).size === 0) {
              taskSubscribers.delete(taskName);
            }
          });
          ws.send(JSON.stringify({ type: 'connected', taskName }));
        });
      } else if (req.url.startsWith('/api/files/subscribe')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wsRateLimiter.addConnection(clientIp, ws);
          fileSubscribers.add(ws);
          ws.on('close', () => fileSubscribers.delete(ws));
          ws.send(JSON.stringify({ type: 'connected', message: 'File subscription established' }));
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

    process.on('SIGINT', () => {
      console.log('\n\nShutting down...');
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
