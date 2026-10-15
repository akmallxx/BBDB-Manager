import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

function findBun(): string | null {
  if (process.env.BUN_PATH && fs.existsSync(process.env.BUN_PATH)) {
    return process.env.BUN_PATH;
  }
  try {
    const cmd = process.platform === 'win32' ? 'where bun' : 'which bun';
    const which = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).split(/\r?\n/)[0]?.trim();
    if (which && fs.existsSync(which)) return which;
  } catch {
    // ignore
  }

  // Check if bun is executable directly in PATH
  try {
    execSync('bun --version', { stdio: 'ignore' });
    return 'bun';
  } catch {
    // ignore
  }

  const commonPaths = [
    path.join(os.homedir(), '.bun/bin/bun'),
    path.join(os.homedir(), '.bun/bin/bun.exe'),
    '/usr/local/bin/bun',
    '/usr/bin/bun',
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

function getTargetTriple(): string {
  try {
    const rustcVv = execSync('rustc -Vv', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const match = rustcVv.match(/^host:\s*(.+)$/m);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch {
    // rustc not in path or failed
  }

  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch;
  if (process.platform === 'linux') {
    return `${arch}-unknown-linux-gnu`;
  } else if (process.platform === 'darwin') {
    return `${arch}-apple-darwin`;
  } else if (process.platform === 'win32') {
    return `${arch}-pc-windows-msvc`;
  }
  return `${arch}-unknown-linux-gnu`;
}

async function main() {
  console.log('[Build Server] Starting standalone server compilation...');
  const bunPath = findBun();
  if (!bunPath) {
    console.error('[Build Server] Error: Bun is required to compile the standalone server binary.');
    console.error('Please install Bun: curl -fsSL https://bun.sh/install | bash');
    process.exit(1);
  }

  const triple = getTargetTriple();
  console.log(`[Build Server] Target triple: ${triple}`);
  console.log(`[Build Server] Using Bun from: ${bunPath}`);

  const binariesDir = path.resolve('src-tauri/binaries');
  fs.mkdirSync(binariesDir, { recursive: true });

  const ext = process.platform === 'win32' ? '.exe' : '';
  const sidecarBinaryName = `bbdb-server-${triple}${ext}`;
  const sidecarBinaryPath = path.join(binariesDir, sidecarBinaryName);

  console.log(`[Build Server] Compiling server.ts -> ${sidecarBinaryPath}...`);
  try {
    execSync(
      `"${bunPath}" build --compile --external vite --external cpu-features ./server.ts --outfile "${sidecarBinaryPath}"`,
      { stdio: 'inherit' }
    );
    if (process.platform !== 'win32') {
      fs.chmodSync(sidecarBinaryPath, 0o755);
    }
    console.log(`[Build Server] Successfully compiled ${sidecarBinaryName} (${(fs.statSync(sidecarBinaryPath).size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (err) {
    console.error('[Build Server] Compilation failed:', err);
    process.exit(1);
  }

  // Also copy to release and debug folders if they exist for convenient direct binary testing
  const targets = [
    path.resolve('src-tauri/target/release'),
    path.resolve('src-tauri/target/debug')
  ];

  for (const t of targets) {
    if (fs.existsSync(t)) {
      const targetServerPath = path.join(t, `bbdb-server${ext}`);
      try {
        fs.copyFileSync(sidecarBinaryPath, targetServerPath);
        if (process.platform !== 'win32') {
          fs.chmodSync(targetServerPath, 0o755);
        }
        console.log(`[Build Server] Copied server binary to ${targetServerPath}`);
      } catch (e) {
        console.warn(`[Build Server] Note: could not copy to ${t}:`, e);
      }
    }
  }

  console.log('[Build Server] Done.');
}

main().catch((err) => {
  console.error('[Build Server] Unexpected error:', err);
  process.exit(1);
});
