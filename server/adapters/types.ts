export interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  isPrimary?: boolean;
}

export interface TableMeta {
  name: string;
  schema: string;
  rowCount: number;
  columnsCount: number;
  columns?: ColumnMeta[];
}

export interface SchemaMeta {
  name: string;
  tables: TableMeta[];
}

export interface QueryResultData {
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  rowCount: number;
  message?: string;
  sqlState?: string;
  hint?: string;
  line?: number;
}

export interface TableDataFilter {
  filterCol?: string;
  filterOp?: string;
  filterVal?: string;
  sortCol?: string;
  sortDir?: 'ASC' | 'DESC';
  page: number;
  limit: number;
}

export interface TableDataResult {
  database: string;
  schema: string;
  tableName: string;
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TransactionStatement {
  id: string;
  query: string;
  timestamp: string;
  duration_ms: number;
  rowCount: number;
  status: 'pending' | 'success' | 'error';
  errorMessage?: string;
}

export interface TransactionSession {
  sessionId: string;
  connectionId: string;
  database: string;
  driver: string;
  inTransaction?: boolean;
  startedAt: number;
  lastActive: number;
  statements: TransactionStatement[];
  query(sql: string, values?: unknown[]): Promise<QueryResultData>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): Promise<void>;
}

export interface DatabaseDriverAdapter {
  driver: string;
  testConnection(): Promise<{ success: boolean; version?: string; latency_ms: number; message: string }>;
  listDatabases(): Promise<string[]>;
  listSchemasAndTables(): Promise<{ schemas: SchemaMeta[]; totalEntities: number }>;
  getTableColumns(tableName: string, schema?: string): Promise<ColumnMeta[]>;
  getTableDdl(tableName: string, schema?: string): Promise<string>;
  truncateTable(tableName: string, schema?: string, cascade?: boolean): Promise<void>;
  getTableData(tableName: string, schema: string, filter: TableDataFilter): Promise<TableDataResult>;
  insertRow(tableName: string, schema: string, rowData: Record<string, unknown>, session?: TransactionSession): Promise<{ row?: Record<string, unknown>; rowCount: number }>;
  updateRow(tableName: string, schema: string, identifierColumn: string, identifierValue: unknown, updatedData: Record<string, unknown>, session?: TransactionSession): Promise<{ updatedRow?: Record<string, unknown>; rowCount: number }>;
  deleteRow(tableName: string, schema: string, identifierColumn: string, identifierValue: unknown, session?: TransactionSession): Promise<{ rowCount: number }>;
  executeQuery(sql: string, session?: TransactionSession): Promise<QueryResultData>;
  createTransactionSession(sessionKey: string): Promise<TransactionSession>;
  close?(): Promise<void>;
}
