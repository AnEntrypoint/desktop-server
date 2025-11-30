import { parentPort } from 'worker_threads';

parentPort.on('message', async (message) => {
  const { taskCode, input, taskName } = message;

  try {
    const fn = new Function('input', `return (async (input) => { ${taskCode} })(input)`);
    const result = await fn(input || {});
    parentPort.postMessage({ success: true, result });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});
