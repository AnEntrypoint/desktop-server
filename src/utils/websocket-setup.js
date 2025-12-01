import { WebSocketServer } from 'ws';
import { createWebSocketRateLimiter, checkWebSocketRateLimit } from '../middleware/rate-limit.js';
import { createSubscriptionHandler } from '@sequential/websocket-factory';
import { addRunSubscriber, removeRunSubscriber, addTaskSubscriber, removeTaskSubscriber, addFileSubscriber, removeFileSubscriber } from '@sequential/websocket-broadcaster';

export function setupWebSocket(httpServer, getActiveTasks) {
  const wss = new WebSocketServer({ noServer: true });

  createWebSocketRateLimiter();

  const subscriptionHandlers = [
    createSubscriptionHandler({
      urlPattern: '/api/runs/subscribe',
      paramExtractor: () => `run-${Date.now()}`,
      onSubscribe: (id, ws) => addRunSubscriber(id, ws),
      onUnsubscribe: (id, ws) => removeRunSubscriber(id),
      getInitialMessage: (id, getActiveTasks) => ({
        type: 'connected',
        activeRuns: getActiveTasks().size
      }),
      contextLabel: (id) => id
    }),
    createSubscriptionHandler({
      urlPattern: /^\/api\/tasks\/([^/]+)\/subscribe$/,
      paramExtractor: (url) => url.match(/^\/api\/tasks\/([^/]+)\/subscribe$/)[1],
      onSubscribe: (taskName, ws) => addTaskSubscriber(taskName, ws),
      onUnsubscribe: (taskName, ws) => removeTaskSubscriber(taskName, ws),
      getInitialMessage: (taskName) => ({ type: 'connected', taskName }),
      contextLabel: (taskName) => taskName
    }),
    createSubscriptionHandler({
      urlPattern: '/api/files/subscribe',
      paramExtractor: () => 'files',
      onSubscribe: (ctx, ws) => addFileSubscriber(ws),
      onUnsubscribe: (ctx, ws) => removeFileSubscriber(ws),
      getInitialMessage: () => ({
        type: 'connected',
        message: 'File subscription established'
      }),
      contextLabel: 'files'
    })
  ];

  httpServer.on('upgrade', (req, socket, head) => {
    const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for'] || '127.0.0.1';
    const limiter = checkWebSocketRateLimit(clientIp);

    if (!limiter.isAllowed()) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\n\r\n');
      socket.write(JSON.stringify({ error: 'Too many WebSocket connections from this IP', remaining: 0 }));
      socket.destroy();
      return;
    }

    const handler = subscriptionHandlers.find(h => h.matches(req.url));
    if (handler) {
      handler.handle(wss, req, socket, head, limiter, getActiveTasks);
    } else {
      socket.destroy();
    }
  });

  return { wss };
}
