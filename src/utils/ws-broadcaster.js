const runSubscribers = new Map();
const taskSubscribers = new Map();
const fileSubscribers = new Set();

export function broadcastToRunSubscribers(message) {
  const data = JSON.stringify(message);
  runSubscribers.forEach((ws) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(data);
    }
  });
}

export function broadcastToTaskSubscribers(taskName, message) {
  if (!taskSubscribers.has(taskName)) return;
  const data = JSON.stringify(message);
  taskSubscribers.get(taskName).forEach((ws) => {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  });
}

export function broadcastToFileSubscribers(message) {
  const data = JSON.stringify(message);
  fileSubscribers.forEach((ws) => {
    if (ws.readyState === 1) {
      ws.send(data);
    }
  });
}

export function addRunSubscriber(subscriptionId, ws) {
  runSubscribers.set(subscriptionId, ws);
}

export function removeRunSubscriber(subscriptionId) {
  runSubscribers.delete(subscriptionId);
}

export function addTaskSubscriber(taskName, ws) {
  if (!taskSubscribers.has(taskName)) {
    taskSubscribers.set(taskName, new Set());
  }
  taskSubscribers.get(taskName).add(ws);
}

export function removeTaskSubscriber(taskName, ws) {
  if (!taskSubscribers.has(taskName)) return;
  taskSubscribers.get(taskName).delete(ws);
  if (taskSubscribers.get(taskName).size === 0) {
    taskSubscribers.delete(taskName);
  }
}

export function addFileSubscriber(ws) {
  fileSubscribers.add(ws);
}

export function removeFileSubscriber(ws) {
  fileSubscribers.delete(ws);
}

export function broadcastTaskProgress(taskName, runId, progress) {
  broadcastToTaskSubscribers(taskName, {
    type: 'progress',
    runId,
    taskName,
    progress: {
      stage: progress.stage || 'executing',
      percentage: progress.percentage || 0,
      details: progress.details || '',
      timestamp: new Date().toISOString()
    }
  });

  broadcastToRunSubscribers({
    type: 'progress',
    runId,
    taskName,
    progress: {
      stage: progress.stage || 'executing',
      percentage: progress.percentage || 0,
      details: progress.details || '',
      timestamp: new Date().toISOString()
    }
  });
}

export function broadcastRunProgress(runId, taskName, progress) {
  broadcastToRunSubscribers({
    type: 'progress',
    runId,
    taskName,
    progress: {
      stage: progress.stage || 'executing',
      percentage: progress.percentage || 0,
      details: progress.details || '',
      timestamp: new Date().toISOString()
    }
  });
}
