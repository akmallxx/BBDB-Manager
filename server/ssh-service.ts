import { Client as SSHClient, type ConnectConfig, type ClientChannel } from 'ssh2';
import type { WebSocket, WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface SshConnectionConfig {
  host: string;
  port?: number;
  username: string;
  authMethod?: 'password' | 'key';
  password?: string;
  keyFile?: string;
  passphrase?: string;
}

export function normalizeSshConfig(
  conn?: Record<string, any> | null,
  fallbackConfig?: Partial<SshConnectionConfig> | null
): SshConnectionConfig {
  const host = (fallbackConfig?.host || conn?.ssh_host || conn?.host || '').trim();
  const port = Number(fallbackConfig?.port || conn?.ssh_port || conn?.port) || 22;
  const username = (fallbackConfig?.username || conn?.ssh_user || conn?.username || 'root').trim();
  const authMethod = (fallbackConfig?.authMethod || conn?.ssh_auth_method) === 'key' ? 'key' : 'password';
  const password = fallbackConfig?.password || conn?.ssh_password || conn?.password || '';
  const keyFile = fallbackConfig?.keyFile || conn?.ssh_key_file || conn?.ssh_key || '';
  const passphrase = fallbackConfig?.passphrase || conn?.ssh_key_passphrase || conn?.ssh_passphrase || '';

  return {
    host,
    port,
    username,
    authMethod,
    password,
    keyFile,
    passphrase
  };
}

export function buildSshConfig(params: SshConnectionConfig): ConnectConfig {
  const host = params.host || 'localhost';
  const port = Number(params.port) || 22;
  const username = params.username || 'root';

  const config: ConnectConfig = {
    host,
    port,
    username,
    readyTimeout: 20000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 6,
    algorithms: {
      serverHostKey: [
        'ssh-ed25519',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
        'rsa-sha2-512',
        'rsa-sha2-256',
        'ssh-rsa'
      ]
    }
  };

  if (params.authMethod === 'key' || params.keyFile) {
    if (!params.keyFile) {
      throw new Error('SSH Key authentication requested but no private key file provided.');
    }
    const resolvedKey = params.keyFile.startsWith('~')
      ? path.join(os.homedir(), params.keyFile.slice(1))
      : params.keyFile;

    if (!fs.existsSync(resolvedKey)) {
      throw new Error(`SSH Private key file not found: ${params.keyFile}`);
    }

    config.privateKey = fs.readFileSync(resolvedKey);
    if (params.passphrase) {
      config.passphrase = params.passphrase;
    }
  } else {
    config.password = params.password || '';
  }

  return config;
}

export function createSshClient(config: SshConnectionConfig): Promise<SSHClient> {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    let isSettled = false;

    client.on('ready', () => {
      if (!isSettled) {
        isSettled = true;
        resolve(client);
      }
    });

    client.on('error', (err: any) => {
      if (!isSettled) {
        isSettled = true;
        let enhancedMsg = err.message || 'SSH connection error';
        if (err.code === 'ECONNRESET' || err.message?.includes('ECONNRESET')) {
          enhancedMsg = `Connection reset by peer (ECONNRESET) on ${config.host}:${config.port || 22}. Target host or tunnel proxy closed the socket before SSH handshake. (If using Cloudflare Tunnel, verify that the remote tunnel origin is active and not returning Error 1033).`;
        } else if (err.level === 'client-authentication') {
          enhancedMsg = `Authentication failed for user "${config.username}". Please verify your credentials or private key.`;
        } else if (err.code === 'ECONNREFUSED') {
          enhancedMsg = `Connection refused (ECONNREFUSED) on ${config.host}:${config.port || 22}. No SSH server or tunnel is listening on this port.`;
        }
        const error = new Error(enhancedMsg);
        (error as any).code = err.code;
        (error as any).status = 400;
        reject(error);
      }
    });

    client.on('close', () => {
      if (!isSettled) {
        isSettled = true;
        const error = new Error(`SSH connection to ${config.host}:${config.port || 22} closed before handshake completed.`);
        (error as any).status = 400;
        reject(error);
      }
    });

    try {
      const connectConfig = buildSshConfig(config);
      client.connect(connectConfig);
    } catch (err) {
      isSettled = true;
      reject(err);
    }
  });
}

