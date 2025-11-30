import { parentPort } from 'worker_threads';

parentPort.on('message', async (message) => {
  const { taskCode, input, taskName } = message;

  try {
    const myTask = async (inputData) => {
      return await eval(`(async (input) => { ${taskCode} })`)(inputData);
    };

    const result = await myTask(input || {});
    parentPort.postMessage({ success: true, result });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});
