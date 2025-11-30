import path from 'path';
import fs from 'fs-extra';

export function validateFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }
  const realPath = path.resolve(filePath);
  const cwd = path.resolve(process.cwd());
  const relative = path.relative(cwd, realPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Access denied: path traversal detected');
  }
  return realPath;
}

export async function readJsonFile(filePath, defaultValue = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

export async function writeJsonFile(filePath, data) {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJSON(filePath, data, { spaces: 2 });
}

export async function getAllFiles(dir, base = '') {
  const files = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, path.join(base, item));
      files.push(...subFiles);
    } else {
      files.push(path.join(base, item));
    }
  }
  return files;
}

export async function safeFileOperation(operation, fallback = null) {
  try {
    return await operation();
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(`File operation error: ${error.message}`);
    }
    return fallback;
  }
}

export function getFileSizeStr(bytes) {
  if (bytes === 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i];
}

export function truncateString(str, maxLen = 100) {
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

export function serializeError(error) {
  if (!error) return null;
  return {
    message: error.message,
    code: error.code,
    stack: error.stack?.split('\n').slice(0, 3).join('\n')
  };
}

export function normalizeQuery(queryObj) {
  const normalized = {};
  for (const [key, value] of Object.entries(queryObj || {})) {
    if (value !== undefined && value !== null && value !== '') {
      normalized[key] = value;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function escapeHtml(text) {
  if (!text || typeof text !== 'string') return text;
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
  };
  return text.replace(/[&<>"'\/]/g, char => map[char]);
}

export function sanitizeInput(input, allowHtml = false) {
  if (typeof input === 'string') {
    return allowHtml ? input.trim() : escapeHtml(input.trim());
  }
  if (typeof input === 'object' && input !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value, allowHtml);
    }
    return sanitized;
  }
  return input;
}

export function validateTaskName(taskName) {
  if (!taskName || typeof taskName !== 'string') {
    throw new Error('Invalid task name');
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(taskName)) {
    throw new Error('Task name contains invalid characters (allowed: alphanumeric, dot, dash, underscore)');
  }
  if (taskName.length > 100) {
    throw new Error('Task name too long (max 100 characters)');
  }
  return taskName;
}

export function validateFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    throw new Error('Invalid file name');
  }
  if (fileName.includes('/') || fileName.includes('\\') || fileName.startsWith('.')) {
    throw new Error('File name contains invalid characters');
  }
  if (fileName.length > 255) {
    throw new Error('File name too long (max 255 characters)');
  }
  return fileName;
}
