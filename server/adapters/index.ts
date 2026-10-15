import type { DatabaseDriverAdapter } from './types.ts';
import { PostgresAdapter } from './postgres.ts';
import { MySqlAdapter } from './mysql.ts';
import { SqliteAdapter } from './sqlite.ts';
import { SqlServerAdapter } from './sqlserver.ts';

export * from './types.ts';
export { PostgresAdapter } from './postgres.ts';
export { MySqlAdapter } from './mysql.ts';
export { SqliteAdapter } from './sqlite.ts';
export { SqlServerAdapter } from './sqlserver.ts';

export function createAdapter(
  conn: Record<string, unknown>,
  host: string,
  port: number,
  databaseOverride?: string
): DatabaseDriverAdapter {
  const driver = (conn.driver as string)?.toLowerCase() || 'postgresql';

  if (driver === 'mysql') {
    return new MySqlAdapter(conn, host, port, databaseOverride);
  }
  if (driver === 'sqlite') {
    return new SqliteAdapter(conn, databaseOverride);
  }
  if (driver === 'sqlserver') {
    return new SqlServerAdapter(conn, host, port, databaseOverride);
  }

  return new PostgresAdapter(conn, host, port, databaseOverride);
}

export async function getAdapter(
  conn: Record<string, unknown>,
  databaseOverride?: string,
  resolveTunnel?: (conn: Record<string, unknown>) => Promise<{ localPort: number }>
): Promise<DatabaseDriverAdapter> {
  const driver = (conn.driver as string)?.toLowerCase() || 'postgresql';
  let host = (conn.host as string) || 'localhost';
  let port = Number(conn.port) || (driver === 'mysql' ? 3306 : driver === 'sqlserver' ? 1433 : 5432);

  if (driver !== 'sqlite' && conn && Boolean(conn.ssh_enabled) && resolveTunnel) {
    const tunnel = await resolveTunnel(conn);
    host = '127.0.0.1';
    port = tunnel.localPort;
  }

  return createAdapter(conn, host, port, databaseOverride);
}

export function getDefaultDatabase(driver?: string, defaultDb?: string): string {
  if (defaultDb) return defaultDb;
  const d = (driver || '').toLowerCase();
  if (d === 'mysql') return '';
  if (d === 'sqlite') return 'main';
  if (d === 'sqlserver') return 'master';
  return 'postgres';
}

export function getDefaultSchema(driver?: string, database?: string): string {
  const d = (driver || '').toLowerCase();
  if (d === 'mysql') return database || '';
  if (d === 'sqlite') return 'main';
  if (d === 'sqlserver') return 'dbo';
  return 'public';
}

