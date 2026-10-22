import fs from 'fs';
import path from 'path';
import { Client as SSHClient, type SFTPWrapper } from 'ssh2';
import { createSshClient, type SshConnectionConfig } from './ssh-service';
import type { Stats } from 'ssh2';

export interface SftpFileItem {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'directory' | 'symlink' | 'other';
  permissions: string;
  mode: number;
  mtime: number;
  owner?: number;
  group?: number;
}

interface SftpSessionEntry {
  client: SSHClient;
  sftp: SFTPWrapper;
  lastActive: number;
}

// In-memory pool of active SFTP sessions indexed by sessionId/connectionId
const activeSftpSessions = new Map<string, SftpSessionEntry>();

// Auto-cleanup idle SFTP sessions after 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of activeSftpSessions.entries()) {
    if (now - entry.lastActive > 15 * 60 * 1000) {
      try {
        entry.client.end();
      } catch {}
      activeSftpSessions.delete(key);
    }
  }
}, 60000);

export function parsePermissions(mode: number): string {
  const S_IFMT = 0o170000;
  const isDir = (mode & S_IFMT) === 0o040000;
  const isLink = (mode & S_IFMT) === 0o120000;
  const prefix = isDir ? 'd' : isLink ? 'l' : '-';

  const u = [
    (mode & 0o400) ? 'r' : '-',
    (mode & 0o200) ? 'w' : '-',
    (mode & 0o100) ? 'x' : '-',
  ].join('');

  const g = [
    (mode & 0o040) ? 'r' : '-',
    (mode & 0o020) ? 'w' : '-',
    (mode & 0o010) ? 'x' : '-',
  ].join('');

  const o = [
    (mode & 0o004) ? 'r' : '-',
    (mode & 0o002) ? 'w' : '-',
    (mode & 0o001) ? 'x' : '-',
  ].join('');

  return `${prefix}${u}${g}${o}`;
}

export async function getOrCreateSftpSession(sessionKey: string, config: SshConnectionConfig, forceFresh = false): Promise<SFTPWrapper> {
  const existing = activeSftpSessions.get(sessionKey);
  if (existing && !forceFresh) {
    const sock = (existing.client as any)._sock;
    if (sock && !sock.destroyed && sock.readable && sock.writable) {
      existing.lastActive = Date.now();
      return existing.sftp;
    }
    // Socket was closed or destroyed; delete and recreate
    try { existing.client.end(); } catch {}
    activeSftpSessions.delete(sessionKey);
  } else if (existing && forceFresh) {
    try { existing.client.end(); } catch {}
    activeSftpSessions.delete(sessionKey);
  }

  const client = await createSshClient(config);

  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((err, sftpWrapper) => {
      if (err) {
        try { client.end(); } catch {}
        return reject(err);
      }
      resolve(sftpWrapper);
    });
  });

  client.on('close', () => {
    activeSftpSessions.delete(sessionKey);
  });

  client.on('error', () => {
    activeSftpSessions.delete(sessionKey);
  });

  activeSftpSessions.set(sessionKey, {
    client,
    sftp,
    lastActive: Date.now()
  });

  return sftp;
}

export async function withSftpSession<T>(
  sessionKey: string,
  config: SshConnectionConfig,
  operation: (sftp: SFTPWrapper) => Promise<T>
): Promise<T> {
  try {
    const sftp = await getOrCreateSftpSession(sessionKey, config);
    return await operation(sftp);
  } catch (err: any) {
    const isConnErr = err.code === 'ECONNRESET' ||
      err.message?.includes('ECONNRESET') ||
      err.message?.includes('closed') ||
      err.message?.includes('No response') ||
      err.message?.includes('Channel open failure') ||
      err.message?.includes('read ECONNRESET');
    if (isConnErr) {
      console.warn(`[SFTP] Retrying operation with fresh session for ${sessionKey} due to: ${err.message}`);
      const freshSftp = await getOrCreateSftpSession(sessionKey, config, true);
      return await operation(freshSftp);
    }
    throw err;
  }
}