/**
 * Attaches the SSH Terminal WebSocket route to the WSS server.
 * Handles interactive PTY terminal streams over WebSocket.
 */
export function setupSshTerminalWebSocket(wss: WebSocketServer, getConnectionById?: (id: string) => any) {
  wss.on('connection', (ws: WebSocket, req) => {
    let sshClient: SSHClient | null = null;
    let stream: ClientChannel | null = null;
    let isClosed = false;

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      try {
        if (stream) stream.end();
      } catch {}
      try {
        if (sshClient) sshClient.end();
      } catch {}
      stream = null;
      sshClient = null;
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);

    ws.on('message', async (messageData) => {
      try {
        const raw = messageData.toString();
        // Check if message is a JSON command
        if (raw.startsWith('{')) {
          const parsed = JSON.parse(raw);

          // Heartbeat ping/pong to prevent idle disconnection
          if (parsed.type === 'ping') {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'pong' }));
            }
            return;
          }

          // 1. Initial Handshake / Connect command
          if (parsed.type === 'init') {
            let config: SshConnectionConfig | null = null;

            if (parsed.connectionId && getConnectionById) {
              const conn = getConnectionById(parsed.connectionId);
              if (conn) {
                config = normalizeSshConfig(conn, parsed.config);
              }
            }

            if (!config && parsed.config) {
              config = normalizeSshConfig(null, parsed.config);
            }

            if (!config || !config.host || !config.username) {
              ws.send(JSON.stringify({ type: 'error', message: 'Missing SSH connection credentials (host and username required).' }));
              return;
            }

            ws.send(JSON.stringify({ type: 'status', status: 'connecting', message: `Connecting to ${config.username}@${config.host}:${config.port || 22}...` }));

            try {
              sshClient = await createSshClient(config);

              sshClient.on('error', (err) => {
                ws.send(JSON.stringify({ type: 'error', message: `SSH Client Error: ${err.message}` }));
              });

              sshClient.on('close', () => {
                ws.send(JSON.stringify({ type: 'status', status: 'disconnected', message: 'SSH session closed by remote host.' }));
                cleanup();
              });

              // Request interactive PTY Shell
              const cols = parsed.cols || 80;
              const rows = parsed.rows || 24;

              sshClient.shell({ term: 'xterm-256color', cols, rows }, (err, ptyStream) => {
                if (err) {
                  ws.send(JSON.stringify({ type: 'error', message: `Failed to spawn remote shell: ${err.message}` }));
                  cleanup();
                  return;
                }

                stream = ptyStream;
                ws.send(JSON.stringify({ type: 'status', status: 'connected', message: 'Remote SSH CLI Session Established' }));

                stream.on('data', (chunk: Buffer) => {
                  if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'stdout', data: chunk.toString('utf-8') }));
                  }
                });

                stream.on('close', (code: any, signal: any) => {
                  if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ type: 'status', status: 'closed', message: `Process exited with code ${code || 0} (${signal || 'NONE'})` }));
                  }
                  cleanup();
                });
              });
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'error', message: `Failed to connect to SSH host: ${err.message}` }));
              cleanup();
            }
            return;
          }

          // 2. Window Resize command
          if (parsed.type === 'resize' && stream) {
            try {
              const cols = Math.max(10, Math.min(Number(parsed.cols) || 80, 500));
              const rows = Math.max(5, Math.min(Number(parsed.rows) || 24, 200));
              stream.setWindow(rows, cols, 0, 0);
            } catch (err) {
              console.warn('[SSH WS] Resize error:', err);
            }
            return;
          }

          // 3. Terminal Stdin data
          if (parsed.type === 'stdin' && stream) {
            stream.write(parsed.data);
            return;
          }
        }

        // Direct raw input stream fallback
        if (stream) {
          stream.write(raw);
        }
      } catch (err: any) {
        console.error('[SSH-WS] Message processing error:', err);
      }
    });
  });
}
