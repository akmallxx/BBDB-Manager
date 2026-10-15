import pg from 'pg';
import type {
  DatabaseDriverAdapter,
  ColumnMeta,
  SchemaMeta,
  TableDataFilter,
  TableDataResult,
  QueryResultData,
  TransactionSession,
} from './types.ts';

const { Pool, Client } = pg;
const pgPools = new Map<string, pg.Pool>();

function escapeId(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

export class PostgresAdapter implements DatabaseDriverAdapter {
  driver = 'postgresql';
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
    this.user = (conn?.username as string) || 'postgres';
    this.password = (conn?.password as string) || '';
    this.database = databaseOverride || (conn?.default_database as string) || 'postgres';
    this.ssl = Boolean(conn?.ssl);
    this.connId = (conn?.id as string) || 'default';
  }

  private getPool(): pg.Pool {
    const cacheKey = `${this.connId}:${this.host}:${this.port}:${this.user}:${this.database}:${this.ssl}`;
    if (!pgPools.has(cacheKey)) {
      const pool = new Pool({
        host: this.host,
        port: this.port,
        user: this.user,
        password: this.password,
        database: this.database,
        ssl: this.ssl ? { rejectUnauthorized: false } : false,
        max: 15,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 8000,
      });
      pool.on('error', (err) => {
        console.error(`PostgreSQL Pool error (${cacheKey}):`, err.message);
      });
      pgPools.set(cacheKey, pool);
    }
    return pgPools.get(cacheKey)!;
  }

  async testConnection(): Promise<{ success: boolean; version?: string; latency_ms: number; message: string }> {
    const startTime = performance.now();
    const client = new Client({
      host: this.host,
      port: this.port,
      user: this.user,
      password: this.password,
      database: this.database,
      ssl: this.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 8000
    });

    try {
      await client.connect();
      const versionRes = await client.query('SELECT version();');
      await client.end();
      const latency = Math.round(performance.now() - startTime);
      return {
        success: true,
        message: 'Connected successfully to PostgreSQL!',
        version: versionRes.rows[0]?.version,
        latency_ms: latency
      };
    } catch (err: unknown) {
      try { await client.end(); } catch { }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `PostgreSQL Connection Failed: ${msg}`,
        latency_ms: Math.round(performance.now() - startTime)
      };
    }
  }

  async listDatabases(): Promise<string[]> {
    const pool = this.getPool();
    const result = await pool.query('SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;');
    const databases = result.rows.map(r => r.datname);
    return databases.length > 0 ? databases : [this.database];
  }

  async listSchemasAndTables(): Promise<{ schemas: SchemaMeta[]; totalEntities: number }> {
    const pool = this.getPool();
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
      columns: ColumnMeta[];
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

    const schemas: SchemaMeta[] = Array.from(schemaGroupsMap.entries()).map(([name, tables]) => ({
      name,
      tables
    }));

    return { schemas, totalEntities };
  }

  async getTableColumns(tableName: string, schema = 'public'): Promise<ColumnMeta[]> {
    const pool = this.getPool();
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
    return colRes.rows;
  }

  async getTableDdl(tableName: string, schema = 'public'): Promise<string> {
    const pool = this.getPool();
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
      throw new Error(`Table "${tableName}" not found in schema "${schema}".`);
    }

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

    const colDefs = colRes.rows.map(col => {
      let typeStr = col.data_type;
      if (col.data_type === 'character varying' && col.character_maximum_length) {
        typeStr = `varchar(${col.character_maximum_length})`;
      } else if (col.data_type === 'character' && col.character_maximum_length) {
        typeStr = `char(${col.character_maximum_length})`;
      } else if (col.data_type === 'numeric' && col.numeric_precision) {
        typeStr = `numeric(${col.numeric_precision}${col.numeric_scale ? `, ${col.numeric_scale}` : ''})`;
      } else if (col.udt_name && col.udt_name !== col.data_type) {
        typeStr = col.udt_name;
      }
      const nullStr = col.is_nullable === 'NO' ? ' NOT NULL' : '';
      const defStr = col.column_default ? ` DEFAULT ${col.column_default}` : '';
      return `    "${col.column_name}" ${typeStr}${nullStr}${defStr}`;
    });

    if (pkCols.length > 0) {
      colDefs.push(`    CONSTRAINT "${tableName}_pkey" PRIMARY KEY (${pkCols.join(', ')})`);
    }

    const fkSql = `
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2;
    `;
    const fkRes = await pool.query(fkSql, [schema, tableName]);
    for (const fk of fkRes.rows) {
      colDefs.push(
        `    CONSTRAINT "${fk.constraint_name}" FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.foreign_table_schema}"."${fk.foreign_table_name}" ("${fk.foreign_column_name}")`
      );
    }

    return `-- Table Definition: ${schema}.${tableName} (PostgreSQL)\nCREATE TABLE "${schema}"."${tableName}" (\n${colDefs.join(',\n')}\n);`;
  }

  async truncateTable(tableName: string, schema = 'public', cascade = false): Promise<void> {
    const pool = this.getPool();
    await pool.query(`TRUNCATE TABLE ${escapeId(schema)}.${escapeId(tableName)} ${cascade ? 'CASCADE' : ''};`);
  }

  async getTableData(tableName: string, schema = 'public', filter: TableDataFilter = { page: 1, limit: 50 }): Promise<TableDataResult> {
    const pool = this.getPool();
    const columns = await this.getTableColumns(tableName, schema);
    if (columns.length === 0) {
      throw new Error(`Table "${tableName}" not found in schema "${schema}".`);
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
        values.push(filterVal);
        const idx = values.length;
        const colEsc = escapeId(validCol.name);
        if (filterOp === 'contains') {
          whereClause = `WHERE ${colEsc}::text ILIKE '%' || $${idx} || '%'`;
        } else if (filterOp === 'starts_with') {
          whereClause = `WHERE ${colEsc}::text ILIKE $${idx} || '%'`;
        } else if (filterOp === 'gt') {
          whereClause = `WHERE ${colEsc} > $${idx}`;
        } else if (filterOp === 'lt') {
          whereClause = `WHERE ${colEsc} < $${idx}`;
        } else {
          whereClause = `WHERE ${colEsc}::text = $${idx}`;
        }
      }
    }

    const countSql = `SELECT count(*)::bigint as total FROM ${escapeId(schema)}.${escapeId(tableName)} ${whereClause}`;
    const countRes = await pool.query(countSql, values);
    const total = parseInt(countRes.rows[0]?.total, 10) || 0;

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
      SELECT * FROM ${escapeId(schema)}.${escapeId(tableName)}
      ${whereClause}
      ${orderClause}
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;
    const dataRes = await pool.query(dataSql, [...values, safeLimit, safeOffset]);

    return {
      database: this.database,
      schema,
      tableName,
      columns,
      rows: dataRes.rows,
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    };
  }

  async insertRow(
    tableName: string,
    schema = 'public',
    rowData: Record<string, unknown> = {},
    session?: TransactionSession
  ): Promise<{ row?: Record<string, unknown>; rowCount: number }> {
    const keys = Object.keys(rowData).filter(k => rowData[k] !== undefined);
    if (keys.length === 0) {
      throw new Error('No column values provided to insert.');
    }

    const colsSql = keys.map(k => escapeId(k)).join(', ');
    const paramsSql = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map(k => rowData[k]);
    const sql = `INSERT INTO ${escapeId(schema)}.${escapeId(tableName)} (${colsSql}) VALUES (${paramsSql}) RETURNING *;`;

    if (session) {
      const res = await session.query(sql, values);
      return { row: res.rows[0], rowCount: res.rowCount };
    }

    const pool = this.getPool();
    const result = await pool.query(sql, values);
    return { row: result.rows[0], rowCount: result.rowCount || 1 };
  }

  async updateRow(
    tableName: string,
    schema = 'public',
    identifierColumn: string,
    identifierValue: unknown,
    updatedData: Record<string, unknown> = {},
    session?: TransactionSession
  ): Promise<{ updatedRow?: Record<string, unknown>; rowCount: number }> {
    const keys = Object.keys(updatedData);
    if (keys.length === 0) {
      throw new Error('No updated fields provided.');
    }

    const setParts = keys.map((k, i) => `${escapeId(k)} = $${i + 1}`).join(', ');
    const values = keys.map(k => updatedData[k]);
    values.push(identifierValue);
    const idParamIdx = values.length;

    const sql = `UPDATE ${escapeId(schema)}.${escapeId(tableName)} SET ${setParts} WHERE ${escapeId(identifierColumn)} = $${idParamIdx} RETURNING *;`;

    if (session) {
      const res = await session.query(sql, values);
      return { updatedRow: res.rows[0], rowCount: res.rowCount };
    }

    const pool = this.getPool();
    const result = await pool.query(sql, values);
    return { updatedRow: result.rows[0], rowCount: result.rowCount || 1 };
  }

  async deleteRow(
    tableName: string,
    schema = 'public',
    identifierColumn: string,
    identifierValue: unknown,
    session?: TransactionSession
  ): Promise<{ rowCount: number }> {
    const sql = `DELETE FROM ${escapeId(schema)}.${escapeId(tableName)} WHERE ${escapeId(identifierColumn)} = $1;`;

    if (session) {
      const res = await session.query(sql, [identifierValue]);
      return { rowCount: res.rowCount };
    }

    const pool = this.getPool();
    const result = await pool.query(sql, [identifierValue]);
    return { rowCount: result.rowCount || 1 };
  }

  async executeQuery(sql: string, session?: TransactionSession): Promise<QueryResultData> {
    if (session) {
      return session.query(sql);
    }

    const pool = this.getPool();
    const result = await pool.query(sql);
    const columns: ColumnMeta[] = (result.fields || []).map((f: { name: string }) => ({
      name: f.name,
      type: 'text',
      nullable: true
    }));
    const rows = result.rows || [];
    const rowCount = result.rowCount !== null ? result.rowCount : rows.length;

    return { columns, rows, rowCount };
  }

  async createTransactionSession(sessionKey: string): Promise<TransactionSession> {
    const pool = this.getPool();
    const client = await pool.connect();
    await client.query('BEGIN;');

    const statements: TransactionSession['statements'] = [];

    const session: TransactionSession = {
      sessionId: sessionKey,
      connectionId: this.connId,
      database: this.database,
      driver: 'postgresql',
      inTransaction: true,
      startedAt: Date.now(),
      lastActive: Date.now(),
      statements,
      query: async (sqlText: string, values?: unknown[]) => {
        const startTime = performance.now();
        session.lastActive = Date.now();
        const res = await client.query(sqlText, values);
        const duration = Math.round(performance.now() - startTime);

        const columns: ColumnMeta[] = (res.fields || []).map((f: { name: string }) => ({
          name: f.name,
          type: 'text',
          nullable: true
        }));
        const rows = res.rows || [];
        const rowCount = res.rowCount !== null ? res.rowCount : rows.length;

        statements.push({
          id: `stmt-${Date.now()}-${statements.length + 1}`,
          query: sqlText,
          timestamp: new Date().toISOString(),
          duration_ms: duration,
          rowCount,
          status: 'pending'
        });

        return { columns, rows, rowCount };
      },
      commit: async () => {
        await client.query('COMMIT;');
      },
      rollback: async () => {
        await client.query('ROLLBACK;');
      },
      release: async () => {
        client.release();
      }
    };

    return session;
  }
}
