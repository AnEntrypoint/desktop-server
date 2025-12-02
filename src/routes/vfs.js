import path from 'path';
import fs from 'fs-extra';
import { asyncHandler } from '../middleware/error-handler.js';
import { CONFIG } from '@sequential/server-utilities';

export function registerVfsRoutes(app, container) {
  const vfsDir = process.env.VFS_DIR || path.join(process.cwd(), '.sequential-vfs');

  app.get('/api/vfs/scopes', asyncHandler(async (req, res) => {
    const scopes = ['run', 'task', 'global'];
    res.json({ scopes });
  }));

  app.get('/api/vfs/list', asyncHandler(async (req, res) => {
    const { scope = 'global', dir = '' } = req.query;

    if (!['run', 'task', 'global'].includes(scope)) {
      return res.status(400).json({ error: { code: 'INVALID_SCOPE', message: 'Scope must be run, task, or global' } });
    }

    const scopePath = path.join(vfsDir, scope);
    const dirPath = dir ? path.join(scopePath, dir) : scopePath;
    const realPath = path.resolve(dirPath);

    if (!realPath.startsWith(vfsDir)) {
      return res.status(400).json({ error: { code: 'PATH_TRAVERSAL', message: 'Path traversal not allowed' } });
    }

    try {
      if (!await fs.pathExists(realPath)) {
        return res.json({ scope, dir, files: [], directories: [] });
      }

      const entries = await fs.readdir(realPath, { withFileTypes: true });
      const files = [];
      const directories = [];

      for (const entry of entries) {
        const entryPath = path.join(realPath, entry.name);
        const stat = await fs.stat(entryPath);

        if (entry.isDirectory()) {
          directories.push({
            name: entry.name,
            type: 'directory',
            size: 0,
            modified: stat.mtime,
            path: dir ? `${dir}/${entry.name}` : entry.name
          });
        } else {
          files.push({
            name: entry.name,
            type: 'file',
            size: stat.size,
            modified: stat.mtime,
            path: dir ? `${dir}/${entry.name}` : entry.name
          });
        }
      }

      res.json({
        scope,
        dir: dir || '/',
        files: files.sort((a, b) => a.name.localeCompare(b.name)),
        directories: directories.sort((a, b) => a.name.localeCompare(b.name))
      });
    } catch (error) {
      return res.status(500).json({ error: { code: 'READ_ERROR', message: error.message } });
    }
  }));

  app.get('/api/vfs/read', asyncHandler(async (req, res) => {
    const { scope = 'global', path: filePath } = req.query;

    if (!['run', 'task', 'global'].includes(scope)) {
      return res.status(400).json({ error: { code: 'INVALID_SCOPE', message: 'Scope must be run, task, or global' } });
    }

    if (!filePath) {
      return res.status(400).json({ error: { code: 'MISSING_PATH', message: 'File path required' } });
    }

    const scopePath = path.join(vfsDir, scope);
    const fullPath = path.join(scopePath, filePath);
    const realPath = path.resolve(fullPath);

    if (!realPath.startsWith(vfsDir)) {
      return res.status(400).json({ error: { code: 'PATH_TRAVERSAL', message: 'Path traversal not allowed' } });
    }

    try {
      const stat = await fs.stat(realPath);

      if (stat.isDirectory()) {
        return res.status(400).json({ error: { code: 'IS_DIRECTORY', message: 'Cannot read directory as file' } });
      }

      if (stat.size > CONFIG.files.maxSizeBytes) {
        const maxMb = Math.round(CONFIG.files.maxSizeBytes / (1024 * 1024));
        return res.status(400).json({ error: { code: 'FILE_TOO_LARGE', message: `File too large (max ${maxMb}MB)` } });
      }

      const content = await fs.readFile(realPath, 'utf8');
      res.json({ scope, path: filePath, size: stat.size, content, modified: stat.mtime });
    } catch (error) {
      res.status(500).json({ error: { code: 'READ_ERROR', message: error.message } });
    }
  }));

  app.post('/api/vfs/write', asyncHandler(async (req, res) => {
    const { scope = 'global', path: filePath, content } = req.body;

    if (!['run', 'task', 'global'].includes(scope)) {
      return res.status(400).json({ error: { code: 'INVALID_SCOPE', message: 'Scope must be run, task, or global' } });
    }

    if (!filePath || !content || typeof content !== 'string') {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'File path and content (string) required' } });
    }

    const scopePath = path.join(vfsDir, scope);
    const fullPath = path.join(scopePath, filePath);
    const realPath = path.resolve(fullPath);

    if (!realPath.startsWith(vfsDir)) {
      return res.status(400).json({ error: { code: 'PATH_TRAVERSAL', message: 'Path traversal not allowed' } });
    }

    try {
      await fs.ensureDir(path.dirname(realPath));
      await fs.writeFile(realPath, content, 'utf8');
      const stat = await fs.stat(realPath);
      res.json({ scope, path: filePath, size: stat.size, modified: stat.mtime, success: true });
    } catch (error) {
      res.status(500).json({ error: { code: 'WRITE_ERROR', message: error.message } });
    }
  }));

  app.delete('/api/vfs/delete', asyncHandler(async (req, res) => {
    const { scope = 'global', path: filePath } = req.body;

    if (!['run', 'task', 'global'].includes(scope)) {
      return res.status(400).json({ error: { code: 'INVALID_SCOPE', message: 'Scope must be run, task, or global' } });
    }

    if (!filePath) {
      return res.status(400).json({ error: { code: 'MISSING_PATH', message: 'File path required' } });
    }

    const scopePath = path.join(vfsDir, scope);
    const fullPath = path.join(scopePath, filePath);
    const realPath = path.resolve(fullPath);

    if (!realPath.startsWith(vfsDir)) {
      return res.status(400).json({ error: { code: 'PATH_TRAVERSAL', message: 'Path traversal not allowed' } });
    }

    try {
      if (await fs.pathExists(realPath)) {
        await fs.remove(realPath);
      }
      res.json({ scope, path: filePath, success: true });
    } catch (error) {
      res.status(500).json({ error: { code: 'DELETE_ERROR', message: error.message } });
    }
  }));
}
