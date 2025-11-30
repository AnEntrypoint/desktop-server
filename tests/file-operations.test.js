import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import { validateFilePath, validateFileName } from '../src/lib/utils.js';
import { createDetailedErrorResponse } from '../src/utils/error-logger.js';

const testDir = './test-files';

test.before(async () => {
  await fs.ensureDir(testDir);
});

test.after(async () => {
  await fs.remove(testDir);
});

test('File Operations', async (t) => {
  await t.test('validateFilePath should allow safe paths', () => {
    const safe = path.join(testDir, 'test.txt');
    const result = validateFilePath(safe);
    assert.equal(result, safe);
  });

  await t.test('validateFilePath should reject path traversal', () => {
    const unsafe = path.join(testDir, '../../etc/passwd');
    assert.throws(() => validateFilePath(unsafe), { message: /path traversal/i });
  });

  await t.test('validateFileName should allow valid names', () => {
    assert.doesNotThrow(() => validateFileName('document.txt'));
    assert.doesNotThrow(() => validateFileName('my-file_123.js'));
  });

  await t.test('validateFileName should reject invalid names', () => {
    assert.throws(() => validateFileName('file/name'), { message: /invalid/i });
    assert.throws(() => validateFileName('..'), { message: /invalid/i });
    assert.throws(() => validateFileName(''), { message: /required/i });
  });

  await t.test('should create and read files', async () => {
    const filePath = path.join(testDir, 'test.txt');
    const content = 'Hello, World!';

    await fs.writeFile(filePath, content, 'utf8');
    const read = await fs.readFile(filePath, 'utf8');
    assert.equal(read, content);
  });

  await t.test('should detect file too large', () => {
    const error = new Error('File too large');
    error.code = 'EFBIG';

    const response = createDetailedErrorResponse('read', '/file.txt', error, 400);
    assert.match(response.error.message, /too large/i);
  });

  await t.test('should handle file not found', () => {
    const error = new Error('ENOENT: no such file or directory');
    error.code = 'ENOENT';

    const response = createDetailedErrorResponse('read', '/nonexistent', error, 404);
    assert.match(response.error.code, /FILE_NOT_FOUND/);
  });
});
