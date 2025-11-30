import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { AppRegistry } from './app-registry.js';
import { createRequire } from 'module';
import { watch } from 'fs';

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

    const server = app.listen(PORT, () => {
      console.log('\n✓ Sequential Desktop Server initialized\n');
      console.log('Access points:');
      console.log(`  Desktop:        http://localhost:${PORT}`);
      console.log(`  Apps API:       http://localhost:${PORT}/api/apps`);
      console.log(`  Sequential-OS:  http://localhost:${PORT}/api/sequential-os/*`);
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
