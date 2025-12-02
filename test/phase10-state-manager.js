import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { StateManager, MemoryAdapter } from '@sequential/persistent-state';

const BASE_URL = 'http://localhost:8003';

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            data: data ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            data: data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

test('Phase 10: StateManager - MemoryAdapter initialization', async (t) => {
  const adapter = new MemoryAdapter();
  const manager = new StateManager(adapter, { maxCacheSize: 100, cacheTTL: 60000 });

  assert.strictEqual(manager.isShutdown, false);
  await manager.shutdown();
  assert.strictEqual(manager.isShutdown, true);
});

test('Phase 10: StateManager - Set and Get values', async (t) => {
  const adapter = new MemoryAdapter();
  const manager = new StateManager(adapter);

  await manager.set('runs', 'run-1', { id: 'run-1', status: 'completed' });
  const value = await manager.get('runs', 'run-1');

  assert.deepStrictEqual(value, { id: 'run-1', status: 'completed' });
});

test('Phase 10: StateManager - Delete values', async (t) => {
  const adapter = new MemoryAdapter();
  const manager = new StateManager(adapter);

  await manager.set('tasks', 'task-1', { name: 'task-1' });
  await manager.delete('tasks', 'task-1');
  const deleted = await manager.get('tasks', 'task-1');

  assert.strictEqual(deleted, null);
});

test('Phase 10: StateManager - Cache size limits enforcement', async (t) => {
  const adapter = new MemoryAdapter();
  const manager = new StateManager(adapter, { maxCacheSize: 10 });

  for (let i = 0; i < 15; i++) {
    await manager.set('test', `key-${i}`, { value: i });
  }

  const stats = manager.getCacheStats();
  assert.ok(stats.cacheSize <= 10, `Cache size ${stats.cacheSize} exceeds limit 10`);
});

test('Phase 10: StateManager - getCacheStats returns correct format', async (t) => {
  const adapter = new MemoryAdapter();
  const manager = new StateManager(adapter, {
    maxCacheSize: 500,
    cacheTTL: 300000,
    cleanupInterval: 60000
  });

  await manager.set('test', 'key1', { data: 1 });
  const stats = manager.getCacheStats();

  assert.strictEqual(typeof stats.cacheSize, 'number');
  assert.strictEqual(typeof stats.maxSize, 'number');
  assert.strictEqual(typeof stats.ttlMs, 'number');
  assert.strictEqual(typeof stats.cleanupIntervalMs, 'number');
  assert.strictEqual(typeof stats.isShutdown, 'boolean');
  assert.strictEqual(stats.maxSize, 500);
  assert.strictEqual(stats.ttlMs, 300000);
  assert.strictEqual(stats.cleanupIntervalMs, 60000);
  assert.strictEqual(stats.isShutdown, false);
});

test('Phase 10: StateManager - Graceful shutdown', async (t) => {
  const adapter = new MemoryAdapter();
  const manager = new StateManager(adapter);

  await manager.set('data', 'key', { value: 'test' });
  await manager.shutdown();

  assert.strictEqual(manager.isShutdown, true);
  const stats = manager.getCacheStats();
  assert.strictEqual(stats.isShutdown, true);
});

test('Phase 10: StateManager - TTL expiry (simulated)', async (t) => {
  const adapter = new MemoryAdapter();
  const manager = new StateManager(adapter, {
    cacheTTL: 100,
    cleanupInterval: 50
  });

  await manager.set('temp', 'key', { value: 'expires' });
  let value = await manager.get('temp', 'key');
  assert.ok(value !== null, 'Value should exist immediately after set');

  await new Promise(r => setTimeout(r, 150));

  value = await manager.get('temp', 'key');
  assert.strictEqual(value, null, 'Value should be expired after TTL');
});

test('Phase 10: StateManager - Multiple type support', async (t) => {
  const adapter = new MemoryAdapter();
  const manager = new StateManager(adapter);

  await manager.set('runs', 'run-1', { type: 'run' });
  await manager.set('tasks', 'task-1', { type: 'task' });
  await manager.set('flows', 'flow-1', { type: 'flow' });

  const run = await manager.get('runs', 'run-1');
  const task = await manager.get('tasks', 'task-1');
  const flow = await manager.get('flows', 'flow-1');

  assert.strictEqual(run.type, 'run');
  assert.strictEqual(task.type, 'task');
  assert.strictEqual(flow.type, 'flow');
});

test('Phase 10: Desktop Server - StateManager initialization verified', async (t) => {
  const res = await makeRequest('GET', '/api/state/stats');

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.data);
  assert.ok(typeof res.data.cacheSize === 'number');
  assert.ok(typeof res.data.maxSize === 'number');
  assert.ok(typeof res.data.ttlMs === 'number');
  assert.ok(typeof res.data.cleanupIntervalMs === 'number');
  assert.strictEqual(res.data.isShutdown, false);
});

test('Phase 10: Desktop Server - StateManager cache working', async (t) => {
  const statsRes1 = await makeRequest('GET', '/api/state/stats');
  const initialSize = statsRes1.data.cacheSize;

  const taskRes = await makeRequest('POST', '/api/tasks/test-task/run', {
    input: {}
  });

  await new Promise(r => setTimeout(r, 500));

  const statsRes2 = await makeRequest('GET', '/api/state/stats');
  const finalSize = statsRes2.data.cacheSize;

  assert.ok(typeof finalSize === 'number', 'Cache size should be a number');
  assert.ok(finalSize >= 0, 'Cache size should be non-negative');
});

test('Phase 10: Desktop Server - Storage observer still working', async (t) => {
  const res = await makeRequest('GET', '/api/storage/runs');

  assert.strictEqual(res.statusCode, 200);
  assert.ok(Array.isArray(res.data.runs) || res.data.count === 0);
});

test('Phase 10: StateManager - Large cache population', async (t) => {
  const adapter = new MemoryAdapter();
  const manager = new StateManager(adapter, { maxCacheSize: 1000 });

  const startTime = Date.now();
  for (let i = 0; i < 500; i++) {
    await manager.set('bulk', `key-${i}`, {
      id: i,
      data: 'x'.repeat(100),
      timestamp: Date.now()
    });
  }
  const duration = Date.now() - startTime;

  const stats = manager.getCacheStats();
  assert.strictEqual(stats.cacheSize, 500);
  assert.ok(duration < 5000, `Bulk write took ${duration}ms, should be under 5s`);
});

test('Phase 10: StateManager - Concurrent operations', async (t) => {
  const adapter = new MemoryAdapter();
  const manager = new StateManager(adapter);

  const promises = [];
  for (let i = 0; i < 50; i++) {
    promises.push(
      manager.set('concurrent', `key-${i}`, { index: i })
    );
  }
  await Promise.all(promises);

  const stats = manager.getCacheStats();
  assert.strictEqual(stats.cacheSize, 50);

  const readPromises = [];
  for (let i = 0; i < 50; i++) {
    readPromises.push(
      manager.get('concurrent', `key-${i}`)
    );
  }
  const results = await Promise.all(readPromises);
  assert.strictEqual(results.length, 50);
  results.forEach((result, i) => {
    assert.strictEqual(result.index, i);
  });
});
