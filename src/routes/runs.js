import path from 'path';
import fs from 'fs-extra';
import { createError } from '@sequential/error-handling';
import { asyncHandler } from '../middleware/error-handler.js';
import { getCacheEntry, setCacheEntry } from '@sequential/server-utilities';

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
    const cancelled = allRuns.filter(r => r.status === 'cancelled').length;
    const completedRuns = successful + failed + cancelled;
    const durations = allRuns.map(r => r.duration || 0).filter(d => d > 0);
    const sortedDurations = durations.sort((a, b) => a - b);
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const medianDuration = sortedDurations.length > 0 ? sortedDurations[Math.floor(sortedDurations.length / 2)] : 0;
    const minDuration = sortedDurations.length > 0 ? sortedDurations[0] : 0;
    const maxDuration = sortedDurations.length > 0 ? sortedDurations[sortedDurations.length - 1] : 0;
    const metrics = {
      totalRuns: total,
      activeRuns: activeTasks.size,
      completedRuns,
      successfulRuns: successful,
      failedRuns: failed,
      cancelledRuns: cancelled,
      successRate: completedRuns > 0 ? (successful / completedRuns * 100).toFixed(2) : 0,
      failureRate: completedRuns > 0 ? (failed / completedRuns * 100).toFixed(2) : 0,
      cancellationRate: completedRuns > 0 ? (cancelled / completedRuns * 100).toFixed(2) : 0,
      duration: {
        average: Math.round(avgDuration),
        median: Math.round(medianDuration),
        min: Math.round(minDuration),
        max: Math.round(maxDuration)
      }
    };
    setCache(cacheKey, metrics);
    res.json(metrics);
  }));
}
