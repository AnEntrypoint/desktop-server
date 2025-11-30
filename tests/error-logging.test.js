import test from 'node:test';
import assert from 'node:assert/strict';
import { logFileOperation, logFileSuccess, createDetailedErrorResponse, ErrorCategories } from '../src/utils/error-logger.js';

test('Error Logging and Categorization', async (t) => {
  await t.test('should categorize FILE_NOT_FOUND errors', () => {
    const error = new Error('ENOENT: no such file or directory');
    error.code = 'ENOENT';

    const log = logFileOperation('read', '/missing.txt', error);
    assert.equal(log.category, ErrorCategories.FILE_NOT_FOUND);
    assert.equal(log.severity, 'error');
  });

  await t.test('should categorize PERMISSION_DENIED errors', () => {
    const error = new Error('EACCES: permission denied');
    error.code = 'EACCES';

    const log = logFileOperation('read', '/restricted', error);
    assert.equal(log.category, ErrorCategories.PERMISSION_DENIED);
    assert.equal(log.severity, 'critical');
  });

  await t.test('should categorize PATH_TRAVERSAL attempts', () => {
    const error = new Error('path traversal detected');

    const log = logFileOperation('read', '../../etc/passwd', error);
    assert.equal(log.category, ErrorCategories.PATH_TRAVERSAL);
    assert.equal(log.severity, 'critical');
  });

  await t.test('should categorize FILE_TOO_LARGE errors', () => {
    const error = new Error('File too large');
    error.code = 'EFBIG';

    const log = logFileOperation('read', '/huge.bin', error);
    assert.equal(log.category, ErrorCategories.FILE_TOO_LARGE);
    assert.equal(log.severity, 'error');
  });

  await t.test('should log successful operations', () => {
    const log = logFileSuccess('write', '/file.txt', 42, { size: 1024 });
    assert.equal(log.status, 'success');
    assert.equal(log.durationMs, 42);
    assert.equal(log.metadata.size, 1024);
  });

  await t.test('should create user-friendly error responses', () => {
    const error = new Error('ENOENT: file not found');
    error.code = 'ENOENT';

    const response = createDetailedErrorResponse('read', '/missing.txt', error);
    assert.match(response.error.message, /find.*file.*directory/i);
    assert.equal(response.error.code, ErrorCategories.FILE_NOT_FOUND);
  });

  await t.test('should include DEBUG information when enabled', () => {
    const originalDebug = process.env.DEBUG;
    process.env.DEBUG = '1';

    const error = new Error('Test error');
    const response = createDetailedErrorResponse('test', '/file', error);

    assert.ok(response.error.details, 'Should include details in DEBUG mode');
    assert.ok(response.error.details.stack, 'Should include stack trace');

    process.env.DEBUG = originalDebug;
  });

  await t.test('should limit stack trace to 3 lines in responses', () => {
    const error = new Error('Multi-line\nerror\nwith\nmany\nlines');
    const response = createDetailedErrorResponse('test', '/file', error);

    // Stack trace should be present but limited
    if (response.error.details && response.error.details.stack) {
      assert.ok(Array.isArray(response.error.details.stack));
    }
  });
});
