import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { nowISO, createTimestamps, updateTimestamp } from '@sequential/timestamp-utilities';

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

test('Phase 9: Scheduler Routes - POST /api/scheduler/schedule (once)', async (t) => {
  const futureTime = Date.now() + 60000;
  const res = await makeRequest('POST', '/api/scheduler/schedule', {
    taskName: 'testTask',
    type: 'once',
    executeAt: futureTime,
    args: ['arg1']
  });

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.data.success, true);
  assert.ok(res.data.schedule.id);
  assert.strictEqual(res.data.schedule.taskName, 'testTask');
  assert.strictEqual(res.data.schedule.status, 'scheduled');
});

test('Phase 9: Scheduler Routes - POST /api/scheduler/schedule (recurring)', async (t) => {
  const res = await makeRequest('POST', '/api/scheduler/schedule', {
    taskName: 'dailyTask',
    type: 'recurring',
    cronExpression: '0 9 * * *',
    args: []
  });

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.data.success, true);
  assert.strictEqual(res.data.schedule.type, 'recurring');
});

test('Phase 9: Scheduler Routes - POST /api/scheduler/schedule (interval)', async (t) => {
  const res = await makeRequest('POST', '/api/scheduler/schedule', {
    taskName: 'repeatTask',
    type: 'interval',
    intervalMs: 30000,
    args: []
  });

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.data.success, true);
  assert.strictEqual(res.data.schedule.type, 'interval');
});

test('Phase 9: Scheduler Routes - POST Missing taskName', async (t) => {
  const res = await makeRequest('POST', '/api/scheduler/schedule', {
    type: 'once',
    executeAt: Date.now() + 60000
  });

  assert.strictEqual(res.statusCode, 400);
  assert.ok(res.data.error);
});

test('Phase 9: Scheduler Routes - POST Invalid Type', async (t) => {
  const res = await makeRequest('POST', '/api/scheduler/schedule', {
    taskName: 'task',
    type: 'invalid',
    args: []
  });

  assert.strictEqual(res.statusCode, 400);
});

test('Phase 9: Scheduler Routes - GET /api/scheduler/scheduled', async (t) => {
  const res = await makeRequest('GET', '/api/scheduler/scheduled');

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.data.success, true);
  assert.ok(Array.isArray(res.data.schedules));
  assert.ok(typeof res.data.count === 'number');
});

test('Phase 9: Scheduler Routes - GET /api/scheduler/stats', async (t) => {
  const res = await makeRequest('GET', '/api/scheduler/stats');

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.data.success, true);
  assert.ok(res.data.stats);
  assert.ok(typeof res.data.stats.total === 'number');
  assert.ok(typeof res.data.stats.executed === 'number');
  assert.ok(typeof res.data.stats.failed === 'number');
});

test('Phase 9: Scheduler Routes - GET /api/scheduler/:id Not Found', async (t) => {
  const res = await makeRequest('GET', '/api/scheduler/nonexistent');

  assert.strictEqual(res.statusCode, 404);
  assert.ok(res.data.error);
});

test('Phase 9: Scheduler Routes - POST Create then GET', async (t) => {
  const futureTime = Date.now() + 60000;
  const createRes = await makeRequest('POST', '/api/scheduler/schedule', {
    taskName: 'getTestTask',
    type: 'once',
    executeAt: futureTime,
    args: ['test']
  });

  assert.strictEqual(createRes.statusCode, 201);
  const scheduleId = createRes.data.schedule.id;

  const getRes = await makeRequest('GET', `/api/scheduler/${scheduleId}`);

  assert.strictEqual(getRes.statusCode, 200);
  assert.strictEqual(getRes.data.success, true);
  assert.strictEqual(getRes.data.schedule.id, scheduleId);
  assert.strictEqual(getRes.data.schedule.taskName, 'getTestTask');
});

test('Phase 9: Scheduler Routes - POST Create then DELETE', async (t) => {
  const futureTime = Date.now() + 60000;
  const createRes = await makeRequest('POST', '/api/scheduler/schedule', {
    taskName: 'deleteTestTask',
    type: 'once',
    executeAt: futureTime
  });

  const scheduleId = createRes.data.schedule.id;

  const deleteRes = await makeRequest('DELETE', `/api/scheduler/${scheduleId}`);

  assert.strictEqual(deleteRes.statusCode, 200);
  assert.strictEqual(deleteRes.data.success, true);
  assert.strictEqual(deleteRes.data.message, 'Schedule cancelled');
});

test('Phase 9: Scheduler Routes - POST Create then PUT Update', async (t) => {
  const futureTime = Date.now() + 60000;
  const createRes = await makeRequest('POST', '/api/scheduler/schedule', {
    taskName: 'updateTask',
    type: 'once',
    executeAt: futureTime,
    args: ['arg1']
  });

  const scheduleId = createRes.data.schedule.id;

  const updateRes = await makeRequest('PUT', `/api/scheduler/${scheduleId}`, {
    args: ['arg2', 'arg3']
  });

  assert.strictEqual(updateRes.statusCode, 200);
  assert.strictEqual(updateRes.data.success, true);
  assert.deepEqual(updateRes.data.schedule.args, ['arg2', 'arg3']);
});

test('Phase 9: Scheduler Routes - GET /api/scheduler/:id/history', async (t) => {
  const futureTime = Date.now() + 60000;
  const createRes = await makeRequest('POST', '/api/scheduler/schedule', {
    taskName: 'historyTask',
    type: 'once',
    executeAt: futureTime
  });

  const scheduleId = createRes.data.schedule.id;

  const historyRes = await makeRequest('GET', `/api/scheduler/${scheduleId}/history?limit=50`);

  assert.strictEqual(historyRes.statusCode, 200);
  assert.strictEqual(historyRes.data.success, true);
  assert.ok(Array.isArray(historyRes.data.history));
});
