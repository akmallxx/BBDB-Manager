import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { Client as SSHClient, type ConnectConfig } from 'ssh2';
import {
  getAdapter,
  createAdapter,
  getDefaultDatabase,
  getDefaultSchema,
  type DatabaseDriverAdapter,
  type TransactionSession,
  type ColumnMeta
} from './server/adapters/index.ts';

const { Pool, Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for testing TCP socket connectivity (SSH tunnels, MySQL, MSSQL reachability)
function testTcpConnection(host: string, port: number, timeoutMs = 4000): Promise<{ ok: boolean; banner?: string; error?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let banner = '';
    let isResolved = false;

    socket.setTimeout(timeoutMs);

    socket.on('data', (chunk) => {
      banner += chunk.toString();
    });

    socket.on('connect', () => {
      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          socket.destroy();
          resolve({ ok: true, banner: banner.trim() });
        }
      }, 200);
    });

    socket.on('timeout', () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ ok: false, error: `Connection timed out after ${timeoutMs}ms` });
      }
    });

    socket.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ ok: false, error: err.message });
      }
    });

    socket.connect(port, host);
  });
}

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const APP_NAME = process.env.VITE_APP_NAME || process.env.APP_NAME || 'BBDB Manager';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, status: 'healthy', app: APP_NAME });
});

// Ensure data directory exists
const isBunCompiled = typeof process !== 'undefined' && (Boolean(process.execPath && process.execPath.includes('bbdb-server')) || __dirname.startsWith('/$bunfs'));
const defaultDataDir = isBunCompiled
  ? path.join(os.homedir(), '.bbdb-manager')
  : path.join(__dirname, 'data');
let dataDir = process.env.BBDB_DATA_DIR || defaultDataDir;
try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.accessSync(dataDir, fs.constants.W_OK);
} catch {
  // If not writable (e.g. installed under /usr/), fallback to ~/.bbdb-manager
  dataDir = path.join(os.homedir(), '.bbdb-manager');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// 1. JSON Theme Configuration
const themeConfigPath = path.join(dataDir, 'theme-config.json');
if (!fs.existsSync(themeConfigPath)) {
  fs.writeFileSync(
    themeConfigPath,
    JSON.stringify({ theme: 'dark', fontSize: 13, autocommitDefault: true }, null, 2),
    'utf-8'
  );
}

function getThemeConfig() {
  try {
    const raw = fs.readFileSync(themeConfigPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { theme: 'dark', fontSize: 13, autocommitDefault: true };
  }
}

function saveThemeConfig(config: Record<string, unknown>) {
  fs.writeFileSync(themeConfigPath, JSON.stringify(config, null, 2), 'utf-8');
}

// 2. SQLite Database for Studio Connections & Query History
const dbPath = path.join(dataDir, 'database-studio.sqlite');
const studioDb = new DatabaseSync(dbPath);

// Initialize SQLite tables
studioDb.exec(`
  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    driver TEXT NOT NULL,
    host TEXT,
    port INTEGER,
    username TEXT,
    password TEXT,
    default_database TEXT,
    ssl INTEGER DEFAULT 0,
    ssh_enabled INTEGER DEFAULT 0,
    ssh_host TEXT,
    ssh_port INTEGER DEFAULT 22,
    ssh_user TEXT,
    ssh_auth_method TEXT DEFAULT 'password',
    ssh_password TEXT,
    ssh_key_file TEXT,
    ssh_key_passphrase TEXT,
    color TEXT DEFAULT '#06b6d4',
    is_readonly INTEGER DEFAULT 0,
    environment TEXT DEFAULT 'development',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS query_history (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    query_text TEXT NOT NULL,
    status TEXT NOT NULL,
    row_count INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL
  );
`);

// Add migrations for older DB schemas
try { studioDb.exec('ALTER TABLE connections ADD COLUMN ssh_password TEXT;'); } catch { }
try { studioDb.exec('ALTER TABLE connections ADD COLUMN ssh_key_file TEXT;'); } catch { }
try { studioDb.exec('ALTER TABLE connections ADD COLUMN ssh_key_passphrase TEXT;'); } catch { }
try { studioDb.exec("ALTER TABLE connections ADD COLUMN environment TEXT DEFAULT 'development';"); } catch { }

function saveQueryHistory(
  connectionId: string,
  queryText: string,
  status: 'success' | 'error',
  rowCount: number = 0,
  durationMs: number = 0,
  errorMessage: string | null = null
) {
  try {
    const id = `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const created_at = new Date().toISOString();
    const insertHistory = studioDb.prepare(`
      INSERT INTO query_history (id, connection_id, query_text, status, row_count, duration_ms, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertHistory.run(
      id,
      connectionId || 'unknown',
      queryText || '',
      status || 'success',
      rowCount ?? 0,
      durationMs ?? 0,
      errorMessage ?? null,
      created_at
    );
  } catch (err) {
    console.error('Failed to log query history:', err);
  }
}

// 3. SSH Tunnel Management & PostgreSQL Real Connection Pool Manager
interface SshTunnelParams {
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_auth_method: 'password' | 'key';
  ssh_password?: string;
  ssh_key_file?: string;
  ssh_key_passphrase?: string;
  target_host: string;
  target_port: number;
}

interface SshTunnelInstance {
  localPort: number;
  server: net.Server;
  sshClient: SSHClient;
  close: () => void;
}

const activeTunnels = new Map<string, SshTunnelInstance>();

function createSshTunnel(params: SshTunnelParams): Promise<SshTunnelInstance> {
  return new Promise((resolve, reject) => {
    const ssh = new SSHClient();
    let isResolved = false;

    const cleanup = () => {
      try { ssh.end(); } catch {}
    };

    const timer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        reject(new Error(`SSH connection timed out after 10s to ${params.ssh_host}:${params.ssh_port}`));
      }
    }, 10000);

    ssh.on('ready', () => {
      const server = net.createServer((sock) => {
        ssh.forwardOut(
          '127.0.0.1',
          sock.remotePort || 0,
          params.target_host || '127.0.0.1',
          params.target_port || 5432,
          (err, stream) => {
            if (err) {
              console.error('[SSH Tunnel] ForwardOut error:', err.message);
              sock.destroy(err);
              return;
            }
            sock.pipe(stream).pipe(sock);
            stream.on('error', () => sock.destroy());
            sock.on('error', () => stream.destroy());
          }
        );
      });

      server.on('error', (err) => {
        if (!isResolved) {
          clearTimeout(timer);
          isResolved = true;
          cleanup();
          reject(err);
        }
      });

      server.listen(0, '127.0.0.1', () => {
        clearTimeout(timer);
        if (!isResolved) {
          isResolved = true;
          const address = server.address() as net.AddressInfo;
          const localPort = address.port;
          const close = () => {
            try { server.close(); } catch {}
            try { ssh.end(); } catch {}
          };
          resolve({ localPort, server, sshClient: ssh, close });
        }
      });
    });

    ssh.on('error', (err) => {
      if (!isResolved) {
        clearTimeout(timer);
        isResolved = true;
        cleanup();
        reject(err);
      }
    });

    const connectConfig: ConnectConfig = {
      host: params.ssh_host,
      port: params.ssh_port || 22,
      username: params.ssh_user,
      readyTimeout: 10000,
      keepaliveInterval: 10000,
    };

    if (params.ssh_auth_method === 'key') {
      if (!params.ssh_key_file) {
        clearTimeout(timer);
        return reject(new Error('SSH Key file path is required'));
      }
      const resolvedKey = params.ssh_key_file.startsWith('~')
        ? path.join(os.homedir(), params.ssh_key_file.slice(1))
        : params.ssh_key_file;
      if (!fs.existsSync(resolvedKey)) {
        clearTimeout(timer);
        return reject(new Error(`SSH Private key file not found: ${params.ssh_key_file}`));
      }
      try {
        connectConfig.privateKey = fs.readFileSync(resolvedKey);
        if (params.ssh_key_passphrase) {
          connectConfig.passphrase = params.ssh_key_passphrase;
        }
      } catch (e: any) {
        clearTimeout(timer);
        return reject(new Error(`Failed to read SSH private key: ${e.message}`));
      }
    } else {
      connectConfig.password = params.ssh_password || '';
    }

    ssh.connect(connectConfig);
  });
}

