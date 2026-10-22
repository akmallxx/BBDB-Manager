import fs from 'fs';
import path from 'path';
import os from 'os';
import { parsePermissions, SftpFileItem } from './sftp-service';

/**
 * List files and directories on the local machine
 */
export async function listLocalDirectory(targetPath?: string): Promise<{ currentPath: string; items: SftpFileItem[] }> {
  let resolved = targetPath && targetPath.trim() ? path.resolve(targetPath.trim()) : os.homedir();
  if (!fs.existsSync(resolved)) {
    resolved = os.homedir();
  }

  const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
  const items: SftpFileItem[] = [];

  for (const entry of entries) {
    const fullPath = path.join(resolved, entry.name);
    try {
      const stat = await fs.promises.lstat(fullPath);
      let type: 'file' | 'directory' | 'symlink' | 'other' = 'file';
      if (stat.isDirectory()) type = 'directory';
      else if (stat.isSymbolicLink()) type = 'symlink';

      items.push({
        name: entry.name,
        path: fullPath,
        size: stat.size || 0,
        type,
        permissions: parsePermissions(stat.mode),
        mode: stat.mode,
        mtime: stat.mtimeMs,
        owner: stat.uid,
        group: stat.gid
      });
    } catch {
      // Ignore unreadable/permission-denied items
    }
  }

  // Sort: directories first, then alphabetical
  items.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return { currentPath: resolved, items };
}

/**
 * Create directory on local machine
 */
export async function createLocalDirectory(dirPath: string): Promise<void> {
  const resolved = path.resolve(dirPath);
  await fs.promises.mkdir(resolved, { recursive: true });
}

/**
 * Delete a file or directory on local machine
 */
export async function deleteLocalItem(targetPath: string): Promise<void> {
  const resolved = path.resolve(targetPath);
  await fs.promises.rm(resolved, { recursive: true, force: true });
}

/**
 * Rename/move a file or directory on local machine
 */
export async function renameLocalItem(oldPath: string, newPath: string): Promise<void> {
  const resolvedOld = path.resolve(oldPath);
  const resolvedNew = path.resolve(newPath);
  await fs.promises.rename(resolvedOld, resolvedNew);
}
