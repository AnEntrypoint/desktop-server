import fs from 'fs-extra';
import path from 'path';
import { asyncHandler } from '../middleware/error-handler.js';
import { broadcastBackgroundTaskEvent } from '@sequential/websocket-broadcaster';

const ERROR_LOG_DIR = path.join(process.cwd(), '.sequential-errors');

export function registerErrorLoggingRoutes(app) {
  fs.ensureDirSync(ERROR_LOG_DIR);

  app.post('/api/errors/log', asyncHandler(async (req, res) => {
    const error = req.body;
    const timestamp = new Date().toISOString().split('T')[0];
    const logFile = path.join(ERROR_LOG_DIR, `${timestamp}.jsonl`);

    const logEntry = {
      ...error,
      receivedAt: new Date().toISOString(),
      ip: req.ip,
      method: req.method,
      endpoint: req.originalUrl
    };

    try {
      await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
      console.error(`[Error Logged] ${error.app}: ${error.message}`);
      broadcastBackgroundTaskEvent({
        type: 'error:logged',
        data: logEntry,
        timestamp: new Date().toISOString()
      });
    } catch (writeErr) {
      console.error('Failed to write error log:', writeErr);
    }

    res.json({ success: true, errorId: error.id });
  }));

  app.get('/api/errors/logs', asyncHandler(async (req, res) => {
    try {
      const files = await fs.readdir(ERROR_LOG_DIR);
      const logs = {};

      for (const file of files.sort().reverse().slice(0, 7)) {
        const filePath = path.join(ERROR_LOG_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        logs[file] = content
          .split('\n')
          .filter(l => l)
          .map(l => JSON.parse(l))
          .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
      }

      res.json({ success: true, data: logs });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }));

  app.get('/api/errors/stats', asyncHandler(async (req, res) => {
    try {
      const files = await fs.readdir(ERROR_LOG_DIR);
      const stats = {
        totalFiles: files.length,
        errors: {},
        timeline: {}
      };

      for (const file of files) {
        const filePath = path.join(ERROR_LOG_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const entries = content.split('\n').filter(l => l).map(l => JSON.parse(l));

        entries.forEach(entry => {
          stats.errors[entry.app] = (stats.errors[entry.app] || 0) + 1;
          stats.timeline[file] = (stats.timeline[file] || 0) + 1;
        });
      }

      res.json({ success: true, data: stats });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }));

  app.delete('/api/errors/clear', asyncHandler(async (req, res) => {
    try {
      await fs.remove(ERROR_LOG_DIR);
      fs.ensureDirSync(ERROR_LOG_DIR);
      res.json({ success: true, message: 'Error logs cleared' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }));
}