function closeTunnel(connId: string) {
  if (activeTunnels.has(connId)) {
    const t = activeTunnels.get(connId);
    try { t?.close(); } catch {}
    activeTunnels.delete(connId);
  }
  for (const [key, session] of activeSessions.entries()) {
    if (session.connectionId === connId) {
      try { session.release(); } catch {}
      activeSessions.delete(key);
    }
  }
}

async function getOrCreateTunnel(conn: Record<string, unknown>): Promise<SshTunnelInstance> {
  const connId = (conn.id as string) || 'default';
  const existing = activeTunnels.get(connId);
  if (existing) {
    if (existing.server.listening) {
      return existing;
    }
    try { existing.close(); } catch {}
    activeTunnels.delete(connId);
  }

  const tunnel = await createSshTunnel({
    ssh_host: (conn.ssh_host as string) || 'localhost',
    ssh_port: Number(conn.ssh_port) || 22,
    ssh_user: (conn.ssh_user as string) || 'root',
    ssh_auth_method: ((conn.ssh_auth_method as string) || 'password') as 'password' | 'key',
    ssh_password: (conn.ssh_password as string) || '',
    ssh_key_file: (conn.ssh_key_file as string) || '',
    ssh_key_passphrase: (conn.ssh_key_passphrase as string) || '',
    target_host: (conn.host as string) || 'localhost',
    target_port: Number(conn.port) || (conn.driver === 'mysql' ? 3306 : conn.driver === 'sqlserver' ? 1433 : 5432),
  });

  tunnel.sshClient.on('close', () => {
    activeTunnels.delete(connId);
    try { tunnel.server.close(); } catch {}
  });
  tunnel.sshClient.on('error', () => {
    activeTunnels.delete(connId);
    try { tunnel.server.close(); } catch {}
  });

  activeTunnels.set(connId, tunnel);
  return tunnel;
}

type TableColumn = ColumnMeta;

