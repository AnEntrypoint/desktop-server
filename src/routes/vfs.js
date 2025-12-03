import path from 'path';
import fs from 'fs-extra';
import { asyncHandler } from '../middleware/error-handler.js';
import { CONFIG } from '@sequential/server-utilities';
import { formatResponse } from '@sequential/response-formatting';
import { throwValidationError, throwPathTraversal } from '@sequential/error-handling';

const VALID_SCOPES = ['run', 'task', 'global'];

function validateScope(scope) {
  if (!VALID_SCOPES.includes(scope)) throwValidationError('scope', 'Scope must be run, task, or global');
}

function validatePath(realPath, vfsDir) {
  if (!realPath.startsWith(vfsDir)) throwPathTraversal(realPath);
}

export function registerVfsRoutes(app, container) {
  const vfsDir = process.env.VFS_DIR || path.join(process.cwd(), '.sequential-vfs');

  app.get('/api/vfs/scopes', asyncHandler(async (req, res) => {
    res.json({ scopes: VALID_SCOPES });
  }));

  app.get('/api/vfs/list', asyncHandler(async (req, res) => {
    const { scope = 'global', dir = '' } = req.query;
    validateScope(scope);
    const scopePath = path.join(vfsDir, scope);
    const dirPath = dir ? path.join(scopePath, dir) : scopePath;
    const realPath = path.resolve(dirPath);
    validatePath(realPath, vfsDir);

    if (!await fs.pathExists(realPath)) {
      return res.json(formatResponse({ scope, dir, files: [], directories: [] }));
    }

    const entries = await fs.readdir(realPath, { withFileTypes: true });
    const files = [], directories = [];
    for (const entry of entries) {
      const entryPath = path.join(realPath, entry.name);
      const stat = await fs.stat(entryPath);
      const entryPath_ = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        directories.push({ name: entry.name, type: 'directory', size: 0, modified: stat.mtime, path: entryPath_ });
      } else {
        files.push({ name: entry.name, type: 'file', size: stat.size, modified: stat.mtime, path: entryPath_ });
      }
    }
    res.json(formatResponse({
      scope, dir: dir || '/',
      files: files.sort((a, b) => a.name.localeCompare(b.name)),
      directories: directories.sort((a, b) => a.name.localeCompare(b.name))
    }));
  }));

  app.get('/api/vfs/read', asyncHandler(async (req, res) => {
    const { scope = 'global', path: filePath } = req.query;
    validateScope(scope);
    if (!filePath) throwValidationError('path', 'File path required');

    const scopePath = path.join(vfsDir, scope);
    const fullPath = path.join(scopePath, filePath);
    const realPath = path.resolve(fullPath);
    validatePath(realPath, vfsDir);

    const stat = await fs.stat(realPath);
    if (stat.isDirectory()) throwValidationError('path', 'Cannot read directory as file');
    if (stat.size > CONFIG.files.maxSizeBytes) {
      const maxMb = Math.round(CONFIG.files.maxSizeBytes / (1024 * 1024));
      throwValidationError('size', `File too large (max ${maxMb}MB)`);
    }

    const content = await fs.readFile(realPath, 'utf8');
    res.json(formatResponse({ scope, path: filePath, size: stat.size, content, modified: stat.mtime }));
  }));

  app.post('/api/vfs/write', asyncHandler(async (req, res) => {
    const { scope = 'global', path: filePath, content } = req.body;
    validateScope(scope);
    if (!filePath || typeof content !== 'string') throwValidationError('input', 'File path and content (string) required');

    const scopePath = path.join(vfsDir, scope);
    const fullPath = path.join(scopePath, filePath);
    const realPath = path.resolve(fullPath);
    validatePath(realPath, vfsDir);

    await fs.ensureDir(path.dirname(realPath));
    await fs.writeFile(realPath, content, 'utf8');
    const stat = await fs.stat(realPath);
    res.json(formatResponse({ scope, path: filePath, size: stat.size, modified: stat.mtime, success: true }));
  }));

  app.delete('/api/vfs/delete', asyncHandler(async (req, res) => {
    const { scope = 'global', path: filePath } = req.body;
    validateScope(scope);
    if (!filePath) throwValidationError('path', 'File path required');

    const scopePath = path.join(vfsDir, scope);
    const fullPath = path.join(scopePath, filePath);
    const realPath = path.resolve(fullPath);
    validatePath(realPath, vfsDir);

    if (await fs.pathExists(realPath)) await fs.remove(realPath);
    res.json(formatResponse({ scope, path: filePath, success: true }));
  }));
}
