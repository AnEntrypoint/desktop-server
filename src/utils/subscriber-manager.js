export const SUBSCRIBER_MODES = {
  SINGLE: 'single',     // One subscriber per ID (Map<id, ws>)
  GROUPED: 'grouped',   // Multiple subscribers per ID (Map<id, Set<ws>>)
  SET: 'set'           // Simple Set<ws> (no ID grouping)
};

export class SubscriberManager {
  constructor(mode = SUBSCRIBER_MODES.SINGLE) {
    this.mode = mode;
    if (mode === SUBSCRIBER_MODES.SET) {
      this.subscribers = new Set();
    } else {
      this.subscribers = new Map();
    }
  }

  subscribe(idOrWs, ws = null) {
    const [id, socket] = this.mode === SUBSCRIBER_MODES.SET ? [null, idOrWs] : [idOrWs, ws];

    if (this.mode === SUBSCRIBER_MODES.SET) {
      this.subscribers.add(socket);
    } else if (this.mode === SUBSCRIBER_MODES.SINGLE) {
      this.subscribers.set(id, socket);
    } else if (this.mode === SUBSCRIBER_MODES.GROUPED) {
      if (!this.subscribers.has(id)) {
        this.subscribers.set(id, new Set());
      }
      this.subscribers.get(id).add(socket);
    }
  }

  unsubscribe(idOrWs, ws = null) {
    const [id, socket] = this.mode === SUBSCRIBER_MODES.SET ? [null, idOrWs] : [idOrWs, ws];

    if (this.mode === SUBSCRIBER_MODES.SET) {
      this.subscribers.delete(socket);
    } else if (this.mode === SUBSCRIBER_MODES.SINGLE) {
      this.subscribers.delete(id);
    } else if (this.mode === SUBSCRIBER_MODES.GROUPED) {
      if (!this.subscribers.has(id)) return;
      this.subscribers.get(id).delete(socket);
      if (this.subscribers.get(id).size === 0) {
        this.subscribers.delete(id);
      }
    }
  }

  broadcast(message, id = null) {
    const data = JSON.stringify(message);
    const sockets = this._getSockets(id);

    sockets.forEach((socket) => {
      if (socket && socket.readyState === 1) { // WebSocket.OPEN
        try {
          socket.send(data);
        } catch (err) {
          console.error('Failed to send WebSocket message:', err.message);
        }
      }
    });
  }

  _getSockets(id) {
    if (this.mode === SUBSCRIBER_MODES.SET) {
      return this.subscribers;
    } else if (this.mode === SUBSCRIBER_MODES.SINGLE) {
      const socket = this.subscribers.get(id);
      return socket ? [socket] : [];
    } else if (this.mode === SUBSCRIBER_MODES.GROUPED) {
      return this.subscribers.get(id) || new Set();
    }
    return [];
  }

  has(id) {
    if (this.mode === SUBSCRIBER_MODES.SET) {
      return this.subscribers.size > 0;
    }
    return this.subscribers.has(id);
  }

  size(id = null) {
    if (this.mode === SUBSCRIBER_MODES.SET) {
      return this.subscribers.size;
    } else if (this.mode === SUBSCRIBER_MODES.SINGLE) {
      return this.subscribers.size;
    } else if (this.mode === SUBSCRIBER_MODES.GROUPED && id) {
      return this.subscribers.get(id)?.size || 0;
    }
    return this.subscribers.size;
  }

  clear(id = null) {
    if (this.mode === SUBSCRIBER_MODES.SET) {
      this.subscribers.clear();
    } else if (this.mode === SUBSCRIBER_MODES.SINGLE || !id) {
      this.subscribers.clear();
    } else if (this.mode === SUBSCRIBER_MODES.GROUPED && id) {
      this.subscribers.delete(id);
    }
  }

  getAll() {
    return this.subscribers;
  }
}

export function createSingleSubscriber() {
  return new SubscriberManager(SUBSCRIBER_MODES.SINGLE);
}

export function createGroupedSubscriber() {
  return new SubscriberManager(SUBSCRIBER_MODES.GROUPED);
}

export function createSetSubscriber() {
  return new SubscriberManager(SUBSCRIBER_MODES.SET);
}