interface CompletedTransaction {
  id: string;
  connectionId: string;
  database: string;
  startedAt: string;
  endedAt: string;
  action: 'committed' | 'rolled_back';
  durationMs: number;
  statementCount: number;
  statements: Array<{
    id: string;
    query: string;
    timestamp: string;
    duration_ms: number;
    rowCount: number;
    status: 'pending' | 'success' | 'error';
    errorMessage?: string;
  }>;
}

const activeSessions = new Map<string, TransactionSession>();
const transactionHistoryList: CompletedTransaction[] = [];

async function getOrCreateSession(
  adapter: DatabaseDriverAdapter,
  connectionId: string,
  database: string,
  sessionKey: string
): Promise<TransactionSession> {
  let session = activeSessions.get(sessionKey);
  if (!session) {
    session = await adapter.createTransactionSession(sessionKey);
    activeSessions.set(sessionKey, session);
  }
  return session;
}

function getConnectionRecord(connId?: string): Record<string, unknown> {
  if (connId) {
    const row = studioDb.prepare('SELECT * FROM connections WHERE id = ?').get(connId);
    if (row) {
      return {
        ...(row as Record<string, unknown>),
        environment: ((row as Record<string, unknown>).environment as string) || 'development'
      };
    }
  }
  const defaultRow = studioDb.prepare('SELECT * FROM connections LIMIT 1').get();
  if (defaultRow) {
    return {
      ...(defaultRow as Record<string, unknown>),
      environment: ((defaultRow as Record<string, unknown>).environment as string) || 'development'
    };
  }

  return {
    id: connId || 'default',
    name: 'New Connection',
    driver: 'postgresql',
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    password: '',
    default_database: 'postgres',
    ssl: 0,
    environment: 'development'
  };
}

// ==========================================
// REST API ROUTES
// ==========================================

// 1. Theme Configuration
app.get('/api/theme', (_req, res) => {
  res.json(getThemeConfig());
});

app.post('/api/theme', (req, res) => {
  saveThemeConfig(req.body);
  res.json({ success: true, theme: req.body });
});

