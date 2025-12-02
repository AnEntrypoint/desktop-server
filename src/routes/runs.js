import path from 'path';
import fs from 'fs-extra';
import { createError } from '@sequential/error-handling';
import { asyncHandler } from '../middleware/error-handler.js';
import { createCacheKey, getFromCache, setCache } from '@sequential/server-utilities';

async function getAllRuns(includeTaskName = true) {
  const tasksDir = path.join(process.cwd(), 'tasks');
  if (!await fs.pathExists(tasksDir)) {
    return [];
  }
  const allRuns = [];
  const entries = await fs.readdir(tasksDir, { withFileTypes: true });
  const tasks = entries.filter(e => e.isDirectory()).map(e => e.name);
  for (const taskName of tasks) {
    const runsDir = path.join(tasksDir, taskName, 'runs');
    if (await fs.pathExists(runsDir)) {
      const files = await fs.readdir(runsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await fs.readJson(path.join(runsDir, file));
            if (content) {
              const run = includeTaskName ? { ...content, taskName } : content;
              allRuns.push(run);
            }
          } catch (e) {
            // Skip files that can't be parsed
          }
        }
      }
    }
  }
  return allRuns;
}

export function registerRunsRoutes(app, getActiveTasks) {
  app.get('/api/runs', asyncHandler(async (req, res) => {
    const allRuns = await getAllRuns(true);
    res.json(allRuns.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
  }));

  app.get('/api/metrics', asyncHandler(async (req, res) => {
    const cacheKey = createCacheKey('metrics');
    const cached = getFromCache(cacheKey);
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }

    const allRuns = await getAllRuns(false);
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