export function closeSftpSession(sessionKey: string) {
  const existing = activeSftpSessions.get(sessionKey);
  if (existing) {
    try {
      existing.client.end();
    } catch {}
    activeSftpSessions.delete(sessionKey);
  }
}

export function listRemoteDirectory(sftp: SFTPWrapper, targetPath: string): Promise<{ currentPath: string; items: SftpFileItem[] }> {
  return new Promise((resolve, reject) => {
    // Resolve home or default directory if target is empty or ~
    const normalizedPath = targetPath && targetPath.trim() ? targetPath.trim() : '.';

    sftp.realpath(normalizedPath, (err, resolvedRemotePath) => {
      if (err) {
        return reject(new Error(`Failed to resolve path "${normalizedPath}": ${err.message}`));
      }

      sftp.readdir(resolvedRemotePath, (readErr, list) => {
        if (readErr) {
          return reject(new Error(`Failed to read directory "${resolvedRemotePath}": ${readErr.message}`));
        }

        const items: SftpFileItem[] = list.map((item) => {
          const mode = item.attrs.mode || 0;
          const S_IFMT = 0o170000;
          const isDir = (mode & S_IFMT) === 0o040000;
          const isLink = (mode & S_IFMT) === 0o120000;

          let type: 'file' | 'directory' | 'symlink' | 'other' = 'file';
          if (isDir) type = 'directory';
          else if (isLink) type = 'symlink';

          const itemPath = resolvedRemotePath.endsWith('/')
            ? `${resolvedRemotePath}${item.filename}`
            : `${resolvedRemotePath}/${item.filename}`;

          return {
            name: item.filename,
            path: itemPath,
            size: item.attrs.size || 0,
            type,
            permissions: parsePermissions(mode),
            mode,
            mtime: (item.attrs.mtime || 0) * 1000,
            owner: item.attrs.uid,
            group: item.attrs.gid,
          };
        });

        // Sort: directories first, then alphabetical
        items.sort((a, b) => {
          if (a.type === 'directory' && b.type !== 'directory') return -1;
          if (a.type !== 'directory' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });

        resolve({ currentPath: resolvedRemotePath, items });
      });
    });
  });
}

export function readRemoteFile(sftp: SFTPWrapper, filePath: string, maxBytes = 5 * 1024 * 1024): Promise<{ content: string; size: number }> {
  return new Promise((resolve, reject) => {
    sftp.stat(filePath, (statErr, stats) => {
      if (statErr) return reject(statErr);
      if (stats.size > maxBytes) {
        return reject(new Error(`File size (${(stats.size / 1024 / 1024).toFixed(2)} MB) exceeds maximum preview limit (${maxBytes / 1024 / 1024} MB)`));
      }

      const stream = sftp.createReadStream(filePath, { encoding: 'utf-8' });
      let data = '';

      stream.on('data', (chunk: any) => {
        data += chunk;
      });

      stream.on('end', () => {
        resolve({ content: data, size: stats.size });
      });

      stream.on('error', (err: any) => {
        reject(err);
      });
    });
  });
}

export function writeRemoteFile(sftp: SFTPWrapper, filePath: string, content: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(filePath, { encoding: typeof content === 'string' ? 'utf-8' : undefined });

    stream.on('close', () => {
      resolve();
    });

    stream.on('error', (err: any) => {
      reject(err);
    });

    stream.end(content);
  });
}

export function makeRemoteDirectory(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export function deleteRemoteItem(sftp: SFTPWrapper, remotePath: string, isDir: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isDir) {
      sftp.rmdir(remotePath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    } else {
      sftp.unlink(remotePath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    }
  });
}

