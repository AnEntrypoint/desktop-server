import fs from 'fs-extra';
import path from 'path';
import logger from '@sequential/sequential-logging';
import { nowISO, createTimestamps, updateTimestamp } from '@sequential/timestamp-utilities';

const APPS_DIR = '../';
const STORAGE_MANAGER_CODE = `
function createStorageManager(appId) {
  const stateKey = \`app-state:\${appId}\`;
  const expiryKey = \`app-state-expiry:\${appId}\`;
  return {
    save(state, ttlMs = null) {
      try {
        localStorage.setItem(stateKey, JSON.stringify(state));
        if (ttlMs) {
          const expiryTime = Date.now() + ttlMs;
          localStorage.setItem(expiryKey, expiryTime.toString());
        }
      } catch (error) {
        logger.error(\`[Storage] Failed to save state for \${appId}:\`, error);
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
        logger.error(\`[Storage] Failed to load state for \${appId}:\`, error);
        return null;
      }
    },
    clear() {
      try {
        localStorage.removeItem(stateKey);
        localStorage.removeItem(expiryKey);
      } catch (error) {
        logger.error(\`[Storage] Failed to clear state for \${appId}:\`, error);
      }
    }
  };
}`;

const INIT_HOOKS = {
  'app-code-editor': `
    const storage = createStorageManager('app-code-editor');
    const savedState = storage.load();
    if (savedState) {
      openFiles = { ...openFiles, ...savedState.openFiles };
      currentFile = savedState.currentFile || currentFile;
    }
    window.addEventListener('beforeunload', () => {
      storage.save({ openFiles, currentFile });
    });
  `,
  'app-terminal': `
    const storage = createStorageManager('app-terminal');
    const savedState = storage.load();
    if (savedState) {
      currentTab = savedState.currentTab || currentTab;
      sessions = { ...sessions, ...savedState.sessions };
    }
    setInterval(() => {
      storage.save({ currentTab, sessions });
    }, 5000);
  `,
  'app-flow-editor': `
    const storage = createStorageManager('app-flow-editor');
    const savedState = storage.load();
    if (savedState) {
      currentFlow = savedState.currentFlow || currentFlow;
      editingFlow = savedState.editingFlow || editingFlow;
    }
    window.addEventListener('beforeunload', () => {
      storage.save({ currentFlow, editingFlow });
    });
  `,
  'app-file-browser': `
    const storage = createStorageManager('app-file-browser');
    const savedState = storage.load();
    if (savedState) {
      currentDirectory = savedState.currentDirectory || currentDirectory;
      selectedFile = savedState.selectedFile || selectedFile;
    }
    window.addEventListener('beforeunload', () => {
      storage.save({ currentDirectory, selectedFile });
    });
  `,
  'app-task-editor': `
    const storage = createStorageManager('app-task-editor');
    const savedState = storage.load();
    if (savedState) {
      selectedTask = savedState.selectedTask || selectedTask;
      selectedRunner = savedState.selectedRunner || selectedRunner;
    }
    window.addEventListener('beforeunload', () => {
      storage.save({ selectedTask, selectedRunner });
    });
  `,
  'app-debugger': `
    const storage = createStorageManager('app-debugger');
    const savedState = storage.load();
    if (savedState) {
      selectedLayer = savedState.selectedLayer || selectedLayer;
      expandedLayers = savedState.expandedLayers || expandedLayers;
    }
    window.addEventListener('beforeunload', () => {
      storage.save({ selectedLayer, expandedLayers });
    });
  `,
  'app-flow-debugger': `
    const storage = createStorageManager('app-flow-debugger');
    const savedState = storage.load();
    if (savedState) {
      selectedFlow = savedState.selectedFlow || selectedFlow;
      stepPosition = savedState.stepPosition || stepPosition;
    }
    window.addEventListener('beforeunload', () => {
      storage.save({ selectedFlow, stepPosition });
    });
  `,
  'app-task-debugger': `
    const storage = createStorageManager('app-task-debugger');
    const savedState = storage.load();
    if (savedState) {
      selectedTask = savedState.selectedTask || selectedTask;
      selectedRun = savedState.selectedRun || selectedRun;
    }
    window.addEventListener('beforeunload', () => {
      storage.save({ selectedTask, selectedRun });
    });
  `,
  'app-run-observer': `
    const storage = createStorageManager('app-run-observer');
    const savedState = storage.load();
    if (savedState) {
      timeRange = savedState.timeRange || timeRange;
      sortOrder = savedState.sortOrder || sortOrder;
    }
    window.addEventListener('beforeunload', () => {
      storage.save({ timeRange, sortOrder });
    });
  `,
  'app-tool-editor': `
    const storage = createStorageManager('app-tool-editor');
    const savedState = storage.load();
    if (savedState) {
      selectedTool = savedState.selectedTool || selectedTool;
      editingTool = savedState.editingTool || editingTool;
    }
    window.addEventListener('beforeunload', () => {
      storage.save({ selectedTool, editingTool });
    });
  `
};

async function injectPersistence() {
  for (const [appName, initHook] of Object.entries(INIT_HOOKS)) {
    const htmlPath = path.join(APPS_DIR, appName, 'dist/index.html');

    if (!fs.existsSync(htmlPath)) {
      logger.info(`⚠️  Skipping ${appName} - HTML not found`);
      continue;
    }

    let content = fs.readFileSync(htmlPath, 'utf8');

    if (content.includes('[Storage-Manager-Injected]')) {
      logger.info(`✅ ${appName} - Already has persistence`);
      continue;
    }

    let scriptStartIdx = content.indexOf('<script>');
    let scriptTag = '<script>';
    if (scriptStartIdx === -1) {
      scriptStartIdx = content.indexOf('<script type="module">');
      scriptTag = '<script type="module">';
    }
    if (scriptStartIdx === -1) {
      logger.info(`⚠️  Skipping ${appName} - No script tag found`);
      continue;
    }

    const insertIdx = scriptStartIdx + scriptTag.length;
    const marker = '\n    // [Storage-Manager-Injected]\n';
    const injection = marker + STORAGE_MANAGER_CODE + '\n' + initHook + '\n';

    const updated = content.slice(0, insertIdx) + injection + content.slice(insertIdx);

    fs.writeFileSync(htmlPath, updated, 'utf8');
    logger.info(`✅ ${appName} - Persistence injected`);
  }

  logger.info('\n✨ localStorage persistence injected into all apps');
}

injectPersistence().catch(console.error);
