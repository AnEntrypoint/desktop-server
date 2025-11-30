import path from 'path';
import fs from 'fs-extra';
import { createErrorResponse } from '../utils/error-factory.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { createCacheKey, getFromCache, setCache } from '../utils/cache.js';

export function registerRunsRoutes(app, getActiveTasks) {
  app.get('/api/runs', asyncHandler(async (req, res) => {
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
  }));

  app.get('/api/metrics', asyncHandler(async (req, res) => {
    const cacheKey = createCacheKey('metrics');
    const cached = getFromCache(cacheKey);
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }

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
    const activeTasks = getActiveTasks();
    const total = allRuns.length;
    const successful = allRuns.filter(r => r.status === 'success').length;
    const failed = allRuns.filter(r => r.status === 'error').length;
    const durations = allRuns.map(r => r.duration || 0).filter(d => d > 0);
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const metrics = {
      totalRuns: total,
      activeRuns: activeTasks.size,
      successfulRuns: successful,
      failedRuns: failed,
      successRate: total > 0 ? (successful / total * 100).toFixed(2) : 0,
      averageDuration: Math.round(avgDuration)
    };
    setCache(cacheKey, metrics);
    res.json(metrics);
  }));
}
