import fs from 'fs-extra';
import path from 'path';
import { asyncHandler } from '../middleware/error-handler.js';
import { nowISO, createTimestamps, updateTimestamp } from '@sequentialos/timestamp-utilities';

const ERROR_LOG_DIR = path.join(process.cwd(), '.sequential-errors');

export function registerHealthRoutes(app) {
  app.get('/api/health', asyncHandler(async (req, res) => {
    const health = {
      status: 'ok',
      timestamp: nowISO(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid,
      node: process.version
    };

    try {
      if (fs.existsSync(ERROR_LOG_DIR)) {
        const files = await fs.readdir(ERROR_LOG_DIR);
        const errorCount = files.reduce((sum, file) => {
          const content = fs.readFileSync(path.join(ERROR_LOG_DIR, file), 'utf-8');
          return sum + content.split('\n').filter(l => l).length;
        }, 0);
        health.errors = { totalCount: errorCount, logFiles: files.length };
      }
    } catch (err) {
      health.errors = { error: err.message };
    }

    res.json(health);
  }));

  app.get('/api/health/detailed', asyncHandler(async (req, res) => {
    const health = {
      status: 'ok',
      timestamp: nowISO(),
      services: {},
      metrics: {}
    };

    try {
      health.services.filesystem = { status: 'ok', path: process.cwd() };
    } catch (err) {
      health.services.filesystem = { status: 'error', error: err.message };
    }

    try {
      health.services.errors = { status: 'ok', dir: ERROR_LOG_DIR };
      if (fs.existsSync(ERROR_LOG_DIR)) {
        const files = await fs.readdir(ERROR_LOG_DIR);
        health.services.errors.files = files.length;
      }
    } catch (err) {
      health.services.errors = { status: 'error', error: err.message };
    }

    health.metrics.memory = {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      external: Math.round(process.memoryUsage().external / 1024 / 1024)
    };

    health.metrics.uptime = {
      seconds: Math.round(process.uptime()),
      formatted: formatUptime(process.uptime())
    };

    res.json(health);
  }));
}

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}
