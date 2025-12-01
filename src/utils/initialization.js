import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createServerError, createForbiddenError } from '@sequential/error-handling';
import { validator } from '@sequential/core-config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

export async function ensureDirectories(config) {
  const HOME_DIR = os.homedir();
  const STATEKIT_DIR = config.statekitDir || process.env.SEQUENTIAL_MACHINE_DIR || path.join(HOME_DIR, '.sequential-machine');
  const WORK_DIR = config.workDir || process.env.SEQUENTIAL_MACHINE_WORK || path.join(STATEKIT_DIR, 'work');
  const VFS_DIR = config.vfsDir || process.env.VFS_DIR || path.join(HOME_DIR, '.sequential-vfs');
  const ZELLOUS_DATA_DIR = config.zellouDataDir || process.env.ZELLOUS_DATA || path.join(HOME_DIR, '.zellous-data');

  await fs.ensureDir(STATEKIT_DIR);
  await fs.ensureDir(WORK_DIR);
  await fs.ensureDir(path.join(STATEKIT_DIR, 'layers'));
  await fs.ensureDir(VFS_DIR);
  await fs.ensureDir(ZELLOUS_DATA_DIR);

  console.log('✓ Directories initialized');
  console.log(`  StateKit: ${STATEKIT_DIR}`);
  console.log(`  VFS: ${VFS_DIR}`);
  console.log(`  Zellous: ${ZELLOUS_DATA_DIR}`);

  return { STATEKIT_DIR, WORK_DIR, VFS_DIR, ZELLOUS_DATA_DIR };
}

export function loadStateKit() {
  const sequentialMachinePath = path.join(__dirname, '../../sequential-machine');

  let resolvedMachinePath;
  try {
    resolvedMachinePath = fs.realpathSync(sequentialMachinePath);
  } catch (err) {
    console.error('Failed to resolve sequential-machine path:', err.message);
    throw createServerError('Cannot initialize StateKit: sequential-machine directory not found or inaccessible', err);
  }

  if (!resolvedMachinePath.includes('sequential-machine')) {
    throw createForbiddenError('Invalid sequential-machine path: potential symlink attack detected');
  }

  let StateKit;
  try {
    ({ StateKit } = require(resolvedMachinePath));
  } catch (err) {
    console.error('Failed to load StateKit from:', resolvedMachinePath);
    throw createServerError(`Cannot load StateKit: ${err.message}`, err);
  }

  return StateKit;
}

export async function initializeStateKit(StateKit, statekitDir, workDir) {
  const kit = new StateKit({
    stateDir: statekitDir,
    workdir: workDir
  });

  const status = await kit.status();
  console.log(`✓ StateKit initialized (${status.added.length + status.modified.length + status.deleted.length} uncommitted changes)`);

  return kit;
}

export function validateEnvironment() {
  try {
    validator.validate(process.env, true);
    console.log('✓ Environment configuration validated');
    return validator.getAll();
  } catch (err) {
    console.error('❌ Environment validation failed:', err.message);
    process.exit(1);
  }
}
