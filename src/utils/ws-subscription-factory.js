export function createSubscriptionHandler(config) {
  const {
    urlPattern,
    paramExtractor,
    onSubscribe,
    onUnsubscribe,
    getInitialMessage,
    contextLabel
  } = config;

  return {
    matches: (url) => {
      if (typeof urlPattern === 'string') {
        return url.startsWith(urlPattern);
      }
      return urlPattern.test(url);
    },

    handle: (wss, req, socket, head, limiter, getActiveTasks) => {
      const params = paramExtractor(req.url);

      wss.handleUpgrade(req, socket, head, (ws) => {
        if (!limiter.add(ws)) {
          ws.close(1008, 'Per-IP connection limit exceeded');
          return;
        }

        onSubscribe(params, ws);

        ws.on('error', (error) => {
          const label = typeof contextLabel === 'function' ? contextLabel(params) : contextLabel;
          console.error(`WebSocket error [${label}]:`, error.message);
          onUnsubscribe(params, ws);
          limiter.remove(ws);
          try {
            ws.close(1011, 'Internal server error');
          } catch (e) {}
        });

        ws.on('close', () => {
          onUnsubscribe(params, ws);
          limiter.remove(ws);
        });

        try {
          const message = getInitialMessage(params, getActiveTasks);
          ws.send(JSON.stringify(message));
        } catch (e) {
          const label = typeof contextLabel === 'function' ? contextLabel(params) : contextLabel;
          console.error(`Failed to send initial message [${label}]:`, e.message);
        }
      });
    }
  };
}
