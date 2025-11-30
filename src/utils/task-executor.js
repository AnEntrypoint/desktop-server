import { Worker } from 'worker_threads';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function executeTaskWithTimeout(taskName, code, input, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, '../../src/task-worker.js');
    let worker = null;
    let timeoutHandle = null;
    let completed = false;

    try {
      worker = new Worker(workerPath);

      const handleMessage = (message) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutHandle);
        worker.terminate();

        if (message.success) {
          resolve(message.result);
        } else {
          const error = new Error(message.error);
          error.stack = message.stack;
          reject(error);
        }
      };

      const handleError = (error) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutHandle);
        if (worker) worker.terminate();
        reject(new Error(`Worker error: ${error.message}`));
      };

      timeoutHandle = setTimeout(() => {
        if (completed) return;
        completed = true;
        if (worker) worker.terminate();
        reject(new Error(`Task execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      worker.on('message', handleMessage);
      worker.on('error', handleError);
      worker.on('exit', (code) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeoutHandle);
          reject(new Error(`Worker exited with code ${code}`));
        }
      });

      worker.postMessage({ taskCode: code, input: input || {}, taskName });
    } catch (error) {
      if (worker) worker.terminate();
      clearTimeout(timeoutHandle);
      reject(error);
    }
  });
}
