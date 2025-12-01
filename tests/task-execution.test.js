import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import { validateTaskName, sanitizeInput, validateInputSchema, validateAndSanitizeMetadata } from '../src/lib/utils.js';
import { executeTaskWithTimeout } from '../src/utils/task-executor.js';

const testDir = './test-tasks';

test.before(async () => {
  await fs.ensureDir(testDir);
});

test.after(async () => {
  await fs.remove(testDir);
});

test('Task Execution', async (t) => {
  await t.test('validateTaskName should accept valid names', () => {
    assert.doesNotThrow(() => validateTaskName('simple-task'));
    assert.doesNotThrow(() => validateTaskName('task_123'));
    assert.doesNotThrow(() => validateTaskName('task.name'));
  });

  await t.test('validateTaskName should reject invalid names', () => {
    assert.throws(() => validateTaskName('task/name'), { message: /invalid characters/ });
    assert.throws(() => validateTaskName(''), { message: /invalid/i });
    assert.throws(() => validateTaskName(null), { message: /invalid/i });
  });

  await t.test('sanitizeInput should sanitize strings', () => {
    const input = { name: '<script>alert("xss")</script>' };
    const sanitized = sanitizeInput(input);
    assert.doesNotMatch(sanitized.name, /<script>/);
  });

  await t.test('sanitizeInput should preserve safe content', () => {
    const input = { message: 'Hello, World!' };
    const sanitized = sanitizeInput(input);
    assert.equal(sanitized.message, 'Hello, World!');
  });

  await t.test('validateInputSchema should accept valid inputs', () => {
    const input = { userId: '123', email: 'user@example.com' };
    const schema = [
      { name: 'userId', type: 'string', required: true },
      { name: 'email', type: 'string', required: true }
    ];
    const errors = validateInputSchema(input, schema);
    assert.equal(errors, null);
  });

  await t.test('validateInputSchema should reject missing required fields', () => {
    const input = { userId: '123' };
    const schema = [
      { name: 'userId', type: 'string', required: true },
      { name: 'email', type: 'string', required: true }
    ];
    const errors = validateInputSchema(input, schema);
    assert.ok(errors);
    assert.ok(errors.some(e => e.includes('email')));
  });

  await t.test('validateInputSchema should validate field types', () => {
    const input = { count: 'not-a-number' };
    const schema = [{ name: 'count', type: 'number', required: true }];
    const errors = validateInputSchema(input, schema);
    assert.ok(errors);
  });

  await t.test('validateAndSanitizeMetadata should accept valid metadata', () => {
    const metadata = {
      source: 'test',
      status: 'success',
      duration: 1234
    };
    assert.doesNotThrow(() => validateAndSanitizeMetadata(metadata));
  });

  await t.test('validateAndSanitizeMetadata should reject non-objects', () => {
    assert.throws(() => validateAndSanitizeMetadata('not-an-object'));
  });

  await t.test('validateAndSanitizeMetadata should reject non-serializable objects', () => {
    const metadata = {
      func: () => {}
    };
    assert.throws(() => validateAndSanitizeMetadata(metadata));
  });

  await t.test('executeTaskWithTimeout should execute simple tasks', async () => {
    const code = 'export async function task(input) { return { result: input.x + input.y }; }';
    const result = await executeTaskWithTimeout('add-task', code, { x: 2, y: 3 }, 5000);
    assert.equal(result.result, 5);
  });

  await t.test('executeTaskWithTimeout should handle task errors', async () => {
    const code = 'export async function task(input) { throw new Error("Task failed"); }';
    assert.rejects(
      () => executeTaskWithTimeout('error-task', code, {}, 5000),
      { message: /Task failed/ }
    );
  });

  await t.test('executeTaskWithTimeout should timeout on slow tasks', async () => {
    const code = 'export async function task(input) { await new Promise(r => setTimeout(r, 10000)); }';
    assert.rejects(
      () => executeTaskWithTimeout('slow-task', code, {}, 1000),
      { message: /timeout/ }
    );
  });

  await t.test('executeTaskWithTimeout should handle async operations', async () => {
    const code = `
      export async function task(input) {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ delayed: true }), 100);
        });
      }
    `;
    const result = await executeTaskWithTimeout('async-task', code, {}, 5000);
    assert.equal(result.delayed, true);
  });

  await t.test('executeTaskWithTimeout should preserve function scope', async () => {
    const code = `
      export async function task(input) {
        const local = 42;
        return { value: local, input: input.key };
      }
    `;
    const result = await executeTaskWithTimeout('scope-task', code, { key: 'test' }, 5000);
    assert.equal(result.value, 42);
    assert.equal(result.input, 'test');
  });

  await t.test('executeTaskWithTimeout should handle empty input', async () => {
    const code = 'export async function task(input) { return { received: !!input }; }';
    const result = await executeTaskWithTimeout('empty-input', code, {}, 5000);
    assert.equal(result.received, true);
  });

  await t.test('executeTaskWithTimeout should handle complex return values', async () => {
    const code = `
      export async function task(input) {
        return {
          string: 'value',
          number: 42,
          bool: true,
          array: [1, 2, 3],
          nested: { key: 'value' }
        };
      }
    `;
    const result = await executeTaskWithTimeout('complex-task', code, {}, 5000);
    assert.equal(result.string, 'value');
    assert.equal(result.number, 42);
    assert.equal(result.bool, true);
    assert.deepEqual(result.array, [1, 2, 3]);
    assert.deepEqual(result.nested, { key: 'value' });
  });

  await t.test('executeTaskWithTimeout should handle null/undefined returns', async () => {
    const code = 'export async function task(input) { return null; }';
    const result = await executeTaskWithTimeout('null-task', code, {}, 5000);
    assert.equal(result, null);
  });
});
