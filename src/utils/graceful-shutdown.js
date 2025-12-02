export function setupGracefulShutdown(httpServer, wss, fileWatchers, stateManager) {
  const gracefulShutdown = (signal) => {
    console.log(`\n\n[${signal}] Shutting down gracefully...`);

    const shutdownTimeout = setTimeout(() => {
      console.error('[TIMEOUT] Forced shutdown after 10 seconds');
      process.exit(1);
    }, 10000);

    fileWatchers.forEach(watcher => {
      try {
        watcher.close();
      } catch (e) {
        console.error('Error closing file watcher:', e.message);
      }
    });

    httpServer.close(async () => {
      try {
        if (stateManager) {
          await stateManager.shutdown();
          console.log('✓ StateManager shutdown complete');
        }
      } catch (e) {
        console.error('Error shutting down StateManager:', e.message);
      }

      clearTimeout(shutdownTimeout);
      console.log('✓ HTTP server closed');
      process.exit(0);
    });

    wss.clients.forEach((ws) => {
      if (ws.readyState === 1) {
        try {
          ws.close(1001, 'Server shutting down');
        } catch (e) {
          console.error('Error closing WebSocket:', e.message);
        }
      }
    });
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}
