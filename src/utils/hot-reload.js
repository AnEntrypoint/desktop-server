import path from 'path';
import fs from 'fs-extra';
import { watch } from 'fs';

export function setupHotReload(app, appRegistry, __dirname) {
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

  return { fileWatchers, hotReloadClients };
}

export function closeFileWatchers(fileWatchers) {
  fileWatchers.forEach(watcher => {
    try {
      watcher.close();
    } catch (e) {
      console.error('Error closing file watcher:', e.message);
    }
  });
}
