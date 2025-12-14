import { backgroundTaskManager } from '@sequentialos/server-utilities';
import logger from '@sequentialos/sequential-logging';
import { delay, withRetry } from '@sequentialos/async-patterns';

export function setupGracefulShutdown(httpServer, wss, fileWatchers, stateManager, queueWorkerPool, taskScheduler) {
  const gracefulShutdown = (signal) => {
    logger.info(`\n\n[${signal}] Shutting down gracefully...`);

    const shutdownTimeout = setTimeout(() => {
      logger.error('[TIMEOUT] Forced shutdown after 10 seconds');
      process.exit(1);
    }, 10000);

    fileWatchers.forEach(watcher => {
      try {
        watcher.close();
      } catch (e) {
        logger.error('Error closing file watcher:', e);
      }
    });

    try {
      backgroundTaskManager.cleanup();
      logger.info('✓ Background tasks cleaned up');
    } catch (e) {
      logger.error('Error cleaning up background tasks:', e);
    }

    (async () => {
      try {
        if (taskScheduler) {
          await taskScheduler.stop();
          logger.info('✓ Task scheduler stopped');
        }
      } catch (e) {
        logger.error('Error stopping scheduler:', e);
      }

      try {
        if (queueWorkerPool) {
          await queueWorkerPool.stop();
          logger.info('✓ Queue worker pool stopped');
        }
      } catch (e) {
        logger.error('Error stopping worker pool:', e);
      }

      httpServer.close(async () => {
        try {
          if (stateManager) {
            await stateManager.shutdown();
            logger.info('✓ StateManager shutdown complete');
          }
        } catch (e) {
          logger.error('Error shutting down StateManager:', e);
        }

        clearTimeout(shutdownTimeout);
        logger.info('✓ HTTP server closed');
        process.exit(0);
      });
    })();

    wss.clients.forEach((ws) => {
      if (ws.readyState === 1) {
        try {
          ws.close(1001, 'Server shutting down');
        } catch (e) {
          logger.error('Error closing WebSocket:', e);
        }
      }
    });
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}
