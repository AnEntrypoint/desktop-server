function createStorageManager(appId) {
  const stateKey = `app-state:${appId}`;
  const expiryKey = `app-state-expiry:${appId}`;

  return {
    save(state, ttlMs = null) {
      try {
        localStorage.setItem(stateKey, JSON.stringify(state));
        if (ttlMs) {
          const expiryTime = Date.now() + ttlMs;
          localStorage.setItem(expiryKey, expiryTime.toString());
        }
      } catch (error) {
        console.error(`[Storage] Failed to save state for ${appId}:`, error);
      }
    },

    load() {
      try {
        const expiryTime = localStorage.getItem(expiryKey);
        if (expiryTime && Date.now() > parseInt(expiryTime)) {
          this.clear();
          return null;
        }

        const stateStr = localStorage.getItem(stateKey);
        return stateStr ? JSON.parse(stateStr) : null;
      } catch (error) {
        console.error(`[Storage] Failed to load state for ${appId}:`, error);
        return null;
      }
    },

    clear() {
      try {
        localStorage.removeItem(stateKey);
        localStorage.removeItem(expiryKey);
      } catch (error) {
        console.error(`[Storage] Failed to clear state for ${appId}:`, error);
      }
    },

    merge(newState) {
      try {
        const existing = this.load() || {};
        const merged = { ...existing, ...newState };
        this.save(merged);
        return merged;
      } catch (error) {
        console.error(`[Storage] Failed to merge state for ${appId}:`, error);
        return newState;
      }
    }
  };
}

function clearAllAppState() {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('app-state:') || key.startsWith('app-state-expiry:')) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error('[Storage] Failed to clear all app state:', error);
  }
}

function getAllAppState() {
  try {
    const state = {};
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('app-state:')) {
        const appId = key.replace('app-state:', '');
        const expiryKey = `app-state-expiry:${appId}`;
        const expiryTime = localStorage.getItem(expiryKey);

        if (!expiryTime || Date.now() <= parseInt(expiryTime)) {
          const stateStr = localStorage.getItem(key);
          if (stateStr) {
            state[appId] = JSON.parse(stateStr);
          }
        }
      }
    });
    return state;
  } catch (error) {
    console.error('[Storage] Failed to get all app state:', error);
    return {};
  }
}
