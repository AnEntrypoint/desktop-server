import { createSingleSubscriber, createGroupedSubscriber, createSetSubscriber } from './subscriber-manager.js';

const runSubscribers = createSingleSubscriber();
const taskSubscribers = createGroupedSubscriber();
const fileSubscribers = createSetSubscriber();

export function broadcastToRunSubscribers(message) {
  runSubscribers.broadcast(message);
}

export function broadcastToTaskSubscribers(taskName, message) {
  taskSubscribers.broadcast(message, taskName);
}

export function broadcastToFileSubscribers(message) {
  fileSubscribers.broadcast(message);
}

export function addRunSubscriber(subscriptionId, ws) {
  runSubscribers.subscribe(subscriptionId, ws);
}

export function removeRunSubscriber(subscriptionId) {
  runSubscribers.unsubscribe(subscriptionId);
}

export function addTaskSubscriber(taskName, ws) {
  taskSubscribers.subscribe(taskName, ws);
}

export function removeTaskSubscriber(taskName, ws) {
  taskSubscribers.unsubscribe(taskName, ws);
}

export function addFileSubscriber(ws) {
  fileSubscribers.subscribe(ws);
}

export function removeFileSubscriber(ws) {
  fileSubscribers.unsubscribe(ws);
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
