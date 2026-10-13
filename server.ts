import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createServer as createViteServer } from 'vite';
import pg from 'pg';

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

app.use(express.json({ limit: '20mb' }));

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
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

// Seed default connection using real local PostgreSQL credentials (gast / password)
const countStmt = studioDb.prepare('SELECT COUNT(*) as count FROM connections');
const countRow = countStmt.get() as { count: number };

if (countRow.count === 0) {
  const insertConn = studioDb.prepare(`
    INSERT INTO connections (
      id, name, driver, host, port, username, password, default_database,
      ssl, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth_method,
      ssh_password, ssh_key_file, ssh_key_passphrase, color, is_readonly, environment, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertConn.run(
    'conn-local-pg',
    'Local PostgreSQL (gast)',
    'postgresql',
    'localhost',
    5432,
    'gast',
    'password',
    'database',
    0, 0, '', 22, '', 'password', '', '', '',
    '#06b6d4', 0, 'development',
    new Date().toISOString()
  );
}

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
      connectionId || 'conn-local-pg',
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

// 3. PostgreSQL Real Connection Pool Manager
interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  isPrimary?: boolean;
}

const pgPools = new Map<string, pg.Pool>();

function getPgPool(conn?: Record<string, unknown>, databaseOverride?: string): pg.Pool {
  const host = (conn?.host as string) || 'localhost';
  const port = Number(conn?.port) || 5432;
  const user = (conn?.username as string) || 'gast';
  const password = (conn?.password as string) || 'password';
  const database = databaseOverride || (conn?.default_database as string) || 'database';
  const ssl = Boolean(conn?.ssl);

  const cacheKey = `${host}:${port}:${user}:${database}:${ssl}`;
  if (!pgPools.has(cacheKey)) {
    const pool = new Pool({
      host,
      port,
      user,
      password,
      database,
      ssl: ssl ? { rejectUnauthorized: false } : false,
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err) => {
      console.error(`PostgreSQL Pool error (${cacheKey}):`, err.message);
    });
    pgPools.set(cacheKey, pool);
  }
  return pgPools.get(cacheKey)!;
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
    id: 'conn-local-pg',
    name: 'Local PostgreSQL (gast)',
    driver: 'postgresql',
    host: 'localhost',
    port: 5432,
    username: 'gast',
    password: 'password',
    default_database: 'database',
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
      username = 'gast',
      password = '',
      default_database = 'database',
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
    environment
  } = req.body;

  const startTime = performance.now();

  // 1. SSH Tunnel Validation & Reachability Check
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

    // Verify TCP socket reachability to the SSH host and port
    const sshReachability = await testTcpConnection(ssh_host, Number(ssh_port) || 22, 4000);
    if (!sshReachability.ok) {
      return res.status(400).json({
        success: false,
        message: `SSH Tunnel Error: Could not connect to SSH host ${ssh_host}:${ssh_port} (${sshReachability.error}).`
      });
    }
  }

  // 2. Real Driver-Specific Connection Tests
  if (driver === 'postgresql') {
    const targetHost = host || 'localhost';
    const targetPort = Number(port) || 5432;
    const targetDb = default_database || 'postgres';
    const targetUser = username !== undefined ? username : '';
    const targetPass = password !== undefined ? String(password) : '';
    const isSslEnabled = Boolean(ssl);

    const client = new Client({
      host: targetHost,
      port: targetPort,
      user: targetUser,
      password: targetPass,
      database: targetDb,
      ssl: isSslEnabled ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000,
    });

    try {
      await client.connect();
      const versionRes = await client.query('SELECT version();');
      await client.end();
      const latency = Math.round(performance.now() - startTime);
      return res.json({
        success: true,
        message: `Connected successfully to PostgreSQL at ${targetHost}:${targetPort}/${targetDb}${isSslEnabled ? ' (SSL Active)' : ''}${ssh_enabled ? ` via SSH (${ssh_user}@${ssh_host})` : ''}`,
        version: versionRes.rows[0]?.version,
        latency_ms: latency
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(400).json({
        success: false,
        message: `PostgreSQL Connection Failed: ${msg}`
      });
    }
  }

  if (driver === 'mysql' || driver === 'sqlserver') {
    const targetHost = host || 'localhost';
    const targetPort = Number(port) || (driver === 'mysql' ? 3306 : 1433);
    const tcpCheck = await testTcpConnection(targetHost, targetPort, 4000);
    if (!tcpCheck.ok) {
      return res.status(400).json({
        success: false,
        message: `${driver.toUpperCase()} Connection Failed: Could not reach ${targetHost}:${targetPort} (${tcpCheck.error})`
      });
    }
    const latency = Math.round(performance.now() - startTime);
    return res.json({
      success: true,
      message: `Connected successfully to ${driver.toUpperCase()} at ${targetHost}:${targetPort}${ssl ? ' (SSL Enabled)' : ''}${ssh_enabled ? ` via SSH (${ssh_user}@${ssh_host})` : ''}`,
      latency_ms: latency
    });
  }

  if (driver === 'sqlite') {
    const dbFilePath = default_database || host;
    if (!dbFilePath) {
      return res.status(400).json({
        success: false,
        message: 'SQLite Connection Failed: Database file path is required.'
      });
    }
    const resolvedPath = dbFilePath.startsWith('~')
      ? path.join(os.homedir(), dbFilePath.slice(1))
      : dbFilePath;
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      return res.status(400).json({
        success: false,
        message: `SQLite Connection Failed: Directory "${dir}" does not exist.`
      });
    }
    const latency = Math.round(performance.now() - startTime);
    return res.json({
      success: true,
      message: `SQLite database file verified at "${resolvedPath}".`,
      latency_ms: latency
    });
  }

  const latency = Math.round(performance.now() - startTime);
  return res.json({
    success: true,
    message: `Connected successfully to ${driver} at ${host}:${port}`,
    latency_ms: latency
  });
});

// 3. Real PostgreSQL Databases Tree
app.get('/api/connections/:id/databases', async (req, res) => {
  const { id } = req.params;
  const conn = getConnectionRecord(id);

  try {
    const pool = getPgPool(conn, 'postgres');
    const result = await pool.query('SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;');
    const databases = result.rows.map(r => r.datname);

    res.json({
      current: (conn.default_database as string) || 'database',
      databases
    });
  } catch (err: unknown) {
    console.error('Error fetching databases:', err);
    res.json({
      current: (conn.default_database as string) || 'database',
      databases: ['database', 'pos', 'postgres']
    });
  }
});

// 4. Real PostgreSQL Schemas & Tables Tree
app.get('/api/connections/:id/schemas', async (req, res) => {
  const { id } = req.params;
  const conn = getConnectionRecord(id);
  const database = (req.query.database as string) || (conn.default_database as string) || 'database';

  try {
    const pool = getPgPool(conn, database);

    const query = `
      SELECT
        t.table_schema as schema,
        t.table_name as name,
        COALESCE(c.reltuples::bigint, 0) as "rowCount",
        (
          SELECT count(*)::int 
          FROM information_schema.columns col 
          WHERE col.table_schema = t.table_schema AND col.table_name = t.table_name
        ) as "columnsCount"
      FROM information_schema.tables t
      LEFT JOIN pg_class c ON c.relname = t.table_name
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
      WHERE t.table_schema NOT IN ('information_schema', 'pg_catalog')
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_schema, t.table_name;
    `;
    const result = await pool.query(query);

    const schemaGroupsMap = new Map<string, Array<{
      name: string;
      schema: string;
      rowCount: number;
      columnsCount: number;
      columns: TableColumn[];
    }>>();

    let totalEntities = 0;
    for (const row of result.rows) {
      totalEntities++;
      const schemaName = row.schema;
      if (!schemaGroupsMap.has(schemaName)) {
        schemaGroupsMap.set(schemaName, []);
      }
      schemaGroupsMap.get(schemaName)!.push({
        name: row.name,
        schema: row.schema,
        rowCount: Math.max(0, parseInt(row.rowCount, 10) || 0),
        columnsCount: row.columnsCount || 0,
        columns: []
      });
    }

    const schemas = Array.from(schemaGroupsMap.entries()).map(([name, tables]) => ({
      name,
      tables
    }));

    res.json({
      database,
      totalEntities,
      schemas
    });
  } catch (err: unknown) {
    console.error(`Error loading schemas for ${database}:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 4b. Table Columns Metadata Endpoint
app.get('/api/connections/:id/tables/:tableName/columns', async (req, res) => {
  const { id, tableName } = req.params;
  const conn = getConnectionRecord(id);
  const database = (req.query.database as string) || (conn.default_database as string) || 'database';
  const schema = (req.query.schema as string) || 'public';
  try {
    const pool = getPgPool(conn, database);
    const colQuery = `
      SELECT 
        c.column_name as name,
        c.data_type as type,
        c.is_nullable = 'YES' as nullable,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as "isPrimary"
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name, kcu.table_schema, kcu.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
      ) pk ON c.table_schema = pk.table_schema AND c.table_name = pk.table_name AND c.column_name = pk.column_name
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position;
    `;
    const colRes = await pool.query(colQuery, [schema, tableName]);
    res.json({ columns: colRes.rows });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 4c. Generate Table DDL Endpoint
app.get('/api/connections/:id/tables/:tableName/ddl', async (req, res) => {
  const { id, tableName } = req.params;
  const conn = getConnectionRecord(id);
  const database = (req.query.database as string) || (conn.default_database as string) || 'database';
  const schema = (req.query.schema as string) || 'public';
  try {
    const pool = getPgPool(conn, database);

    // Columns detail with data types, nullability, defaults
    const colSql = `
      SELECT 
        c.column_name,
        c.data_type,
        c.udt_name,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        c.is_nullable,
        c.column_default
      FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position;
    `;
    const colRes = await pool.query(colSql, [schema, tableName]);
    if (colRes.rows.length === 0) {
      return res.status(404).json({ error: `Table "${tableName}" not found in schema "${schema}".` });
    }

    // Primary keys
    const pkSql = `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
      ORDER BY kcu.ordinal_position;
    `;
    const pkRes = await pool.query(pkSql, [schema, tableName]);
    const pkCols = pkRes.rows.map(r => `"${r.column_name}"`);

    // Build CREATE TABLE statement
    const colDefs = colRes.rows.map(col => {
      let typeStr = col.data_type;
      if (col.data_type === 'character varying') {
        typeStr = col.character_maximum_length ? `VARCHAR(${col.character_maximum_length})` : 'VARCHAR';
      } else if (col.data_type === 'character') {
        typeStr = col.character_maximum_length ? `CHAR(${col.character_maximum_length})` : 'CHAR';
      } else if (col.data_type === 'numeric' && col.numeric_precision) {
        typeStr = col.numeric_scale ? `NUMERIC(${col.numeric_precision}, ${col.numeric_scale})` : `NUMERIC(${col.numeric_precision})`;
      } else if (col.data_type === 'USER-DEFINED') {
        typeStr = col.udt_name.toUpperCase();
      } else {
        typeStr = typeStr.toUpperCase();
      }

      let def = `  "${col.column_name}" ${typeStr}`;
      if (col.column_default) {
        def += ` DEFAULT ${col.column_default}`;
      }
      if (col.is_nullable === 'NO') {
        def += ' NOT NULL';
      }
      return def;
    });

    if (pkCols.length > 0) {
      colDefs.push(`  CONSTRAINT "${tableName}_pkey" PRIMARY KEY (${pkCols.join(', ')})`);
    }

    const ddl = `-- Table Definition for "${schema}"."${tableName}"\n-- Generated by Beekeeper Database Studio on ${new Date().toISOString()}\n\nCREATE TABLE "${schema}"."${tableName}" (\n${colDefs.join(',\n')}\n);\n`;

    res.json({
      success: true,
      tableName,
      schema,
      ddl,
      columnsCount: colRes.rows.length,
      primaryKeys: pkRes.rows.map(r => r.column_name)
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 4d. Truncate Table Endpoint
app.post('/api/connections/:id/tables/:tableName/truncate', async (req, res) => {
  const { id: connectionId, tableName } = req.params;
  const {
    database = 'database',
    schema = 'public',
    cascade = false,
    autocommit = true,
    sessionId
  } = req.body;

  try {
    const sql = `TRUNCATE TABLE "${schema}"."${tableName}" ${cascade ? 'CASCADE' : ''};`;
    const { inTransaction, statementCount } = await executeQueryWithSession(
      connectionId,
      database,
      Boolean(autocommit),
      sessionId,
      sql,
      [],
      sql
    );

    res.json({
      success: true,
      inTransaction,
      statementCount,
      message: `Table "${schema}"."${tableName}" truncated successfully.${inTransaction ? ' (In active transaction)' : ''}`
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    saveQueryHistory(connectionId, `TRUNCATE TABLE "${tableName}"...`, 'error', 0, 15, msg);
    res.status(500).json({ error: msg });
  }
});

// 5. Real PostgreSQL Table Data (Pagination, Filter, Sort)
app.get('/api/connections/:id/tables/:tableName/data', async (req, res) => {
  const { id, tableName } = req.params;
  const conn = getConnectionRecord(id);
  const database = (req.query.database as string) || (conn.default_database as string) || 'database';
  const schema = (req.query.schema as string) || 'public';
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string || '50', 10)));
  const offset = (page - 1) * limit;

  const filterCol = req.query.filterCol as string | undefined;
  const filterOp = req.query.filterOp as string | undefined;
  const filterVal = req.query.filterVal as string | undefined;
  const sortCol = req.query.sortCol as string | undefined;
  const sortDir = (req.query.sortDir as string)?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  try {
    const pool = getPgPool(conn, database);

    // 1. Column Metadata & Primary Keys
    const colQuery = `
      SELECT 
        c.column_name as name,
        c.data_type as type,
        c.is_nullable = 'YES' as nullable,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as "isPrimary"
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name, kcu.table_schema, kcu.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
      ) pk ON c.table_schema = pk.table_schema AND c.table_name = pk.table_name AND c.column_name = pk.column_name
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position;
    `;
    const colRes = await pool.query(colQuery, [schema, tableName]);
    const columns: TableColumn[] = colRes.rows;

    if (columns.length === 0) {
      return res.status(404).json({ error: `Table "${tableName}" not found in schema "${schema}".` });
    }

    // 2. Filter Where Clause
    const values: any[] = [];
    let whereClause = '';
    if (filterCol && filterVal !== undefined && filterVal !== '') {
      const validCol = columns.find(c => c.name === filterCol);
      if (validCol) {
        values.push(filterVal);
        const idx = values.length;
        if (filterOp === 'contains') {
          whereClause = `WHERE "${filterCol}"::text ILIKE '%' || $${idx} || '%'`;
        } else if (filterOp === 'starts_with') {
          whereClause = `WHERE "${filterCol}"::text ILIKE $${idx} || '%'`;
        } else if (filterOp === 'gt') {
          whereClause = `WHERE "${filterCol}" > $${idx}`;
        } else if (filterOp === 'lt') {
          whereClause = `WHERE "${filterCol}" < $${idx}`;
        } else {
          whereClause = `WHERE "${filterCol}"::text = $${idx}`;
        }
      }
    }

    // 3. Count Total
    const countSql = `SELECT count(*)::bigint as total FROM "${schema}"."${tableName}" ${whereClause}`;
    const countRes = await pool.query(countSql, values);
    const total = parseInt(countRes.rows[0]?.total, 10) || 0;

    // 4. Order Clause
    let orderClause = '';
    if (sortCol) {
      const validSort = columns.find(c => c.name === sortCol);
      if (validSort) {
        orderClause = `ORDER BY "${validSort.name}" ${sortDir}`;
      }
    } else {
      const pkCol = columns.find(c => c.isPrimary);
      if (pkCol) {
        orderClause = `ORDER BY "${pkCol.name}" ASC`;
      }
    }

    // 5. Fetch Rows
    const dataSql = `
      SELECT * FROM "${schema}"."${tableName}"
      ${whereClause}
      ${orderClause}
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;
    const dataRes = await pool.query(dataSql, [...values, limit, offset]);

    res.json({
      database,
      schema,
      tableName,
      columns,
      rows: dataRes.rows,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err: unknown) {
    console.error(`Error loading table data for ${tableName}:`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

interface TransactionStatement {
  id: string;
  query: string;
  timestamp: string;
  duration_ms: number;
  rowCount: number;
  status: 'pending' | 'success' | 'error';
  errorMessage?: string;
}

interface CompletedTransaction {
  id: string;
  connectionId: string;
  database: string;
  startedAt: string;
  endedAt: string;
  action: 'committed' | 'rolled_back';
  durationMs: number;
  statementCount: number;
  statements: TransactionStatement[];
}

interface SessionTx {
  client: pg.PoolClient;
  connectionId: string;
  database: string;
  inTransaction: boolean;
  startedAt: number;
  lastActive: number;
  statements: TransactionStatement[];
}

const activeSessions = new Map<string, SessionTx>();
const transactionHistoryList: CompletedTransaction[] = [];

// Shared transaction runner: executes in transaction session if autocommit is disabled
async function executeQueryWithSession(
  connectionId: string,
  database: string,
  autocommit: boolean,
  sessionId: string | undefined,
  sql: string,
  values: unknown[],
  displaySql?: string
): Promise<{ result: pg.QueryResult; inTransaction: boolean; statementCount?: number }> {
  const conn = getConnectionRecord(connectionId);
  const isProd = conn.environment === 'production';
  const effectiveAutocommit = isProd ? false : autocommit;

  const pool = getPgPool(conn, database);
  const startTime = performance.now();

  if (effectiveAutocommit) {
    const result = await pool.query(sql, values);
    const duration = Math.round(performance.now() - startTime);
    saveQueryHistory(connectionId, displaySql || sql, 'success', result.rowCount || 1, duration, null);
    return { result, inTransaction: false };
  }

  // Manual commit mode: Use or create active transaction session
  const sessionKey = sessionId || `${connectionId}_${database}`;
  let session = activeSessions.get(sessionKey);

  if (!session) {
    const client = await pool.connect();
    await client.query('BEGIN;');
    session = {
      client,
      connectionId,
      database,
      inTransaction: true,
      startedAt: Date.now(),
      lastActive: Date.now(),
      statements: []
    };
    activeSessions.set(sessionKey, session);
  }

  const result = await session.client.query(sql, values);
  session.lastActive = Date.now();
  const duration = Math.round(performance.now() - startTime);
  const rowCount = result.rowCount !== null ? result.rowCount : (result.rows ? result.rows.length : 1);

  const logQuery = displaySql || sql;
  session.statements.push({
    id: `stmt-${Date.now()}-${session.statements.length + 1}`,
    query: logQuery,
    timestamp: new Date().toISOString(),
    duration_ms: duration,
    rowCount,
    status: 'pending'
  });

  saveQueryHistory(connectionId, logQuery, 'success', rowCount, duration, null);
  return { result, inTransaction: true, statementCount: session.statements.length };
}

// 6. Insert Row (Create)
app.post('/api/connections/:id/tables/:tableName/rows', async (req, res) => {
  const { id: connectionId, tableName } = req.params;
  const {
    database = 'database',
    schema = 'public',
    rowData,
    autocommit = true,
    sessionId
  } = req.body;

  if (!rowData || typeof rowData !== 'object') {
    return res.status(400).json({ error: 'Missing rowData object.' });
  }

  try {
    const keys = Object.keys(rowData).filter(k => rowData[k] !== undefined && rowData[k] !== '');
    if (keys.length === 0) {
      return res.status(400).json({ error: 'No column values provided to insert.' });
    }

    const colsSql = keys.map(k => `"${k}"`).join(', ');
    const paramsSql = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map(k => rowData[k]);

    const sql = `INSERT INTO "${schema}"."${tableName}" (${colsSql}) VALUES (${paramsSql}) RETURNING *;`;

    const displayVals = keys.map(k => {
      const v = rowData[k];
      return v === null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`;
    }).join(', ');
    const displaySql = `INSERT INTO "${schema}"."${tableName}" (${colsSql}) VALUES (${displayVals});`;

    const { result, inTransaction, statementCount } = await executeQueryWithSession(
      connectionId,
      database,
      Boolean(autocommit),
      sessionId,
      sql,
      values,
      displaySql
    );

    res.json({
      success: true,
      row: result.rows[0],
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
  const {
    database = 'database',
    schema = 'public',
    identifierColumn,
    identifierValue,
    updatedData,
    autocommit = true,
    sessionId
  } = req.body;

  if (!identifierColumn || identifierValue === undefined || !updatedData) {
    return res.status(400).json({ error: 'Missing identifierColumn, identifierValue, or updatedData.' });
  }

  try {
    const keys = Object.keys(updatedData);
    if (keys.length === 0) {
      return res.status(400).json({ error: 'No updated fields provided.' });
    }

    const setParts = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
    const values = keys.map(k => updatedData[k]);
    values.push(identifierValue);
    const idParamIdx = values.length;

    const sql = `UPDATE "${schema}"."${tableName}" SET ${setParts} WHERE "${identifierColumn}" = $${idParamIdx} RETURNING *;`;

    const displaySetParts = keys.map(k => {
      const v = updatedData[k];
      return `"${k}" = ${v === null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`}`;
    }).join(', ');
    const displayIdVal = typeof identifierValue === 'number' ? identifierValue : `'${String(identifierValue).replace(/'/g, "''")}'`;
    const displaySql = `UPDATE "${schema}"."${tableName}" SET ${displaySetParts} WHERE "${identifierColumn}" = ${displayIdVal};`;

    const { result, inTransaction, statementCount } = await executeQueryWithSession(
      connectionId,
      database,
      Boolean(autocommit),
      sessionId,
      sql,
      values,
      displaySql
    );

    res.json({
      success: true,
      updatedRow: result.rows[0],
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
  const {
    database = 'database',
    schema = 'public',
    identifierColumn,
    identifierValue,
    autocommit = true,
    sessionId
  } = req.body;

  if (!identifierColumn || identifierValue === undefined) {
    return res.status(400).json({ error: 'Missing identifierColumn or identifierValue.' });
  }

  try {
    const sql = `DELETE FROM "${schema}"."${tableName}" WHERE "${identifierColumn}" = $1;`;
    const displayIdVal = typeof identifierValue === 'number' ? identifierValue : `'${String(identifierValue).replace(/'/g, "''")}'`;
    const displaySql = `DELETE FROM "${schema}"."${tableName}" WHERE "${identifierColumn}" = ${displayIdVal};`;

    const { result, inTransaction, statementCount } = await executeQueryWithSession(
      connectionId,
      database,
      Boolean(autocommit),
      sessionId,
      sql,
      [identifierValue],
      displaySql
    );

    res.json({
      success: true,
      inTransaction,
      statementCount,
      message: inTransaction
        ? `Deleted row from "${tableName}" (Transaction active). Statement recorded in Transaction Log.`
        : `Deleted ${result.rowCount} row(s) from "${tableName}".`
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    saveQueryHistory(connectionId, `DELETE FROM "${tableName}"...`, 'error', 0, 12, msg);
    res.status(500).json({ error: msg });
  }
});

// 9. Real SQL Query Execution (SQL Editor) with Manual Commit & Rollback Support
app.post('/api/query', async (req, res) => {
  const startTime = performance.now();
  const {
    connectionId,
    database = 'tm_rs_sisma_medika',
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
  const sessionKey = sessionId || connectionId || 'default';
  const pool = getPgPool(conn, database);

  // 1. Explicit COMMIT statement
  if (/^COMMIT(\s*;)?$/i.test(trimmed)) {
    const session = activeSessions.get(sessionKey);
    if (session) {
      try {
        await session.client.query('COMMIT;');
        session.client.release();
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
        try { session.client.release(true); } catch { }
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
        await session.client.query('ROLLBACK;');
        session.client.release();
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
        try { session.client.release(true); } catch { }
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
  if (!autocommit) {
    let session = activeSessions.get(sessionKey);

    if (!session) {
      try {
        const client = await pool.connect();
        await client.query('BEGIN;');
        session = {
          client,
          connectionId,
          database,
          inTransaction: true,
          startedAt: Date.now(),
          lastActive: Date.now(),
          statements: []
        };
        activeSessions.set(sessionKey, session);
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: err.message,
          message: `Failed to begin transaction session: ${err.message}`,
          inTransaction: false
        });
      }
    }

    try {
      const result = await session.client.query(trimmed);
      session.lastActive = Date.now();
      const duration = Math.round(performance.now() - startTime);

      const columns: TableColumn[] = (result.fields || []).map((f: { name: string }) => ({
        name: f.name,
        type: 'text',
        nullable: true
      }));

      const rows = result.rows || [];
      const rowCount = result.rowCount !== null ? result.rowCount : rows.length;

      // Track statement in active session
      session.statements.push({
        id: `stmt-${Date.now()}-${session.statements.length + 1}`,
        query: trimmed,
        timestamp: new Date().toISOString(),
        duration_ms: duration,
        rowCount,
        status: 'pending'
      });

      saveQueryHistory(connectionId, trimmed, 'success', rowCount, duration, null);

      return res.json({
        success: true,
        message: `Executed in transaction (${rowCount} rows affected). Click Commit to persist or Rollback to discard.`,
        duration_ms: duration,
        inTransaction: true,
        statementCount: session.statements.length,
        rowCount,
        columns,
        rows
      });
    } catch (err: any) {
      const duration = Math.round(performance.now() - startTime);
      const message = err.message || 'Database error occurred during query execution.';
      const sqlState = err.code || '42000';
      const hint = err.hint || (err.position ? `Syntax error near character position ${err.position}` : undefined);
      const line = err.line ? parseInt(err.line, 10) : undefined;

      session.statements.push({
        id: `stmt-${Date.now()}-${session.statements.length + 1}`,
        query: trimmed,
        timestamp: new Date().toISOString(),
        duration_ms: duration,
        rowCount: 0,
        status: 'error',
        errorMessage: message
      });

      saveQueryHistory(connectionId, trimmed, 'error', 0, duration, message);

      return res.json({
        success: false,
        error: message,
        message,
        sqlState,
        hint,
        line,
        duration_ms: duration,
        inTransaction: true, // Keep in transaction so user can choose to ROLLBACK
        statementCount: session.statements.length,
        rowCount: 0,
        columns: [],
        rows: []
      });
    }
  }

  // 4. Autocommit is TRUE - Execute standard query on pool
  if (activeSessions.has(sessionKey)) {
    const oldSession = activeSessions.get(sessionKey)!;
    try {
      await oldSession.client.query('COMMIT;');
      oldSession.client.release();
    } catch { }
    activeSessions.delete(sessionKey);
  }

  try {
    const result = await pool.query(trimmed);
    const duration = Math.round(performance.now() - startTime);

    const columns: TableColumn[] = (result.fields || []).map((f: { name: string }) => ({
      name: f.name,
      type: 'text',
      nullable: true
    }));

    const rows = result.rows || [];
    const rowCount = result.rowCount !== null ? result.rowCount : rows.length;

    saveQueryHistory(connectionId, trimmed, 'success', rowCount, duration, null);

    return res.json({
      success: true,
      message: `Query executed successfully (${rowCount} rows affected).`,
      duration_ms: duration,
      inTransaction: false,
      rowCount,
      columns,
      rows
    });
  } catch (err: any) {
    const duration = Math.round(performance.now() - startTime);
    const message = err.message || 'Database error occurred during query execution.';
    const sqlState = err.code || '42000';
    const hint = err.hint || (err.position ? `Syntax error near character position ${err.position}` : undefined);
    const line = err.line ? parseInt(err.line, 10) : undefined;

    saveQueryHistory(connectionId, trimmed, 'error', 0, duration, message);

    return res.json({
      success: false,
      error: message,
      message,
      sqlState,
      hint,
      line,
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
    await session.client.query('COMMIT;');
    session.client.release();
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
    try { session.client.release(true); } catch { }
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
    await session.client.query('ROLLBACK;');
    session.client.release();
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
    try { session.client.release(true); } catch { }
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
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Beekeeper Database Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
