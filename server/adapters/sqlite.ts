import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type {
  DatabaseDriverAdapter,
  ColumnMeta,
  SchemaMeta,
  TableDataFilter,
  TableDataResult,
  QueryResultData,
  TransactionSession,
} from './types.ts';

type SqliteBindValue = string | number | bigint | null | Uint8Array;

function escapeId(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function toSqliteParam(val: unknown): SqliteBindValue {
  if (val === undefined || val === null) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'number' || typeof val === 'bigint' || typeof val === 'string') return val;
  if (val instanceof Uint8Array) return val;
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

const sqliteInstances = new Map<string, DatabaseSync>();

export class SqliteAdapter implements DatabaseDriverAdapter {
  driver = 'sqlite';
  private conn: Record<string, unknown>;
  private resolvedPath: string;
  private isReadOnly: boolean;
  private connId: string;

  constructor(conn: Record<string, unknown>, databaseOverride?: string) {
    this.conn = conn;
    this.connId = (conn?.id as string) || 'default';
    this.isReadOnly = Boolean(conn?.is_readonly);

    const rawPath = databaseOverride || (conn?.default_database as string) || (conn?.host as string) || 'database.db';
    let resolved = rawPath.startsWith('~')
      ? path.join(os.homedir(), rawPath.slice(1))
      : rawPath;

    if (!path.isAbsolute(resolved)) {
      resolved = path.resolve(resolved);
    }
    this.resolvedPath = resolved;
  }

  private getDb(): DatabaseSync {
    if (!sqliteInstances.has(this.resolvedPath)) {
      const dir = path.dirname(this.resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const db = new DatabaseSync(this.resolvedPath, {
        readOnly: this.isReadOnly,
      });
      sqliteInstances.set(this.resolvedPath, db);
    }
    return sqliteInstances.get(this.resolvedPath)!;
  }

  async testConnection(): Promise<{ success: boolean; version?: string; latency_ms: number; message: string }> {
    const startTime = performance.now();
    try {
      const dir = path.dirname(this.resolvedPath);
      if (!fs.existsSync(dir)) {
        return {
          success: false,
          message: `SQLite Connection Failed: Directory "${dir}" does not exist.`,
          latency_ms: Math.round(performance.now() - startTime),
        };
      }

      const db = this.getDb();
      const row = db.prepare('SELECT sqlite_version() as version;').get() as { version: string } | undefined;
      const latency = Math.round(performance.now() - startTime);

      return {
        success: true,
        message: `SQLite database file verified at "${this.resolvedPath}".`,
        version: row?.version,
        latency_ms: latency,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `SQLite Connection Failed: ${msg}`,
        latency_ms: Math.round(performance.now() - startTime),
      };
    }
  }

  async listDatabases(): Promise<string[]> {
    const dbName = path.basename(this.resolvedPath, path.extname(this.resolvedPath)) || 'main';
    return ['main', dbName];
  }

  async listSchemasAndTables(): Promise<{ schemas: SchemaMeta[]; totalEntities: number }> {
    const db = this.getDb();
    const tablesStmt = db.prepare(`
      SELECT name 
      FROM sqlite_master 
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' 
      ORDER BY name;
    `);

    const tableRows = tablesStmt.all() as Array<{ name: string }>;
    const tables: SchemaMeta['tables'] = [];

    for (const t of tableRows) {
      let rowCount = 0;
      let columnsCount = 0;
      try {
        const countRow = db.prepare(`SELECT count(*) as count FROM ${escapeId(t.name)}`).get() as { count: number };
        rowCount = Number(countRow?.count || 0);
      } catch { }

      try {
        const cols = db.prepare(`PRAGMA table_info(${escapeId(t.name)})`).all();
        columnsCount = cols.length;
      } catch { }

      tables.push({
        name: t.name,
        schema: 'main',
        rowCount,
        columnsCount,
        columns: [],
      });
    }

    const schemas: SchemaMeta[] = [{
      name: 'main',
      tables,
    }];

    return { schemas, totalEntities: tables.length };
  }

  async getTableColumns(tableName: string): Promise<ColumnMeta[]> {
    const db = this.getDb();
    const rows = db.prepare(`PRAGMA table_info(${escapeId(tableName)})`).all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;

    return rows.map((r) => ({
      name: r.name,
      type: r.type || 'TEXT',
      nullable: r.notnull === 0,
      isPrimary: Number(r.pk) > 0,
    }));
  }

  async getTableDdl(tableName: string): Promise<string> {
    const db = this.getDb();
    const tableRow = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?;`).get(tableName) as { sql: string } | undefined;

    if (!tableRow || !tableRow.sql) {
      throw new Error(`Table "${tableName}" not found.`);
    }

    const indexes = db.prepare(`
      SELECT sql 
      FROM sqlite_master 
      WHERE type='index' AND tbl_name = ? AND sql IS NOT NULL;
    `).all(tableName) as Array<{ sql: string }>;

    let ddl = `-- Table Definition: ${tableName} (SQLite)\n${tableRow.sql};`;
    if (indexes.length > 0) {
      ddl += '\n\n-- Indexes:\n' + indexes.map(i => `${i.sql};`).join('\n');
    }

    return ddl;
  }

  async truncateTable(tableName: string): Promise<void> {
    const db = this.getDb();
    db.exec(`DELETE FROM ${escapeId(tableName)};`);
    try {
      db.exec('VACUUM;');
    } catch { }
  }

  async getTableData(tableName: string, _schema?: string, filter: TableDataFilter = { page: 1, limit: 50 }): Promise<TableDataResult> {
    const db = this.getDb();
    const columns = await this.getTableColumns(tableName);
    if (columns.length === 0) {
      throw new Error(`Table "${tableName}" not found.`);
    }

    const { filterCol, filterOp, filterVal, sortCol, sortDir = 'ASC', page = 1, limit = 50 } = filter;
    const safeLimit = Math.max(1, Number(limit) || 50);
    const safePage = Math.max(1, Number(page) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    const values: SqliteBindValue[] = [];
    let whereClause = '';
    if (filterCol && filterVal !== undefined && filterVal !== '') {
      const validCol = columns.find(c => c.name === filterCol);
      if (validCol) {
        const colEsc = escapeId(validCol.name);
        if (filterOp === 'contains') {
          whereClause = `WHERE ${colEsc} LIKE ?`;
          values.push(`%${filterVal}%`);
        } else if (filterOp === 'starts_with') {
          whereClause = `WHERE ${colEsc} LIKE ?`;
          values.push(`${filterVal}%`);
        } else if (filterOp === 'gt') {
          whereClause = `WHERE ${colEsc} > ?`;
          values.push(isNaN(Number(filterVal)) ? filterVal : Number(filterVal));
        } else if (filterOp === 'lt') {
          whereClause = `WHERE ${colEsc} < ?`;
          values.push(isNaN(Number(filterVal)) ? filterVal : Number(filterVal));
        } else {
          whereClause = `WHERE ${colEsc} = ?`;
          values.push(isNaN(Number(filterVal)) ? filterVal : Number(filterVal));
        }
      }
    }

    const countSql = `SELECT count(*) as total FROM ${escapeId(tableName)} ${whereClause};`;
    const countRow = db.prepare(countSql).get(...values) as { total: number } | undefined;
    const total = Number(countRow?.total || 0);

    let orderClause = '';
    const safeDir = sortDir === 'DESC' ? 'DESC' : 'ASC';
    if (sortCol) {
      const validSort = columns.find(c => c.name === sortCol);
      if (validSort) {
        orderClause = `ORDER BY ${escapeId(validSort.name)} ${safeDir}`;
      }
    } else {
      const pkCol = columns.find(c => c.isPrimary);
      if (pkCol) {
        orderClause = `ORDER BY ${escapeId(pkCol.name)} ASC`;
      }
    }

    const dataSql = `
      SELECT * FROM ${escapeId(tableName)}
      ${whereClause}
      ${orderClause}
      LIMIT ? OFFSET ?;
    `;
    const dataStmt = db.prepare(dataSql);
    const dataRows = dataStmt.all(...values, safeLimit, safeOffset) as Record<string, unknown>[];

    return {
      database: 'main',
      schema: 'main',
      tableName,
      columns,
      rows: dataRows,
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    };
  }

  async insertRow(
    tableName: string,
    _schema?: string,
    rowData: Record<string, unknown> = {},
    session?: TransactionSession
  ): Promise<{ row?: Record<string, unknown>; rowCount: number }> {
    const keys = Object.keys(rowData).filter(k => rowData[k] !== undefined);
    if (keys.length === 0) {
      throw new Error('No column values provided to insert.');
    }

    const colsSql = keys.map(k => escapeId(k)).join(', ');
    const paramsSql = keys.map(() => '?').join(', ');
    const values = keys.map(k => toSqliteParam(rowData[k]));

    if (session) {
      const sql = `INSERT INTO ${escapeId(tableName)} (${colsSql}) VALUES (${paramsSql});`;
      const res = await session.query(sql, values);
      return { row: rowData, rowCount: res.rowCount };
    }

    const db = this.getDb();
    try {
      // Try RETURNING * if SQLite version supports it
      const returningSql = `INSERT INTO ${escapeId(tableName)} (${colsSql}) VALUES (${paramsSql}) RETURNING *;`;
      const row = db.prepare(returningSql).get(...values) as Record<string, unknown>;
      return { row: row || rowData, rowCount: 1 };
    } catch {
      const fallbackSql = `INSERT INTO ${escapeId(tableName)} (${colsSql}) VALUES (${paramsSql});`;
      const result = db.prepare(fallbackSql).run(...values);
      let insertedRow: Record<string, unknown> = rowData;
      if (result.lastInsertRowid) {
        try {
          const fetchRow = db.prepare(`SELECT * FROM ${escapeId(tableName)} WHERE rowid = ?;`).get(result.lastInsertRowid);
          if (fetchRow) insertedRow = fetchRow as Record<string, unknown>;
        } catch { }
      }
      return { row: insertedRow, rowCount: Number(result.changes || 1) };
    }
  }

  async updateRow(
    tableName: string,
    _schema?: string,
    identifierColumn = 'id',
    identifierValue?: unknown,
    updatedData: Record<string, unknown> = {},
    session?: TransactionSession
  ): Promise<{ updatedRow?: Record<string, unknown>; rowCount: number }> {
    const keys = Object.keys(updatedData);
    if (keys.length === 0) {
      throw new Error('No updated fields provided.');
    }

    const setParts = keys.map(k => `${escapeId(k)} = ?`).join(', ');
    const values = keys.map(k => toSqliteParam(updatedData[k]));
    values.push(toSqliteParam(identifierValue));

    if (session) {
      const sql = `UPDATE ${escapeId(tableName)} SET ${setParts} WHERE ${escapeId(identifierColumn)} = ?;`;
      const res = await session.query(sql, values);
      return { updatedRow: { ...updatedData, [identifierColumn]: identifierValue }, rowCount: res.rowCount };
    }

    const db = this.getDb();
    try {
      const sql = `UPDATE ${escapeId(tableName)} SET ${setParts} WHERE ${escapeId(identifierColumn)} = ? RETURNING *;`;
      const row = db.prepare(sql).get(...values) as Record<string, unknown>;
      return { updatedRow: row || { ...updatedData, [identifierColumn]: identifierValue }, rowCount: 1 };
    } catch {
      const sql = `UPDATE ${escapeId(tableName)} SET ${setParts} WHERE ${escapeId(identifierColumn)} = ?;`;
      const result = db.prepare(sql).run(...values);
      let updatedRow: Record<string, unknown> = { ...updatedData, [identifierColumn]: identifierValue };
      try {
        const fetchRow = db.prepare(`SELECT * FROM ${escapeId(tableName)} WHERE ${escapeId(identifierColumn)} = ?;`).get(toSqliteParam(identifierValue));
        if (fetchRow) updatedRow = fetchRow as Record<string, unknown>;
      } catch { }
      return { updatedRow, rowCount: Number(result.changes || 1) };
    }
  }

  async deleteRow(
    tableName: string,
    _schema?: string,
    identifierColumn = 'id',
    identifierValue?: unknown,
    session?: TransactionSession
  ): Promise<{ rowCount: number }> {
    const sql = `DELETE FROM ${escapeId(tableName)} WHERE ${escapeId(identifierColumn)} = ?;`;

    if (session) {
      const res = await session.query(sql, [toSqliteParam(identifierValue)]);
      return { rowCount: res.rowCount };
    }

    const db = this.getDb();
    const result = db.prepare(sql).run(toSqliteParam(identifierValue));
    return { rowCount: Number(result.changes || 1) };
  }

  async executeQuery(sql: string, session?: TransactionSession): Promise<QueryResultData> {
    if (session) {
      return session.query(sql);
    }

    const db = this.getDb();
    const trimmed = sql.trim();
    const isSelect = /^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(trimmed);

    if (isSelect) {
      const stmt = db.prepare(trimmed);
      const cols = stmt.columns();
      const rows = stmt.all() as Record<string, unknown>[];
      const columns: ColumnMeta[] = cols.map((c) => ({
        name: c.name,
        type: c.type || 'TEXT',
        nullable: true,
      }));

      return {
        columns,
        rows,
        rowCount: rows.length,
      };
    }

    // DML or DDL
    try {
      const stmt = db.prepare(trimmed);
      const result = stmt.run();
      const rowCount = Number(result.changes || 0);
      return {
        columns: [],
        rows: [],
        rowCount,
        message: `Command executed. Changes: ${rowCount}.`,
      };
    } catch {
      // If prepare fails because of multi-statements (e.g. scripts)
      db.exec(trimmed);
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        message: 'Script executed successfully.',
      };
    }
  }

  async createTransactionSession(sessionKey: string): Promise<TransactionSession> {
    const db = this.getDb();
    db.exec('BEGIN;');

    const statements: TransactionSession['statements'] = [];

    const session: TransactionSession = {
      sessionId: sessionKey,
      connectionId: this.connId,
      database: 'main',
      driver: 'sqlite',
      inTransaction: true,
      startedAt: Date.now(),
      lastActive: Date.now(),
      statements,
      query: async (sqlText: string, values?: unknown[]) => {
        const startTime = performance.now();
        session.lastActive = Date.now();
        const trimmed = sqlText.trim();
        const isSelect = /^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(trimmed);

        const mappedValues = values && values.length > 0 ? values.map(toSqliteParam) : undefined;

        if (isSelect) {
          const stmt = db.prepare(trimmed);
          const cols = stmt.columns();
          const rows = (mappedValues ? stmt.all(...mappedValues) : stmt.all()) as Record<string, unknown>[];
          const duration = Math.round(performance.now() - startTime);

          const columns: ColumnMeta[] = cols.map((c) => ({
            name: c.name,
            type: c.type || 'TEXT',
            nullable: true,
          }));

          statements.push({
            id: `stmt-${Date.now()}-${statements.length + 1}`,
            query: sqlText,
            timestamp: new Date().toISOString(),
            duration_ms: duration,
            rowCount: rows.length,
            status: 'pending',
          });

          return { columns, rows, rowCount: rows.length };
        }

        const stmt = db.prepare(trimmed);
        const result = mappedValues ? stmt.run(...mappedValues) : stmt.run();
        const duration = Math.round(performance.now() - startTime);
        const rowCount = Number(result.changes || 0);

        statements.push({
          id: `stmt-${Date.now()}-${statements.length + 1}`,
          query: sqlText,
          timestamp: new Date().toISOString(),
          duration_ms: duration,
          rowCount,
          status: 'pending',
        });

        return { columns: [], rows: [], rowCount };
      },
      commit: async () => {
        db.exec('COMMIT;');
      },
      rollback: async () => {
        db.exec('ROLLBACK;');
      },
      release: async () => {
        // No connection pooling in SQLite single-file mode
      },
    };

    return session;
  }
}
