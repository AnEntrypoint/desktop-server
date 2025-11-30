import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Task Execution Safety', async (t) => {
  await t.test('should execute safe task code in Worker', async () => {
    const taskCode = `
      const result = {
        sum: 1 + 2,
        message: 'Hello'
      };
      return result;
    `;

    const result = await executeTaskWithTimeout(taskCode, {}, 5000);
    assert.deepEqual(result, { sum: 3, message: 'Hello' });
  });

  await t.test('should timeout long-running tasks', async () => {
    const taskCode = `
      while (true) {
        // Infinite loop
      }
    `;

    let timedOut = false;
    try {
      await executeTaskWithTimeout(taskCode, {}, 100);
    } catch (error) {
      timedOut = error.message.includes('timeout') || error.message.includes('killed');
    }
    assert.ok(timedOut, 'Task should timeout');
  });

  await t.test('should prevent Node API access', async () => {
    const taskCode = `
      const fs = require('fs');
      return fs.existsSync('/etc/passwd');
    `;

    let errored = false;
    try {
      await executeTaskWithTimeout(taskCode, {}, 1000);
    } catch (error) {
      errored = error.message.includes('require is not defined') || error.message.includes('not allowed');
    }
    assert.ok(errored, 'Should prevent require() access');
  });

  await t.test('should handle task errors gracefully', async () => {
    const taskCode = `
      throw new Error('Intentional error');
    `;

    let errored = false;
    let errorMessage = '';
    try {
      await executeTaskWithTimeout(taskCode, {}, 1000);
    } catch (error) {
      errored = true;
      errorMessage = error.message;
    }
    assert.ok(errored, 'Should catch task error');
    assert.match(errorMessage, /Intentional error/);
  });
});

async function executeTaskWithTimeout(code, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../src/task-worker.js'));

    const timeoutId = setTimeout(() => {
      worker.terminate();
      reject(new Error('Task execution timeout'));
    }, timeoutMs);

    worker.on('message', (message) => {
      clearTimeout(timeoutId);
      if (message.success) {
        resolve(message.result);
      } else {
        reject(new Error(message.error));
      }
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      clearTimeout(timeoutId);
      if (code !== 0 && code !== null) {
        reject(new Error(`Worker exited with code ${code}`));
      }
    });

    worker.postMessage({ taskCode: code, input, taskName: 'test-task' });
  });
}
