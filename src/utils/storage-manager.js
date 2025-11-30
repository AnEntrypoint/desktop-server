const APP_STATE_PREFIX = 'app-state:';
const EXPIRY_PREFIX = 'app-state-expiry:';

export function createStorageManager(appId) {
  const stateKey = `${APP_STATE_PREFIX}${appId}`;
  const expiryKey = `${EXPIRY_PREFIX}${appId}`;

  return {
    save(state, ttlMs = null) {
      try {
        localStorage.setItem(stateKey, JSON.stringify(state));
        if (ttlMs) {
          const expiryTime = Date.now() + ttlMs;
          localStorage.setItem(expiryKey, expiryTime.toString());
        }
      } catch (error) {
        console.error(`Failed to save state for ${appId}:`, error);
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
        console.error(`Failed to load state for ${appId}:`, error);
        return null;
      }
    },

    clear() {
      try {
        localStorage.removeItem(stateKey);
        localStorage.removeItem(expiryKey);
      } catch (error) {
        console.error(`Failed to clear state for ${appId}:`, error);
      }
    },

    merge(newState) {
      try {
        const existing = this.load() || {};
        const merged = { ...existing, ...newState };
        this.save(merged);
        return merged;
      } catch (error) {
        console.error(`Failed to merge state for ${appId}:`, error);
        return newState;
      }
    }
  };
}

export function clearAllAppState() {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(APP_STATE_PREFIX) || key.startsWith(EXPIRY_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error('Failed to clear all app state:', error);
  }
}

export function getAllAppState() {
  try {
    const state = {};
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(APP_STATE_PREFIX)) {
        const appId = key.replace(APP_STATE_PREFIX, '');
        const expiryKey = `${EXPIRY_PREFIX}${appId}`;
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
    console.error('Failed to get all app state:', error);
    return {};
  }
}