export function renameRemoteItem(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export function chmodRemoteItem(sftp: SFTPWrapper, remotePath: string, mode: number): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.chmod(remotePath, mode, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

/**
 * High-speed parallel transfer of a single local file to remote SFTP using fastPut
 */
export async function transferLocalFileToRemote(sftp: SFTPWrapper, localFilePath: string, remoteDestPath: string): Promise<void> {
  const stat = await fs.promises.stat(localFilePath);
  if (stat.size === 0) {
    return writeRemoteFile(sftp, remoteDestPath, Buffer.alloc(0));
  }

  return new Promise((resolve, reject) => {
    const options = {
      concurrency: 64,
      chunkSize: 32768,
      mode: stat.mode,
    };

    (sftp as any).fastPut(localFilePath, remoteDestPath, options, (err: any) => {
      if (err) {
        return reject(new Error(`Failed to upload "${path.basename(localFilePath)}" to remote: ${err.message}`));
      }
      resolve();
    });
  });
}

/**
 * High-speed parallel transfer of a single remote SFTP file to local filesystem using fastGet
 */
export function transferRemoteFileToLocal(sftp: SFTPWrapper, remoteFilePath: string, localDestPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.stat(remoteFilePath, (statErr, stats) => {
      if (statErr) {
        return reject(new Error(`Failed to stat remote file "${remoteFilePath}": ${statErr.message}`));
      }

      if (stats.size === 0) {
        fs.promises.writeFile(localDestPath, Buffer.alloc(0))
          .then(() => resolve())
          .catch((err) => reject(new Error(`Failed to create local file "${localDestPath}": ${err.message}`)));
        return;
      }

      const options = {
        concurrency: 64,
        chunkSize: 32768,
      };

      (sftp as any).fastGet(remoteFilePath, localDestPath, options, (err: any) => {
        if (err) {
          try {
            if (fs.existsSync(localDestPath)) fs.unlinkSync(localDestPath);
          } catch {}
          return reject(new Error(`Failed to download "${path.basename(remoteFilePath)}" to local: ${err.message}`));
        }
        resolve();
      });
    });
  });
}

/**
 * Recursively transfer local file or directory to remote SFTP destination directory
 */
export async function transferLocalItemToRemote(sftp: SFTPWrapper, localPath: string, remoteDir: string): Promise<void> {
  const stat = await fs.promises.stat(localPath);
  const itemName = path.basename(path.resolve(localPath));
  const cleanRemoteDir = remoteDir.endsWith('/') && remoteDir.length > 1 ? remoteDir.slice(0, -1) : remoteDir;
  const targetRemotePath = cleanRemoteDir === '/' ? `/${itemName}` : `${cleanRemoteDir}/${itemName}`;

  if (stat.isDirectory()) {
    try {
      await makeRemoteDirectory(sftp, targetRemotePath);
    } catch {
      // directory might already exist, continue
    }
    const children = await fs.promises.readdir(localPath);
    for (const child of children) {
      await transferLocalItemToRemote(sftp, path.join(localPath, child), targetRemotePath);
    }
  } else {
    await transferLocalFileToRemote(sftp, localPath, targetRemotePath);
  }
}

/**
 * Recursively transfer remote SFTP file or directory to local destination directory
 */
export async function transferRemoteItemToLocal(sftp: SFTPWrapper, remotePath: string, localDir: string): Promise<void> {
  const stat = await new Promise<Stats>((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err) return reject(err);
      resolve(stats);
    });
  });

  const cleanRemotePath = remotePath.endsWith('/') && remotePath.length > 1 ? remotePath.slice(0, -1) : remotePath;
  const itemName = path.basename(cleanRemotePath);
  const targetLocalPath = path.join(localDir, itemName);

  const S_IFMT = 0o170000;
  const isDir = (stat.mode & S_IFMT) === 0o040000;
  if (isDir) {
    await fs.promises.mkdir(targetLocalPath, { recursive: true });
    const list = await new Promise<any[]>((resolve, reject) => {
      sftp.readdir(remotePath, (err, items) => {
        if (err) return reject(err);
        resolve(items);
      });
    });
    for (const child of list) {
      if (child.filename === '.' || child.filename === '..') continue;
      const childRemotePath = remotePath.endsWith('/') ? `${remotePath}${child.filename}` : `${remotePath}/${child.filename}`;
      await transferRemoteItemToLocal(sftp, childRemotePath, targetLocalPath);
    }
  } else {
    await transferRemoteFileToLocal(sftp, remotePath, targetLocalPath);
  }
}