// 2. Saved Database Connections (SQLite)
app.get('/api/connections', (_req, res) => {
  try {
    const stmt = studioDb.prepare('SELECT * FROM connections ORDER BY created_at DESC');
    const connections = stmt.all();
    res.json(connections);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.post('/api/connections', (req, res) => {
  try {
    const {
      name,
      driver = 'postgresql',
      host = 'localhost',
      port = 5432,
      username = '',
      password = '',
      default_database = 'postgres',
      ssl = 0,
      ssh_enabled = 0,
      ssh_host = '',
      ssh_port = 22,
      ssh_user = '',
      ssh_auth_method = 'password',
      ssh_password = '',
      ssh_key_file = '',
      ssh_key_passphrase = '',
      color = '#06b6d4',
      is_readonly = 0,
      environment = 'development'
    } = req.body;

    const id = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const created_at = new Date().toISOString();

    const stmt = studioDb.prepare(`
      INSERT INTO connections (
        id, name, driver, host, port, username, password, default_database,
        ssl, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth_method,
        ssh_password, ssh_key_file, ssh_key_passphrase, color, is_readonly, environment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id, name, driver, host, port, username, password, default_database,
      ssl ? 1 : 0, ssh_enabled ? 1 : 0, ssh_host, ssh_port, ssh_user,
      ssh_auth_method, ssh_password, ssh_key_file, ssh_key_passphrase,
      color, is_readonly ? 1 : 0, environment, created_at
    );

    const newConn = studioDb.prepare('SELECT * FROM connections WHERE id = ?').get(id);
    res.status(201).json(newConn);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.put('/api/connections/:id', (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, driver, host, port, username, password, default_database,
      ssl, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth_method,
      ssh_password = '', ssh_key_file = '', ssh_key_passphrase = '',
      color, is_readonly, environment = 'development'
    } = req.body;

    const stmt = studioDb.prepare(`
      UPDATE connections SET
        name = ?, driver = ?, host = ?, port = ?, username = ?, password = ?,
        default_database = ?, ssl = ?, ssh_enabled = ?, ssh_host = ?,
        ssh_port = ?, ssh_user = ?, ssh_auth_method = ?,
        ssh_password = ?, ssh_key_file = ?, ssh_key_passphrase = ?,
        color = ?, is_readonly = ?, environment = ?
      WHERE id = ?
    `);

    stmt.run(
      name, driver, host, port, username, password, default_database,
      ssl ? 1 : 0, ssh_enabled ? 1 : 0, ssh_host, ssh_port, ssh_user,
      ssh_auth_method, ssh_password, ssh_key_file, ssh_key_passphrase,
      color, is_readonly ? 1 : 0, environment, id
    );

    closeTunnel(id);
    const updated = studioDb.prepare('SELECT * FROM connections WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.delete('/api/connections/:id', (req, res) => {
  try {
    const { id } = req.params;
    closeTunnel(id);
    studioDb.prepare('DELETE FROM connections WHERE id = ?').run(id);
    res.json({ success: true, id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Real Connection Test
app.post('/api/connections/test', async (req, res) => {
  const {
    host,
    port,
    driver = 'postgresql',
    username,
    password,
    default_database,
    ssl = 0,
    ssh_enabled = 0,
    ssh_host = '',
    ssh_port = 22,
    ssh_user = '',
    ssh_auth_method = 'password',
    ssh_password = '',
    ssh_key_file = '',
    ssh_key_passphrase = '',
    environment
  } = req.body;

  const startTime = performance.now();
  let testTunnel: SshTunnelInstance | null = null;

  // 1. Establish Real SSH Tunnel if enabled
  if (ssh_enabled) {
    if (!ssh_host || !ssh_user) {
      return res.status(400).json({
        success: false,
        message: 'SSH Tunnel Error: SSH Host and SSH User are required when SSH Tunnel is enabled.'
      });
    }
    if (ssh_auth_method === 'password' && !ssh_password) {
      return res.status(400).json({
        success: false,
        message: 'SSH Tunnel Error: SSH Password is required when using Password authentication.'
      });
    }
    if (ssh_auth_method === 'key') {
      if (!ssh_key_file) {
        return res.status(400).json({
          success: false,
          message: 'SSH Tunnel Error: Private Key File path is required when using Key authentication.'
        });
      }
      const resolvedKey = ssh_key_file.startsWith('~')
        ? path.join(os.homedir(), ssh_key_file.slice(1))
        : ssh_key_file;
      if (!fs.existsSync(resolvedKey)) {
        return res.status(400).json({
          success: false,
          message: `SSH Tunnel Error: Private Key file not found at "${ssh_key_file}".`
        });
      }
    }

    try {
      testTunnel = await createSshTunnel({
        ssh_host: ssh_host as string,
        ssh_port: Number(ssh_port) || 22,
        ssh_user: ssh_user as string,
        ssh_auth_method: ssh_auth_method as 'password' | 'key',
        ssh_password: ssh_password as string,
        ssh_key_file: ssh_key_file as string,
        ssh_key_passphrase: ssh_key_passphrase as string,
        target_host: host || 'localhost',
        target_port: Number(port) || (driver === 'postgresql' ? 5432 : driver === 'mysql' ? 3306 : 1433),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(400).json({
        success: false,
        message: `SSH Tunnel Error: ${msg}`
      });
    }
  }

  // 2. Real Unified Multi-Driver Connection Test (PostgreSQL, MySQL, SQLite, MSSQL)
  const targetHost = testTunnel ? '127.0.0.1' : (host || 'localhost');
  const targetPort = testTunnel
    ? testTunnel.localPort
    : (Number(port) || (driver === 'mysql' ? 3306 : driver === 'sqlserver' ? 1433 : 5432));

  const testConn = {
    id: 'test',
    driver,
    host: targetHost,
    port: targetPort,
    username,
    password,
    default_database,
    ssl,
    ssh_enabled: 0, // already tunneled if needed
    is_readonly: 0
  };

  try {
    const adapter = createAdapter(testConn, targetHost, targetPort, default_database);
    const testRes = await adapter.testConnection();
    if (testTunnel) testTunnel.close();

    if (!testRes.success) {
      return res.status(400).json(testRes);
    }
    return res.json(testRes);
  } catch (err: unknown) {
    if (testTunnel) testTunnel.close();
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({
      success: false,
      message: `${driver.toUpperCase()} Connection Failed: ${msg}`,
      latency_ms: Math.round(performance.now() - startTime)
    });
  }
});

// 3. Databases Tree (Unified Multi-Driver)
app.get('/api/connections/:id/databases', async (req, res) => {
  const { id } = req.params;
  const conn = getConnectionRecord(id);
  const defaultDb = getDefaultDatabase(conn.driver as string, conn.default_database as string);

  try {
    const adapter = await getAdapter(conn, defaultDb, getOrCreateTunnel);
    const databases = await adapter.listDatabases();
    res.json({
      current: defaultDb || databases[0] || 'default',
      databases: databases.length > 0 ? databases : [defaultDb || 'default']
    });
  } catch (err: unknown) {
    console.error('Error fetching databases:', err);
    res.json({
      current: defaultDb || 'default',
      databases: [defaultDb || 'default']
    });
  }
});

// 4. Schemas & Tables Tree (Unified Multi-Driver)
app.get('/api/connections/:id/schemas', async (req, res) => {
  const { id } = req.params;
  const conn = getConnectionRecord(id);
  const database = (req.query.database as string) || getDefaultDatabase(conn.driver as string, conn.default_database as string);

  try {
    const adapter = await getAdapter(conn, database, getOrCreateTunnel);
    const result = await adapter.listSchemasAndTables();
    res.json(result);
  } catch (err: unknown) {
    console.error('Error fetching schemas & tables:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 4b. Table Columns Metadata Endpoint
app.get('/api/connections/:id/tables/:tableName/columns', async (req, res) => {
  const { id, tableName } = req.params;
  const conn = getConnectionRecord(id);
  const database = (req.query.database as string) || getDefaultDatabase(conn.driver as string, conn.default_database as string);
  const schema = (req.query.schema as string) || getDefaultSchema(conn.driver as string, database);

  try {
    const adapter = await getAdapter(conn, database, getOrCreateTunnel);
    const columns = await adapter.getTableColumns(tableName, schema);
    res.json({ columns });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 4c. Generate Table DDL Endpoint
app.get('/api/connections/:id/tables/:tableName/ddl', async (req, res) => {
  const { id, tableName } = req.params;
  const conn = getConnectionRecord(id);
  const database = (req.query.database as string) || getDefaultDatabase(conn.driver as string, conn.default_database as string);
  const schema = (req.query.schema as string) || getDefaultSchema(conn.driver as string, database);

  try {
    const adapter = await getAdapter(conn, database, getOrCreateTunnel);
    const ddl = await adapter.getTableDdl(tableName, schema);
    res.json({ ddl });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 4d. Truncate Table Endpoint
app.post('/api/connections/:id/tables/:tableName/truncate', async (req, res) => {
  const { id, tableName } = req.params;
  const conn = getConnectionRecord(id);
  const database = (req.body.database as string) || getDefaultDatabase(conn.driver as string, conn.default_database as string);
  const schema = (req.body.schema as string) || getDefaultSchema(conn.driver as string, database);
  const cascade = Boolean(req.body.cascade);

  try {
    const adapter = await getAdapter(conn, database, getOrCreateTunnel);
    await adapter.truncateTable(tableName, schema, cascade);
    res.json({ success: true, message: `Table "${tableName}" truncated successfully.` });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 5. Data Table Rows Browsing (Pagination, Sort, Filter, Search)
app.get('/api/connections/:id/tables/:tableName/data', async (req, res) => {
  const { id, tableName } = req.params;
  const conn = getConnectionRecord(id);
  const database = (req.query.database as string) || getDefaultDatabase(conn.driver as string, conn.default_database as string);
  const schema = (req.query.schema as string) || getDefaultSchema(conn.driver as string, database);
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string || '50', 10)));

  const filterCol = req.query.filterCol as string | undefined;
  const filterOp = req.query.filterOp as string | undefined;
  const filterVal = req.query.filterVal as string | undefined;
  const sortCol = req.query.sortCol as string | undefined;
  const sortDir = (req.query.sortDir as string)?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  try {
    const adapter = await getAdapter(conn, database, getOrCreateTunnel);
    const result = await adapter.getTableData(tableName, schema, {
      page,
      limit,
      filterCol,
      filterOp,
      filterVal,
      sortCol,
      sortDir
    });
    res.json(result);
  } catch (err: unknown) {
    console.error(`Error loading table data for ${tableName}:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 6. Insert Row (Create)
app.post('/api/connections/:id/tables/:tableName/rows', async (req, res) => {
  const { id: connectionId, tableName } = req.params;
  const conn = getConnectionRecord(connectionId);
  const {
    database: reqDatabase,
    schema: reqSchema,
    rowData,
    autocommit = true,
    sessionId
  } = req.body;

  const database = reqDatabase || getDefaultDatabase(conn.driver as string, conn.default_database as string);
  const schema = reqSchema || getDefaultSchema(conn.driver as string, database);

  if (!rowData || typeof rowData !== 'object') {
    return res.status(400).json({ error: 'Missing rowData object.' });
  }

  const isProd = conn.environment === 'production';
  const effectiveAutocommit = isProd ? false : Boolean(autocommit);
  const sessionKey = sessionId || `${connectionId}_${database}`;

  try {
    const adapter = await getAdapter(conn, database, getOrCreateTunnel);
    let session: TransactionSession | undefined;
    if (!effectiveAutocommit) {
      session = await getOrCreateSession(adapter, connectionId, database, sessionKey);
    }

    const { row, rowCount } = await adapter.insertRow(tableName, schema, rowData, session);
    const inTransaction = !effectiveAutocommit;
    const statementCount = session ? session.statements.length : undefined;

    saveQueryHistory(connectionId, `INSERT INTO "${tableName}"...`, 'success', rowCount, 10, null);

    res.json({
      success: true,
      row,
      inTransaction,
      statementCount,
      message: inTransaction
        ? `Record inserted into "${tableName}" (Transaction active). Statement recorded in Transaction Log.`
        : `Record successfully inserted into "${tableName}".`
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    saveQueryHistory(connectionId, `INSERT INTO "${tableName}"...`, 'error', 0, 15, msg);
    res.status(500).json({ error: msg });
  }
});

// 7. Update Row / Cell (Update)
app.put('/api/connections/:id/tables/:tableName/rows', async (req, res) => {
  const { id: connectionId, tableName } = req.params;
  const conn = getConnectionRecord(connectionId);
  const {
    database: reqDatabase,
    schema: reqSchema,
    identifierColumn,
    identifierValue,
    updatedData,
    autocommit = true,
    sessionId
  } = req.body;

  const database = reqDatabase || getDefaultDatabase(conn.driver as string, conn.default_database as string);
  const schema = reqSchema || getDefaultSchema(conn.driver as string, database);

  if (!identifierColumn || identifierValue === undefined || !updatedData) {
    return res.status(400).json({ error: 'Missing identifierColumn, identifierValue, or updatedData.' });
  }

  const isProd = conn.environment === 'production';
  const effectiveAutocommit = isProd ? false : Boolean(autocommit);
  const sessionKey = sessionId || `${connectionId}_${database}`;

  try {
    const adapter = await getAdapter(conn, database, getOrCreateTunnel);
    let session: TransactionSession | undefined;
    if (!effectiveAutocommit) {
      session = await getOrCreateSession(adapter, connectionId, database, sessionKey);
    }

    const { updatedRow, rowCount } = await adapter.updateRow(
      tableName,
      schema,
      identifierColumn,
      identifierValue,
      updatedData,
      session
    );
    const inTransaction = !effectiveAutocommit;
    const statementCount = session ? session.statements.length : undefined;

    saveQueryHistory(connectionId, `UPDATE "${tableName}"...`, 'success', rowCount, 10, null);

    res.json({
      success: true,
      updatedRow,
      inTransaction,
      statementCount,
      message: inTransaction
        ? `Cell updated in "${tableName}" (Transaction active). Statement recorded in Transaction Log.`
        : `Updated row in "${tableName}".`
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    saveQueryHistory(connectionId, `UPDATE "${tableName}"...`, 'error', 0, 15, msg);
    res.status(500).json({ error: msg });
  }
});

// 8. Delete Row (Delete)
app.delete('/api/connections/:id/tables/:tableName/rows', async (req, res) => {
  const { id: connectionId, tableName } = req.params;
  const conn = getConnectionRecord(connectionId);
  const {
    database: reqDatabase,
    schema: reqSchema,
    identifierColumn,
    identifierValue,
    autocommit = true,
    sessionId
  } = req.body;

  const database = reqDatabase || getDefaultDatabase(conn.driver as string, conn.default_database as string);
  const schema = reqSchema || getDefaultSchema(conn.driver as string, database);

  if (!identifierColumn || identifierValue === undefined) {
    return res.status(400).json({ error: 'Missing identifierColumn or identifierValue.' });
  }

  const isProd = conn.environment === 'production';
  const effectiveAutocommit = isProd ? false : Boolean(autocommit);
  const sessionKey = sessionId || `${connectionId}_${database}`;

  try {
    const adapter = await getAdapter(conn, database, getOrCreateTunnel);
    let session: TransactionSession | undefined;
    if (!effectiveAutocommit) {
      session = await getOrCreateSession(adapter, connectionId, database, sessionKey);
    }

    const { rowCount } = await adapter.deleteRow(tableName, schema, identifierColumn, identifierValue, session);
    const inTransaction = !effectiveAutocommit;
    const statementCount = session ? session.statements.length : undefined;

    saveQueryHistory(connectionId, `DELETE FROM "${tableName}"...`, 'success', rowCount, 10, null);

    res.json({
      success: true,
      inTransaction,
      statementCount,
      message: inTransaction
        ? `Deleted row from "${tableName}" (Transaction active). Statement recorded in Transaction Log.`
        : `Deleted ${rowCount} row(s) from "${tableName}".`
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    saveQueryHistory(connectionId, `DELETE FROM "${tableName}"...`, 'error', 0, 12, msg);
    res.status(500).json({ error: msg });
  }
});

// 9. Real SQL Query Execution (SQL Editor) with Multi-Driver & Manual Commit / Rollback Support
app.post('/api/query', async (req, res) => {
  const startTime = performance.now();
  const {
    connectionId,
    database,
    query = '',
    autocommit = true,
    sessionId
  } = req.body;

  const trimmed = query.trim();

  if (!trimmed) {
    return res.status(400).json({
      success: false,
      error: 'Empty query',
      message: 'No SQL query statement was provided to execute.'
    });
  }

  const conn = getConnectionRecord(connectionId);
  const targetDb = database || getDefaultDatabase(conn.driver as string, conn.default_database as string);
  const sessionKey = sessionId || connectionId || 'default';
  const isProd = conn.environment === 'production';
  const effectiveAutocommit = isProd ? false : Boolean(autocommit);

  // 1. Explicit COMMIT statement
  if (/^COMMIT(\s*;)?$/i.test(trimmed)) {
    const session = activeSessions.get(sessionKey);
    if (session) {
      try {
        await session.commit();
        await session.release();
        activeSessions.delete(sessionKey);

        transactionHistoryList.unshift({
          id: `tx-${Date.now()}`,
          connectionId,
          database: session.database,
          startedAt: new Date(session.startedAt).toISOString(),
          endedAt: new Date().toISOString(),
          action: 'committed',
          durationMs: Date.now() - session.startedAt,
          statementCount: session.statements.length,
          statements: [...session.statements]
        });
        if (transactionHistoryList.length > 50) transactionHistoryList.pop();

        saveQueryHistory(connectionId, trimmed, 'success', 0, Math.round(performance.now() - startTime), null);
        return res.json({
          success: true,
          message: 'Transaction committed successfully. Changes persisted.',
          duration_ms: Math.round(performance.now() - startTime),
          inTransaction: false,
          rowCount: 0,
          columns: [],
          rows: []
        });
      } catch (err: any) {
        try { await session.release(); } catch { }
        activeSessions.delete(sessionKey);
        saveQueryHistory(connectionId, trimmed, 'error', 0, Math.round(performance.now() - startTime), err.message);
        return res.status(500).json({
          success: false,
          error: err.message,
          message: `Commit failed: ${err.message}`,
          inTransaction: false,
          rowCount: 0,
          columns: [],
          rows: []
        });
      }
    } else {
      return res.json({
        success: true,
        message: 'No active transaction to commit.',
        duration_ms: Math.round(performance.now() - startTime),
        inTransaction: false,
        rowCount: 0,
        columns: [],
        rows: []
      });
    }
  }

  // 2. Explicit ROLLBACK statement
  if (/^ROLLBACK(\s*;)?$/i.test(trimmed)) {
    const session = activeSessions.get(sessionKey);
    if (session) {
      try {
        await session.rollback();
        await session.release();
        activeSessions.delete(sessionKey);

        transactionHistoryList.unshift({
          id: `tx-${Date.now()}`,
          connectionId,
          database: session.database,
          startedAt: new Date(session.startedAt).toISOString(),
          endedAt: new Date().toISOString(),
          action: 'rolled_back',
          durationMs: Date.now() - session.startedAt,
          statementCount: session.statements.length,
          statements: [...session.statements]
        });
        if (transactionHistoryList.length > 50) transactionHistoryList.pop();

        saveQueryHistory(connectionId, trimmed, 'success', 0, Math.round(performance.now() - startTime), null);
        return res.json({
          success: true,
          message: 'Transaction rolled back successfully. Changes discarded.',
          duration_ms: Math.round(performance.now() - startTime),
          inTransaction: false,
          rowCount: 0,
          columns: [],
          rows: []
        });
      } catch (err: any) {
        try { await session.release(); } catch { }
        activeSessions.delete(sessionKey);
        saveQueryHistory(connectionId, trimmed, 'error', 0, Math.round(performance.now() - startTime), err.message);
        return res.status(500).json({
          success: false,
          error: err.message,
          message: `Rollback failed: ${err.message}`,
          inTransaction: false,
          rowCount: 0,
          columns: [],
          rows: []
        });
      }
    } else {
      return res.json({
        success: true,
        message: 'No active transaction to rollback.',
        duration_ms: Math.round(performance.now() - startTime),
        inTransaction: false,
        rowCount: 0,
        columns: [],
        rows: []
      });
    }
  }

  // 3. Manual Commit Mode (Autocommit is FALSE or Production)
  if (!effectiveAutocommit) {
    try {
      const adapter = await getAdapter(conn, targetDb, getOrCreateTunnel);
      let session = activeSessions.get(sessionKey);
      if (!session) {
        session = await adapter.createTransactionSession(sessionKey);
        activeSessions.set(sessionKey, session);
      }

      const result = await session.query(trimmed);
      const duration = Math.round(performance.now() - startTime);

      saveQueryHistory(connectionId, trimmed, 'success', result.rowCount, duration, null);

      return res.json({
        success: true,
        message: `Executed in transaction (${result.rowCount} rows affected). Click Commit to persist or Rollback to discard.`,
        duration_ms: duration,
        inTransaction: true,
        statementCount: session.statements.length,
        rowCount: result.rowCount,
        columns: result.columns,
        rows: result.rows
      });
    } catch (err: any) {
      const duration = Math.round(performance.now() - startTime);
      const message = err.message || 'Database error occurred during query execution.';

      const session = activeSessions.get(sessionKey);
      if (session) {
        session.statements.push({
          id: `stmt-${Date.now()}-${session.statements.length + 1}`,
          query: trimmed,
          timestamp: new Date().toISOString(),
          duration_ms: duration,
          rowCount: 0,
          status: 'error',
          errorMessage: message
        });
      }

      saveQueryHistory(connectionId, trimmed, 'error', 0, duration, message);

      return res.json({
        success: false,
        error: message,
        message,
        duration_ms: duration,
        inTransaction: true,
        statementCount: session ? session.statements.length : 0,
        rowCount: 0,
        columns: [],
        rows: []
      });
    }
  }

  // 4. Autocommit is TRUE - Execute standard query
  if (activeSessions.has(sessionKey)) {
    const oldSession = activeSessions.get(sessionKey)!;
    try {
      await oldSession.commit();
      await oldSession.release();
    } catch { }
    activeSessions.delete(sessionKey);
  }

  try {
    const adapter = await getAdapter(conn, targetDb, getOrCreateTunnel);
    const result = await adapter.executeQuery(trimmed);
    const duration = Math.round(performance.now() - startTime);

    saveQueryHistory(connectionId, trimmed, 'success', result.rowCount, duration, null);

    return res.json({
      success: true,
      message: result.message || `Query executed successfully (${result.rowCount} rows affected).`,
      duration_ms: duration,
      inTransaction: false,
      rowCount: result.rowCount,
      columns: result.columns,
      rows: result.rows
    });
  } catch (err: any) {
    const duration = Math.round(performance.now() - startTime);
    const message = err.message || 'Database error occurred during query execution.';

    saveQueryHistory(connectionId, trimmed, 'error', 0, duration, message);

    return res.json({
      success: false,
      error: message,
      message,
      duration_ms: duration,
      inTransaction: false,
      rowCount: 0,
      columns: [],
      rows: []
    });
  }
});

// Dedicated Transaction Commit API
app.post('/api/transaction/commit', async (req, res) => {
  const { sessionId, connectionId } = req.body;
  const sessionKey = sessionId || connectionId || 'default';
  const session = activeSessions.get(sessionKey);
  if (!session) {
    return res.json({ success: true, message: 'No active transaction to commit.', inTransaction: false });
  }
  try {
    await session.commit();
    await session.release();
    activeSessions.delete(sessionKey);

    transactionHistoryList.unshift({
      id: `tx-${Date.now()}`,
      connectionId: session.connectionId,
      database: session.database,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      action: 'committed',
      durationMs: Date.now() - session.startedAt,
      statementCount: session.statements.length,
      statements: [...session.statements]
    });
    if (transactionHistoryList.length > 50) transactionHistoryList.pop();

    saveQueryHistory(connectionId, 'COMMIT', 'success', 0, 5, null);
    res.json({ success: true, message: 'Transaction committed successfully. Changes persisted.', inTransaction: false });
  } catch (err: any) {
    try { await session.release(); } catch { }
    activeSessions.delete(sessionKey);
    res.status(500).json({ error: err.message, inTransaction: false });
  }
});

// Dedicated Transaction Rollback API
app.post('/api/transaction/rollback', async (req, res) => {
  const { sessionId, connectionId } = req.body;
  const sessionKey = sessionId || connectionId || 'default';
  const session = activeSessions.get(sessionKey);
  if (!session) {
    return res.json({ success: true, message: 'No active transaction to rollback.', inTransaction: false });
  }
  try {
    await session.rollback();
    await session.release();
    activeSessions.delete(sessionKey);

    transactionHistoryList.unshift({
      id: `tx-${Date.now()}`,
      connectionId: session.connectionId,
      database: session.database,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      action: 'rolled_back',
      durationMs: Date.now() - session.startedAt,
      statementCount: session.statements.length,
      statements: [...session.statements]
    });
    if (transactionHistoryList.length > 50) transactionHistoryList.pop();

    saveQueryHistory(connectionId, 'ROLLBACK', 'success', 0, 5, null);
    res.json({ success: true, message: 'Transaction rolled back successfully. Pending changes discarded.', inTransaction: false });
  } catch (err: any) {
    try { await session.release(); } catch { }
    activeSessions.delete(sessionKey);
    res.status(500).json({ error: err.message, inTransaction: false });
  }
});

// Transaction Status API
app.get('/api/transaction/status', (req, res) => {
  const sessionKey = (req.query.sessionId as string) || (req.query.connectionId as string) || 'default';
  const session = activeSessions.get(sessionKey);
  res.json({
    inTransaction: Boolean(session && session.inTransaction),
    statementCount: session ? session.statements.length : 0
  });
});

// Transaction Logs API (Active uncommitted statements & history)
app.get('/api/transaction/logs', (req, res) => {
  const sessionKey = (req.query.sessionId as string) || (req.query.connectionId as string) || 'default';
  const session = activeSessions.get(sessionKey);
  res.json({
    inTransaction: Boolean(session && session.inTransaction),
    startedAt: session ? new Date(session.startedAt).toISOString() : null,
    elapsedMs: session ? Date.now() - session.startedAt : 0,
    statements: session ? session.statements : [],
    history: transactionHistoryList.slice(0, 30)
  });
});

// 10. Query History
app.get('/api/history', (_req, res) => {
  try {
    const stmt = studioDb.prepare('SELECT * FROM query_history ORDER BY created_at DESC LIMIT 100');
    const rows = stmt.all();
    res.json(rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.delete('/api/history', (_req, res) => {
  try {
    studioDb.prepare('DELETE FROM query_history').run();
    res.json({ success: true, message: 'Query history cleared.' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// 11. Data Export API (CSV, JSON, SQL INSERT)
app.post('/api/export', (req, res) => {
  const { format, tableName = 'export_table', columns = [], rows = [] } = req.body;

  if (format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${tableName}.json"`);
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(rows, null, 2));
  }

  if (format === 'csv') {
    const colNames = columns.map((c: TableColumn) => c.name);
    const headerLine = colNames.map((n: string) => `"${n.replace(/"/g, '""')}"`).join(',');
    const dataLines = rows.map((r: Record<string, unknown>) => {
      return colNames.map((n: string) => {
        const val = r[n];
        if (val === null || val === undefined) return '';
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',');
    });
    const csvContent = [headerLine, ...dataLines].join('\n');

    res.setHeader('Content-Disposition', `attachment; filename="${tableName}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    return res.send(csvContent);
  }

  if (format === 'sql') {
    const colNames = columns.map((c: TableColumn) => c.name);
    const colsSql = colNames.map((n: string) => `"${n}"`).join(', ');
    const insertStatements = rows.map((r: Record<string, unknown>) => {
      const values = colNames.map((n: string) => {
        const val = r[n];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number') return String(val);
        return `'${String(val).replace(/'/g, "''")}'`;
      }).join(', ');
      return `INSERT INTO "${tableName}" (${colsSql}) VALUES (${values});`;
    }).join('\n');

    res.setHeader('Content-Disposition', `attachment; filename="${tableName}.sql"`);
    res.setHeader('Content-Type', 'text/plain');
    return res.send(insertStatements);
  }

  res.status(400).json({ error: 'Unsupported export format. Use csv, json, or sql.' });
});

// Vite Integration (Dev Middleware or Production Static)
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production' || isBunCompiled;

  if (!isProd) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa'
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('[Server] Running without Vite middleware:', err);
    }
  } else {
    const distPath = path.join(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`${APP_NAME} server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
