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
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/sequential-os/run', async (req, res) => {
      try {
        const { instruction } = req.body;
        if (!instruction) {
          return res.status(400).json({ error: 'instruction required' });
        }
        const result = await kit.run(instruction);
        res.json(result);
      } catch (error) {
        console.error('Run error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/sequential-os/exec', async (req, res) => {
      try {
        const { instruction } = req.body;
        if (!instruction) {
          return res.status(400).json({ error: 'instruction required' });
        }
        const result = await kit.exec(instruction);
        res.json({ output: result, success: true });
      } catch (error) {
        console.error('Exec error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/sequential-os/history', async (req, res) => {
      try {
        const history = await kit.history();
        res.json(history);
      } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/sequential-os/checkout', async (req, res) => {
      try {
        const { ref } = req.body;
        if (!ref) {
          return res.status(400).json({ error: 'ref required' });
        }
        await kit.checkout(ref);
        res.json({ success: true, ref });
      } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/sequential-os/tags', async (req, res) => {
      try {
        const tags = kit.tags();
        res.json(tags);
      } catch (error) {
        console.error('Tags error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/sequential-os/tag', async (req, res) => {
      try {
        const { name, ref } = req.body;
        if (!name) {
          return res.status(400).json({ error: 'name required' });
        }
        kit.tag(name, ref);
        res.json({ success: true, name, ref });
      } catch (error) {
        console.error('Tag error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/sequential-os/inspect/:hash', async (req, res) => {
      try {
        const { hash } = req.params;
        const layerPath = path.join(STATEKIT_DIR, 'layers', hash);
        if (!fs.existsSync(layerPath)) {
          return res.status(404).json({ error: 'Layer not found' });
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
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/sequential-os/diff', async (req, res) => {
      try {
        const { file, hash1, hash2 } = req.body;
        if (!file || !hash1 || !hash2) {
          return res.status(400).json({ error: 'file, hash1, and hash2 required' });
        }
        const file1Path = path.join(STATEKIT_DIR, 'layers', hash1, file);
        const file2Path = path.join(STATEKIT_DIR, 'layers', hash2, file);
        const content1 = fs.existsSync(file1Path) ? fs.readFileSync(file1Path, 'utf8') : '';
        const content2 = fs.existsSync(file2Path) ? fs.readFileSync(file2Path, 'utf8') : '';
        res.json({ file, content1, content2 });
      } catch (error) {
        console.error('Diff error:', error);
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/files/list', async (req, res) => {
      try {
        const dir = req.query.dir || process.cwd();
        const realPath = path.resolve(dir);
        if (!realPath.startsWith(process.cwd())) {
          return res.status(403).json({ error: 'Access denied' });
        }
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
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/files/read', async (req, res) => {
      try {
        const filePath = req.query.path;
        if (!filePath) return res.status(400).json({ error: 'path required' });
        const realPath = path.resolve(filePath);
        if (!realPath.startsWith(process.cwd())) {
          return res.status(403).json({ error: 'Access denied' });
        }
        const stat = await fs.stat(realPath);
        if (stat.isDirectory()) {
          return res.status(400).json({ error: 'Cannot read directory' });
        }
        if (stat.size > 10 * 1024 * 1024) {
          return res.status(400).json({ error: 'File too large (max 10MB)' });
        }
        const content = await fs.readFile(realPath, 'utf8');
        res.json({ path: realPath, size: stat.size, content, modified: stat.mtime });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/files/write', async (req, res) => {
      try {
        const { path: filePath, content } = req.body;
        if (!filePath || content === undefined) {
          return res.status(400).json({ error: 'path and content required' });
        }
        const realPath = path.resolve(filePath);
        if (!realPath.startsWith(process.cwd())) {
          return res.status(403).json({ error: 'Access denied' });
        }
        await fs.ensureDir(path.dirname(realPath));
        await fs.writeFile(realPath, content, 'utf8');
        res.json({ path: realPath, size: content.length, success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/files/mkdir', async (req, res) => {
      try {
        const { path: dirPath } = req.body;
        if (!dirPath) return res.status(400).json({ error: 'path required' });
        const realPath = path.resolve(dirPath);
        if (!realPath.startsWith(process.cwd())) {
          return res.status(403).json({ error: 'Access denied' });
        }
        await fs.ensureDir(realPath);
        res.json({ path: realPath, success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.delete('/api/files', async (req, res) => {
      try {
        const filePath = req.query.path;
        if (!filePath) return res.status(400).json({ error: 'path required' });
        const realPath = path.resolve(filePath);
        if (!realPath.startsWith(process.cwd())) {
          return res.status(403).json({ error: 'Access denied' });
        }
        await fs.remove(realPath);
        res.json({ path: realPath, success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/tasks', async (req, res) => {
      try {
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
              } catch (e) {}
            }
            return config;
          });
        res.json(tasks);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/tasks/:taskName/run', async (req, res) => {
      try {
        const { input } = req.body;
        const taskName = req.params.taskName;
        const taskDir = path.join(process.cwd(), 'tasks', taskName);
        const codePath = path.join(taskDir, 'code.js');
        if (!fs.existsSync(codePath)) {
          return res.status(404).json({ error: 'Task not found' });
        }
        const runId = Date.now().toString();
        const startTime = Date.now();
        activeTasks.set(runId, { taskName, startTime });
        broadcastToRunSubscribers({ type: 'run-started', runId, taskName, timestamp: new Date().toISOString() });
        let output = null, status = 'success', error = null;
        try {
          const code = fs.readFileSync(codePath, 'utf8');
          const fn = new Function('fetch', 'input', `${code}; return myTask(input);`);
          output = await fn(fetch, input || {});
        } catch (execError) {
          status = 'error';
          error = execError.message;
          output = { error: error, stack: execError.stack };
        }
        const duration = Date.now() - startTime;
        const result = { runId, status, input, output, error, duration, timestamp: new Date().toISOString() };
        const runsDir = path.join(taskDir, 'runs');
        await fs.ensureDir(runsDir);
        await fs.writeJSON(path.join(runsDir, `${runId}.json`), result);
        activeTasks.delete(runId);
        broadcastToRunSubscribers({ type: 'run-completed', runId, taskName, status, duration, timestamp: result.timestamp });
        broadcastToTaskSubscribers(taskName, { type: 'run-completed', runId, status, duration });
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/tasks/:taskName/runs/:runId', async (req, res) => {
      try {
        const runPath = path.join(process.cwd(), 'tasks', req.params.taskName, 'runs', `${req.params.runId}.json`);
        if (!fs.existsSync(runPath)) {
          return res.status(404).json({ error: 'Run not found' });
        }
        const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
        res.json(run);
      } catch (error) {
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/flows/:flowId', async (req, res) => {
      try {
        const graphPath = path.join(process.cwd(), 'tasks', req.params.flowId, 'graph.json');
        if (!fs.existsSync(graphPath)) {
          return res.status(404).json({ error: 'Flow not found' });
        }
        const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
        res.json({ id: req.params.flowId, graph });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/flows', async (req, res) => {
      try {
        const { id, name, states } = req.body;
        if (!id || !name) {
          return res.status(400).json({ error: 'id and name required' });
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
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/files/save', async (req, res) => {
      try {
        const { path: filePath, content } = req.body;
        if (!filePath || content === undefined) {
          return res.status(400).json({ error: 'path and content required' });
        }
        const fullPath = path.join(process.cwd(), filePath);
        const dir = path.dirname(fullPath);
        await fs.ensureDir(dir);
        await fs.writeFile(fullPath, content, 'utf8');
        res.json({ success: true, path: filePath, message: 'File saved successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/tools', async (req, res) => {
      try {
        const { name, definition } = req.body;
        if (!name) {
          return res.status(400).json({ error: 'name required' });
        }
        const toolsDir = path.join(process.cwd(), '.tools');
        await fs.ensureDir(toolsDir);
        const tool = { id: name, name, ...definition, timestamp: new Date().toISOString() };
        await fs.writeJSON(path.join(toolsDir, `${name}.json`), tool);
        res.json(tool);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.put('/api/tools/:id', async (req, res) => {
      try {
        const { definition } = req.body;
        const toolsDir = path.join(process.cwd(), '.tools');
        const toolPath = path.join(toolsDir, `${req.params.id}.json`);
        if (!fs.existsSync(toolPath)) {
          return res.status(404).json({ error: 'Tool not found' });
        }
        const tool = { id: req.params.id, ...definition, timestamp: new Date().toISOString() };
        await fs.writeJSON(toolPath, tool);
        res.json(tool);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.delete('/api/tools/:id', async (req, res) => {
      try {
        const toolsDir = path.join(process.cwd(), '.tools');
        const toolPath = path.join(toolsDir, `${req.params.id}.json`);
        if (!fs.existsSync(toolPath)) {
          return res.status(404).json({ error: 'Tool not found' });
        }
        await fs.remove(toolPath);
        res.json({ success: true, id: req.params.id });
      } catch (error) {
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/metrics', async (req, res) => {
      try {
        const runs = await (new Promise((resolve, reject) => {
          const next = () => {};
          req.url = '/api/runs';
          app._router.handle(req, res);
        }));
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
        res.status(500).json({ error: error.message });
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

    const httpServer = http.createServer(app);
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
      if (req.url.startsWith('/api/runs/subscribe')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          const subscriptionId = `run-${Date.now()}`;
          runSubscribers.set(subscriptionId, ws);
          ws.on('close', () => runSubscribers.delete(subscriptionId));
          ws.send(JSON.stringify({ type: 'connected', activeRuns: activeTasks.size }));
        });
      } else if (req.url.match(/^\/api\/tasks\/([^/]+)\/subscribe$/)) {
        const taskName = req.url.match(/^\/api\/tasks\/([^/]+)\/subscribe$/)[1];
        wss.handleUpgrade(req, socket, head, (ws) => {
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
