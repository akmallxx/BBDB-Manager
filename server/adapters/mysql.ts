import mysql from 'mysql2/promise';
import type {
  DatabaseDriverAdapter,
  ColumnMeta,
  SchemaMeta,
  TableDataFilter,
  TableDataResult,
  QueryResultData,
  TransactionSession,
} from './types.ts';

function escapeId(name: string): string {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

const mysqlPools = new Map<string, mysql.Pool>();

export class MySqlAdapter implements DatabaseDriverAdapter {
  driver = 'mysql';
  private conn: Record<string, unknown>;
  private host: string;
  private port: number;
  private user: string;
  private password: string;
  private database: string;
  private ssl: boolean;
  private connId: string;

  constructor(conn: Record<string, unknown>, host: string, port: number, databaseOverride?: string) {
    this.conn = conn;
    this.host = host;
    this.port = port;
    this.user = (conn?.username as string) || 'root';
    this.password = (conn?.password as string) || '';
    this.database = databaseOverride || (conn?.default_database as string) || '';
    this.ssl = Boolean(conn?.ssl);
    this.connId = (conn?.id as string) || 'default';
  }

  private getPool(): mysql.Pool {
    const cacheKey = `${this.connId}:${this.host}:${this.port}:${this.user}:${this.database}:${this.ssl}`;
    if (!mysqlPools.has(cacheKey)) {
      const pool = mysql.createPool({
        host: this.host,
        port: this.port,
        user: this.user,
        password: this.password,
        database: this.database || undefined,
        ssl: this.ssl ? { rejectUnauthorized: false } : undefined,
        waitForConnections: true,
        connectionLimit: 15,
        idleTimeout: 30000,
        enableKeepAlive: true,
      });
      mysqlPools.set(cacheKey, pool);
    }
    return mysqlPools.get(cacheKey)!;
  }

  async testConnection(): Promise<{ success: boolean; version?: string; latency_ms: number; message: string }> {
    const startTime = performance.now();
    try {
      const conn = await mysql.createConnection({
        host: this.host,
        port: this.port,
        user: this.user,
        password: this.password,
        database: this.database || undefined,
        ssl: this.ssl ? { rejectUnauthorized: false } : undefined,
        connectTimeout: 8000,
      });

      const [rows] = await conn.query('SELECT VERSION() as version;');
      await conn.end();

      const version = Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' && 'version' in rows[0]
        ? String((rows[0] as Record<string, unknown>).version)
        : undefined;

      const latency = Math.round(performance.now() - startTime);
      return {
        success: true,
        message: 'Connected successfully to MySQL / MariaDB!',
        version,
        latency_ms: latency,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `MySQL Connection Failed: ${msg}`,
        latency_ms: Math.round(performance.now() - startTime),
      };
    }
  }

  async listDatabases(): Promise<string[]> {
    const pool = this.getPool();
    const [rows] = await pool.query('SHOW DATABASES;');
    if (!Array.isArray(rows)) return [this.database || 'default'];

    const dbNames = rows.map((r: unknown) => {
      if (r && typeof r === 'object') {
        const row = r as Record<string, unknown>;
        return String(row.Database || Object.values(row)[0] || '');
      }
      return '';
    }).filter(Boolean);

    return dbNames.length > 0 ? dbNames : [this.database || 'mysql'];
  }

  async listSchemasAndTables(): Promise<{ schemas: SchemaMeta[]; totalEntities: number }> {
    const pool = this.getPool();
    const targetDb = this.database || (await this.listDatabases())[0] || 'mysql';

    const tablesSql = `
      SELECT 
        t.TABLE_NAME as name,
        t.TABLE_SCHEMA as \`schema\`,
        COALESCE(t.TABLE_ROWS, 0) as rowCount,
        COALESCE(c.colCount, 0) as columnsCount
      FROM information_schema.TABLES t
      LEFT JOIN (
        SELECT TABLE_NAME, TABLE_SCHEMA, count(*) as colCount
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
        GROUP BY TABLE_NAME, TABLE_SCHEMA
      ) c ON c.TABLE_NAME = t.TABLE_NAME AND c.TABLE_SCHEMA = t.TABLE_SCHEMA
      WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
      ORDER BY t.TABLE_NAME;
    `;

    const [rows] = await pool.query(tablesSql, [targetDb, targetDb]);
    const tableList: SchemaMeta['tables'] = [];

    if (Array.isArray(rows)) {
      for (const r of rows) {
        const row = r as Record<string, unknown>;
        tableList.push({
          name: String(row.name),
          schema: String(row.schema || targetDb),
          rowCount: Math.max(0, parseInt(String(row.rowCount || '0'), 10)),
          columnsCount: parseInt(String(row.columnsCount || '0'), 10),
          columns: []
        });
      }
    }

    const schemas: SchemaMeta[] = [{
      name: targetDb,
      tables: tableList
    }];

    return { schemas, totalEntities: tableList.length };
  }

  async getTableColumns(tableName: string, schema?: string): Promise<ColumnMeta[]> {
    const pool = this.getPool();
    const targetDb = schema || this.database;

    const colQuery = `
      SELECT 
        c.COLUMN_NAME as name,
        c.DATA_TYPE as type,
        c.IS_NULLABLE as nullable,
        c.COLUMN_KEY as colKey
      FROM information_schema.COLUMNS c
      WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
      ORDER BY c.ORDINAL_POSITION;
    `;

    const [rows] = await pool.query(colQuery, [targetDb, tableName]);
    const columns: ColumnMeta[] = [];

    if (Array.isArray(rows)) {
      for (const r of rows) {
        const row = r as Record<string, unknown>;
        const isNullable = row.nullable === true || row.nullable === 1 || row.nullable === '1' || String(row.nullable).toUpperCase() === 'YES';
        const isPrimary = row.colKey === 'PRI' || row.isPrimary === true || row.isPrimary === 1 || row.isPrimary === '1';
        columns.push({
          name: String(row.name),
          type: String(row.type),
          nullable: isNullable,
          isPrimary,
        });
      }
    }

    return columns;
  }

  async getTableDdl(tableName: string, schema?: string): Promise<string> {
    const pool = this.getPool();
    const targetDb = schema || this.database;
    const [rows] = await pool.query(`SHOW CREATE TABLE ${escapeId(targetDb)}.${escapeId(tableName)};`);

    if (Array.isArray(rows) && rows[0]) {
      const row = rows[0] as Record<string, unknown>;
      const ddl = row['Create Table'] || row['Create View'] || Object.values(row)[1];
      if (ddl) {
        return `-- Table Definition: ${targetDb}.${tableName} (MySQL / MariaDB)\n${String(ddl)};`;
      }
    }

    throw new Error(`Table "${tableName}" not found in database "${targetDb}".`);
  }

  async truncateTable(tableName: string, schema?: string): Promise<void> {
    const pool = this.getPool();
    const targetDb = schema || this.database;
    await pool.query(`TRUNCATE TABLE ${escapeId(targetDb)}.${escapeId(tableName)};`);
  }

  async getTableData(tableName: string, schema?: string, filter: TableDataFilter = { page: 1, limit: 50 }): Promise<TableDataResult> {
    const pool = this.getPool();
    const targetDb = schema || this.database;
    const columns = await this.getTableColumns(tableName, targetDb);
    if (columns.length === 0) {
      throw new Error(`Table "${tableName}" not found in database "${targetDb}".`);
    }

    const { filterCol, filterOp, filterVal, sortCol, sortDir = 'ASC', page = 1, limit = 50 } = filter;
    const safeLimit = Math.max(1, Number(limit) || 50);
    const safePage = Math.max(1, Number(page) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    const values: unknown[] = [];
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
          values.push(filterVal);
        } else if (filterOp === 'lt') {
          whereClause = `WHERE ${colEsc} < ?`;
          values.push(filterVal);
        } else {
          whereClause = `WHERE ${colEsc} = ?`;
          values.push(filterVal);
        }
      }
    }

    const countSql = `SELECT count(*) as total FROM ${escapeId(targetDb)}.${escapeId(tableName)} ${whereClause}`;
    const [countRows] = await pool.query(countSql, values);
    let total = 0;
    if (Array.isArray(countRows) && countRows[0]) {
      total = parseInt(String((countRows[0] as Record<string, unknown>).total || '0'), 10);
    }

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
      SELECT * FROM ${escapeId(targetDb)}.${escapeId(tableName)}
      ${whereClause}
      ${orderClause}
      LIMIT ${safeLimit} OFFSET ${safeOffset}
    `;
    const [dataRows] = await pool.query(dataSql, values);

    return {
      database: targetDb,
      schema: targetDb,
      tableName,
      columns,
      rows: Array.isArray(dataRows) ? (dataRows as Record<string, unknown>[]) : [],
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    };
  }

  async insertRow(
    tableName: string,
    schema?: string,
    rowData: Record<string, unknown> = {},
    session?: TransactionSession
  ): Promise<{ row?: Record<string, unknown>; rowCount: number }> {
    const targetDb = schema || this.database;
    const keys = Object.keys(rowData).filter(k => rowData[k] !== undefined);
    if (keys.length === 0) {
      throw new Error('No column values provided to insert.');
    }

    const colsSql = keys.map(k => escapeId(k)).join(', ');
    const paramsSql = keys.map(() => '?').join(', ');
    const values = keys.map(k => rowData[k]);
    const sql = `INSERT INTO ${escapeId(targetDb)}.${escapeId(tableName)} (${colsSql}) VALUES (${paramsSql});`;

    if (session) {
      const res = await session.query(sql, values);
      return { row: rowData, rowCount: res.rowCount };
    }

    const pool = this.getPool();
    const [res] = await pool.query(sql, values);
    const resultObj = res as { insertId?: number; affectedRows?: number };

    let insertedRow: Record<string, unknown> | undefined = rowData;
    if (resultObj.insertId) {
      const columns = await this.getTableColumns(tableName, targetDb);
      const pkCol = columns.find(c => c.isPrimary)?.name;
      if (pkCol) {
        const [rows] = await pool.query(`SELECT * FROM ${escapeId(targetDb)}.${escapeId(tableName)} WHERE ${escapeId(pkCol)} = ? LIMIT 1;`, [resultObj.insertId]);
        if (Array.isArray(rows) && rows[0]) {
          insertedRow = rows[0] as Record<string, unknown>;
        }
      }
    }

    return { row: insertedRow, rowCount: resultObj.affectedRows || 1 };
  }

  async updateRow(
    tableName: string,
    schema?: string,
    identifierColumn = 'id',
    identifierValue?: unknown,
    updatedData: Record<string, unknown> = {},
    session?: TransactionSession
  ): Promise<{ updatedRow?: Record<string, unknown>; rowCount: number }> {
    const targetDb = schema || this.database;
    const keys = Object.keys(updatedData);
    if (keys.length === 0) {
      throw new Error('No updated fields provided.');
    }

    const setParts = keys.map(k => `${escapeId(k)} = ?`).join(', ');
    const values = keys.map(k => updatedData[k]);
    values.push(identifierValue);

    const sql = `UPDATE ${escapeId(targetDb)}.${escapeId(tableName)} SET ${setParts} WHERE ${escapeId(identifierColumn)} = ?;`;

    if (session) {
      const res = await session.query(sql, values);
      return { updatedRow: { ...updatedData, [identifierColumn]: identifierValue }, rowCount: res.rowCount };
    }

    const pool = this.getPool();
    const [res] = await pool.query(sql, values);
    const resultObj = res as { affectedRows?: number };

    let updatedRow: Record<string, unknown> = { ...updatedData, [identifierColumn]: identifierValue };
    try {
      const [rows] = await pool.query(`SELECT * FROM ${escapeId(targetDb)}.${escapeId(tableName)} WHERE ${escapeId(identifierColumn)} = ? LIMIT 1;`, [identifierValue]);
      if (Array.isArray(rows) && rows[0]) {
        updatedRow = rows[0] as Record<string, unknown>;
      }
    } catch { }

    return { updatedRow, rowCount: resultObj.affectedRows || 1 };
  }

  async deleteRow(
    tableName: string,
    schema?: string,
    identifierColumn = 'id',
    identifierValue?: unknown,
    session?: TransactionSession
  ): Promise<{ rowCount: number }> {
    const targetDb = schema || this.database;
    const sql = `DELETE FROM ${escapeId(targetDb)}.${escapeId(tableName)} WHERE ${escapeId(identifierColumn)} = ?;`;

    if (session) {
      const res = await session.query(sql, [identifierValue]);
      return { rowCount: res.rowCount };
    }

    const pool = this.getPool();
    const [res] = await pool.query(sql, [identifierValue]);
    const resultObj = res as { affectedRows?: number };
    return { rowCount: resultObj.affectedRows || 1 };
  }

  async executeQuery(sql: string, session?: TransactionSession): Promise<QueryResultData> {
    if (session) {
      return session.query(sql);
    }

    const pool = this.getPool();
    const [result, fields] = await pool.query(sql);

    if (Array.isArray(result)) {
      const columns: ColumnMeta[] = (fields || []).map((f) => ({
        name: f.name,
        type: 'text',
        nullable: true,
      }));
      return {
        columns,
        rows: result as Record<string, unknown>[],
        rowCount: result.length,
      };
    }

    const resultObj = result as { affectedRows?: number; insertId?: number };
    const rowCount = resultObj.affectedRows || 0;
    return {
      columns: [],
      rows: [],
      rowCount,
      message: `Affected ${rowCount} row(s).`,
    };
  }

  async createTransactionSession(sessionKey: string): Promise<TransactionSession> {
    const pool = this.getPool();
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    const statements: TransactionSession['statements'] = [];

    const session: TransactionSession = {
      sessionId: sessionKey,
      connectionId: this.connId,
      database: this.database,
      driver: 'mysql',
      inTransaction: true,
      startedAt: Date.now(),
      lastActive: Date.now(),
      statements,
      query: async (sqlText: string, values?: unknown[]) => {
        const startTime = performance.now();
        session.lastActive = Date.now();
        const [result, fields] = await connection.query(sqlText, values as unknown[]);
        const duration = Math.round(performance.now() - startTime);

        if (Array.isArray(result)) {
          const columns: ColumnMeta[] = (fields || []).map((f) => ({
            name: f.name,
            type: 'text',
            nullable: true,
          }));
          const rows = result as Record<string, unknown>[];
          const rowCount = rows.length;

          statements.push({
            id: `stmt-${Date.now()}-${statements.length + 1}`,
            query: sqlText,
            timestamp: new Date().toISOString(),
            duration_ms: duration,
            rowCount,
            status: 'pending',
          });

          return { columns, rows, rowCount };
        }

        const resultObj = result as { affectedRows?: number };
        const rowCount = resultObj.affectedRows || 0;

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
        await connection.commit();
      },
      rollback: async () => {
        await connection.rollback();
      },
      release: async () => {
        connection.release();
      },
    };

    return session;
  }
}
