import fs from 'fs-extra';
import path from 'path';
import { randomUUID } from 'crypto';

export async function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  await fs.ensureDir(dir);

  const tempFile = path.join(dir, `.${randomUUID()}.tmp`);

  try {
    if (typeof content === 'object') {
      await fs.writeJSON(tempFile, content, { spaces: 2 });
    } else {
      await fs.writeFile(tempFile, content, 'utf8');
    }

    await fs.rename(tempFile, filePath);
  } catch (error) {
    try {
      await fs.remove(tempFile);
    } catch (e) {}
    throw error;
  }
}

export async function writeFileAtomicString(filePath, content) {
  const dir = path.dirname(filePath);
  await fs.ensureDir(dir);

  const tempFile = path.join(dir, `.${randomUUID()}.tmp`);

  try {
    await fs.writeFile(tempFile, content, 'utf8');
    await fs.rename(tempFile, filePath);
  } catch (error) {
    try {
      await fs.remove(tempFile);
    } catch (e) {}
    throw error;
  }
}

export async function writeFileAtomicJson(filePath, content) {
  const dir = path.dirname(filePath);
  await fs.ensureDir(dir);

  const tempFile = path.join(dir, `.${randomUUID()}.tmp`);

  try {
    await fs.writeJSON(tempFile, content, { spaces: 2 });
    await fs.rename(tempFile, filePath);
  } catch (error) {
    try {
      await fs.remove(tempFile);
    } catch (e) {}
    throw error;
  }
}
