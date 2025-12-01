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
    let cleanedUp = false;
    let completed = false;

    try {
      worker = new Worker(workerPath);

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;

        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }

        if (worker !== null) {
          worker.removeListener('message', handleMessage);
          worker.removeListener('error', handleError);
          worker.removeListener('exit', handleExit);
          try {
            worker.terminate();
          } catch (e) {
            console.error('Failed to terminate worker:', e.message);
          }
          worker = null;
        }
      };

      const handleMessage = (message) => {
        if (completed || cleanedUp) return;
        completed = true;
        cleanup();

        if (message.success) {
          resolve(message.result);
        } else {
          const error = new Error(message.error);
          error.stack = message.stack;
          reject(error);
        }
      };

      const handleError = (error) => {
        if (completed || cleanedUp) return;
        completed = true;
        cleanup();
        reject(new Error(`Worker error: ${error.message}`));
      };

      const handleExit = (code) => {
        if (completed || cleanedUp) return;
        completed = true;
        cleanup();
        reject(new Error(`Worker exited with code ${code}`));
      };

      timeoutHandle = setTimeout(() => {
        if (completed || cleanedUp) return;
        completed = true;
        cleanup();
        reject(new Error(`Task execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      worker.on('message', handleMessage);
      worker.on('error', handleError);
      worker.on('exit', handleExit);

      worker.postMessage({ taskCode: code, input: input || {}, taskName });
    } catch (error) {
      if (worker !== null) {
        try {
          worker.terminate();
        } catch (e) {}
        worker = null;
      }
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      reject(error);
    }
  });
}
