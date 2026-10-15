import mssql from 'mssql';
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
  return `[${String(name).replace(/\]/g, ']]')}]`;
}

const mssqlPools = new Map<string, mssql.ConnectionPool>();

export class SqlServerAdapter implements DatabaseDriverAdapter {
  driver = 'sqlserver';
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
    this.user = (conn?.username as string) || 'sa';
    this.password = (conn?.password as string) || '';
    this.database = databaseOverride || (conn?.default_database as string) || 'master';
    this.ssl = Boolean(conn?.ssl);
    this.connId = (conn?.id as string) || 'default';
  }

  private async getPool(): Promise<mssql.ConnectionPool> {
    const cacheKey = `${this.connId}:${this.host}:${this.port}:${this.user}:${this.database}:${this.ssl}`;
    if (!mssqlPools.has(cacheKey) || !mssqlPools.get(cacheKey)!.connected) {
      const config: mssql.config = {
        server: this.host,
        port: this.port || 1433,
        user: this.user,
        password: this.password,
        database: this.database || 'master',
        options: {
          encrypt: this.ssl,
          trustServerCertificate: true,
          connectTimeout: 8000,
          requestTimeout: 30000,
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000,
        },
      };

      const pool = new mssql.ConnectionPool(config);
      await pool.connect();
      mssqlPools.set(cacheKey, pool);
    }
    return mssqlPools.get(cacheKey)!;
  }

  async testConnection(): Promise<{ success: boolean; version?: string; latency_ms: number; message: string }> {
    const startTime = performance.now();
    try {
      const pool = await this.getPool();
      const result = await pool.request().query('SELECT @@VERSION as version;');
      const version = result.recordset[0]?.version as string | undefined;
      const latency = Math.round(performance.now() - startTime);

      return {
        success: true,
        message: 'Connected successfully to SQL Server (MSSQL)!',
        version: version ? version.split('\n')[0] : undefined,
        latency_ms: latency,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `MSSQL Connection Failed: ${msg}`,
        latency_ms: Math.round(performance.now() - startTime),
      };
    }
  }

  async listDatabases(): Promise<string[]> {
    const pool = await this.getPool();
    const result = await pool.request().query(`
      SELECT name 
      FROM sys.databases 
      WHERE state_desc = 'ONLINE' AND name NOT IN ('tempdb') 
      ORDER BY name;
    `);

    const names = result.recordset.map((r: { name: string }) => r.name);
    return names.length > 0 ? names : [this.database || 'master'];
  }

  async listSchemasAndTables(): Promise<{ schemas: SchemaMeta[]; totalEntities: number }> {
    const pool = await this.getPool();
    const query = `
      SELECT 
        t.TABLE_SCHEMA as [schema],
        t.TABLE_NAME as name,
        COALESCE(p.rows, 0) as rowCount,
        (
          SELECT count(*) 
          FROM INFORMATION_SCHEMA.COLUMNS c 
          WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
        ) as columnsCount
      FROM INFORMATION_SCHEMA.TABLES t
      LEFT JOIN (
        SELECT o.name as table_name, s.name as schema_name, SUM(p.rows) as rows
        FROM sys.objects o
        JOIN sys.schemas s ON o.schema_id = s.schema_id
        JOIN sys.partitions p ON o.object_id = p.object_id
        WHERE p.index_id IN (0, 1) AND o.type = 'U'
        GROUP BY o.name, s.name
      ) p ON p.table_name = t.TABLE_NAME AND p.schema_name = t.TABLE_SCHEMA
      WHERE t.TABLE_TYPE = 'BASE TABLE'
      ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME;
    `;

    const result = await pool.request().query(query);
    const schemaMap = new Map<string, SchemaMeta['tables']>();
    let totalEntities = 0;

    for (const r of result.recordset) {
      totalEntities++;
      const schemaName = String(r.schema || 'dbo');
      if (!schemaMap.has(schemaName)) {
        schemaMap.set(schemaName, []);
      }
      schemaMap.get(schemaName)!.push({
        name: String(r.name),
        schema: schemaName,
        rowCount: Math.max(0, parseInt(String(r.rowCount || '0'), 10)),
        columnsCount: parseInt(String(r.columnsCount || '0'), 10),
        columns: [],
      });
    }

    const schemas: SchemaMeta[] = Array.from(schemaMap.entries()).map(([name, tables]) => ({
      name,
      tables,
    }));

    return { schemas, totalEntities };
  }

  async getTableColumns(tableName: string, schema = 'dbo'): Promise<ColumnMeta[]> {
    const pool = await this.getPool();
    const req = pool.request();
    req.input('schema', mssql.NVarChar, schema);
    req.input('tableName', mssql.NVarChar, tableName);

    const query = `
      SELECT 
        c.COLUMN_NAME as name,
        c.DATA_TYPE as type,
        CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as nullable,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as isPrimary
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN (
        SELECT ku.COLUMN_NAME, ku.TABLE_SCHEMA, ku.TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
          ON tc.CONSTRAINT_TYPE = 'PRIMARY KEY' 
          AND tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
      ) pk ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA AND c.TABLE_NAME = pk.TABLE_NAME AND c.COLUMN_NAME = pk.COLUMN_NAME
      WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @tableName
      ORDER BY c.ORDINAL_POSITION;
    `;

    const result = await req.query(query);
    return result.recordset.map((r: { name: string; type: string; nullable: number | boolean; isPrimary: number | boolean }) => {
      const isNullable = r.nullable === 1 || r.nullable === true || String(r.nullable) === '1' || String(r.nullable).toUpperCase() === 'YES';
      const isPrimary = r.isPrimary === 1 || r.isPrimary === true || String(r.isPrimary) === '1';
      return {
        name: r.name,
        type: r.type,
        nullable: isNullable,
        isPrimary,
      };
    });
  }

  async getTableDdl(tableName: string, schema = 'dbo'): Promise<string> {
    const columns = await this.getTableColumns(tableName, schema);
    if (columns.length === 0) {
      throw new Error(`Table "${tableName}" not found in schema "${schema}".`);
    }

    const colDefs = columns.map((c) => {
      const nullStr = c.nullable ? ' NULL' : ' NOT NULL';
      return `    ${escapeId(c.name)} ${c.type.toUpperCase()}${nullStr}`;
    });

    const pkCols = columns.filter((c) => c.isPrimary).map((c) => escapeId(c.name));
    if (pkCols.length > 0) {
      colDefs.push(`    CONSTRAINT [PK_${tableName.replace(/\]/g, '')}] PRIMARY KEY (${pkCols.join(', ')})`);
    }

    return `-- Table Definition: ${schema}.${tableName} (SQL Server)\nCREATE TABLE ${escapeId(schema)}.${escapeId(tableName)} (\n${colDefs.join(',\n')}\n);`;
  }

  async truncateTable(tableName: string, schema = 'dbo'): Promise<void> {
    const pool = await this.getPool();
    await pool.request().query(`TRUNCATE TABLE ${escapeId(schema)}.${escapeId(tableName)};`);
  }

  async getTableData(tableName: string, schema = 'dbo', filter: TableDataFilter = { page: 1, limit: 50 }): Promise<TableDataResult> {
    const pool = await this.getPool();
    const columns = await this.getTableColumns(tableName, schema);
    if (columns.length === 0) {
      throw new Error(`Table "${tableName}" not found in schema "${schema}".`);
    }

    const { filterCol, filterOp, filterVal, sortCol, sortDir = 'ASC', page = 1, limit = 50 } = filter;
    const safeLimit = Math.max(1, Number(limit) || 50);
    const safePage = Math.max(1, Number(page) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    const req = pool.request();
    let whereClause = '';

    if (filterCol && filterVal !== undefined && filterVal !== '') {
      const validCol = columns.find((c) => c.name === filterCol);
      if (validCol) {
        req.input('filterVal', mssql.NVarChar, filterVal);
        const colEsc = escapeId(validCol.name);
        if (filterOp === 'contains') {
          whereClause = `WHERE ${colEsc} LIKE '%' + @filterVal + '%'`;
        } else if (filterOp === 'starts_with') {
          whereClause = `WHERE ${colEsc} LIKE @filterVal + '%'`;
        } else if (filterOp === 'gt') {
          whereClause = `WHERE ${colEsc} > @filterVal`;
        } else if (filterOp === 'lt') {
          whereClause = `WHERE ${colEsc} < @filterVal`;
        } else {
          whereClause = `WHERE ${colEsc} = @filterVal`;
        }
      }
    }

    const countSql = `SELECT count(*) as total FROM ${escapeId(schema)}.${escapeId(tableName)} ${whereClause};`;
    const countRes = await req.query(countSql);
    const total = parseInt(String(countRes.recordset[0]?.total || '0'), 10);

    let orderClause = '';
    const safeDir = sortDir === 'DESC' ? 'DESC' : 'ASC';
    if (sortCol) {
      const validSort = columns.find((c) => c.name === sortCol);
      if (validSort) {
        orderClause = `ORDER BY ${escapeId(validSort.name)} ${safeDir}`;
      }
    } else {
      const pkCol = columns.find((c) => c.isPrimary);
      if (pkCol) {
        orderClause = `ORDER BY ${escapeId(pkCol.name)} ASC`;
      } else {
        // MSSQL requires an ORDER BY for OFFSET FETCH
        orderClause = `ORDER BY (SELECT NULL)`;
      }
    }

    req.input('offset', mssql.Int, safeOffset);
    req.input('limit', mssql.Int, safeLimit);

    const dataSql = `
      SELECT * FROM ${escapeId(schema)}.${escapeId(tableName)}
      ${whereClause}
      ${orderClause}
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
    `;

    const dataRes = await req.query(dataSql);

    return {
      database: this.database,
      schema,
      tableName,
      columns,
      rows: dataRes.recordset || [],
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async insertRow(
    tableName: string,
    schema = 'dbo',
    rowData: Record<string, unknown> = {},
    session?: TransactionSession
  ): Promise<{ row?: Record<string, unknown>; rowCount: number }> {
    const keys = Object.keys(rowData).filter((k) => rowData[k] !== undefined);
    if (keys.length === 0) {
      throw new Error('No column values provided to insert.');
    }

    const colsSql = keys.map((k) => escapeId(k)).join(', ');
    const paramsSql = keys.map((_, i) => `@p${i}`).join(', ');

    if (session) {
      const sql = `INSERT INTO ${escapeId(schema)}.${escapeId(tableName)} (${colsSql}) VALUES (${paramsSql});`;
      const res = await session.query(sql, keys.map((k) => rowData[k]));
      return { row: rowData, rowCount: res.rowCount };
    }

    const pool = await this.getPool();
    const req = pool.request();
    keys.forEach((k, i) => {
      req.input(`p${i}`, rowData[k]);
    });

    const sql = `INSERT INTO ${escapeId(schema)}.${escapeId(tableName)} (${colsSql}) OUTPUT INSERTED.* VALUES (${paramsSql});`;
    const result = await req.query(sql);

    return {
      row: result.recordset[0] || rowData,
      rowCount: result.rowsAffected[0] || 1,
    };
  }

  async updateRow(
    tableName: string,
    schema = 'dbo',
    identifierColumn = 'id',
    identifierValue?: unknown,
    updatedData: Record<string, unknown> = {},
    session?: TransactionSession
  ): Promise<{ updatedRow?: Record<string, unknown>; rowCount: number }> {
    const keys = Object.keys(updatedData);
    if (keys.length === 0) {
      throw new Error('No updated fields provided.');
    }

    const setParts = keys.map((k, i) => `${escapeId(k)} = @p${i}`).join(', ');
    const idParam = `p${keys.length}`;

    if (session) {
      const sql = `UPDATE ${escapeId(schema)}.${escapeId(tableName)} SET ${setParts} WHERE ${escapeId(identifierColumn)} = @${idParam};`;
      const res = await session.query(sql, [...keys.map((k) => updatedData[k]), identifierValue]);
      return { updatedRow: { ...updatedData, [identifierColumn]: identifierValue }, rowCount: res.rowCount };
    }

    const pool = await this.getPool();
    const req = pool.request();
    keys.forEach((k, i) => {
      req.input(`p${i}`, updatedData[k]);
    });
    req.input(idParam, identifierValue);

    const sql = `UPDATE ${escapeId(schema)}.${escapeId(tableName)} SET ${setParts} OUTPUT INSERTED.* WHERE ${escapeId(identifierColumn)} = @${idParam};`;
    const result = await req.query(sql);

    return {
      updatedRow: result.recordset[0] || { ...updatedData, [identifierColumn]: identifierValue },
      rowCount: result.rowsAffected[0] || 1,
    };
  }

  async deleteRow(
    tableName: string,
    schema = 'dbo',
    identifierColumn = 'id',
    identifierValue?: unknown,
    session?: TransactionSession
  ): Promise<{ rowCount: number }> {
    const sql = `DELETE FROM ${escapeId(schema)}.${escapeId(tableName)} WHERE ${escapeId(identifierColumn)} = @p0;`;

    if (session) {
      const res = await session.query(sql, [identifierValue]);
      return { rowCount: res.rowCount };
    }

    const pool = await this.getPool();
    const req = pool.request();
    req.input('p0', identifierValue);
    const result = await req.query(sql);

    return { rowCount: result.rowsAffected[0] || 1 };
  }

  async executeQuery(sql: string, session?: TransactionSession): Promise<QueryResultData> {
    if (session) {
      return session.query(sql);
    }

    const pool = await this.getPool();
    const req = pool.request();
    const result = await req.query(sql);

    const columns: ColumnMeta[] = [];
    if (result.recordset && result.recordset.columns) {
      for (const colName of Object.keys(result.recordset.columns)) {
        const col = result.recordset.columns[colName];
        columns.push({
          name: col.name,
          type: (col.type as { declaration?: string })?.declaration || 'nvarchar',
          nullable: Boolean(col.nullable),
        });
      }
    }

    const rows = result.recordset || [];
    const rowCount = result.rowsAffected[0] || rows.length;

    return {
      columns,
      rows,
      rowCount,
    };
  }

  async createTransactionSession(sessionKey: string): Promise<TransactionSession> {
    const pool = await this.getPool();
    const tx = new mssql.Transaction(pool);
    await tx.begin();

    const statements: TransactionSession['statements'] = [];

    const session: TransactionSession = {
      sessionId: sessionKey,
      connectionId: this.connId,
      database: this.database,
      driver: 'sqlserver',
      inTransaction: true,
      startedAt: Date.now(),
      lastActive: Date.now(),
      statements,
      query: async (sqlText: string, values?: unknown[]) => {
        const startTime = performance.now();
        session.lastActive = Date.now();
        const req = tx.request();

        if (values && values.length > 0) {
          values.forEach((v, i) => {
            req.input(`p${i}`, v);
          });
        }

        const result = await req.query(sqlText);
        const duration = Math.round(performance.now() - startTime);

        const columns: ColumnMeta[] = [];
        if (result.recordset && result.recordset.columns) {
          for (const colName of Object.keys(result.recordset.columns)) {
            const col = result.recordset.columns[colName];
            columns.push({
              name: col.name,
              type: (col.type as { declaration?: string })?.declaration || 'nvarchar',
              nullable: Boolean(col.nullable),
            });
          }
        }

        const rows = result.recordset || [];
        const rowCount = result.rowsAffected[0] || rows.length;

        statements.push({
          id: `stmt-${Date.now()}-${statements.length + 1}`,
          query: sqlText,
          timestamp: new Date().toISOString(),
          duration_ms: duration,
          rowCount,
          status: 'pending',
        });

        return { columns, rows, rowCount };
      },
      commit: async () => {
        await tx.commit();
      },
      rollback: async () => {
        await tx.rollback();
      },
      release: async () => {
        // Transaction releases automatically on commit/rollback
      },
    };

    return session;
  }
}
