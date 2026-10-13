export type DriverType = 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver';
export type ConnectionEnvironment = 'development' | 'test' | 'production';

export interface DatabaseConnection {
  id: string;
  name: string;
  driver: DriverType;
  host: string;
  port: number;
  username: string;
  password?: string;
  default_database: string;
  ssl: number; // 0 or 1
  ssh_enabled: number; // 0 or 1
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_auth_method: 'password' | 'key';
  ssh_password?: string;
  ssh_key_file?: string;
  ssh_key_passphrase?: string;
  color: string;
  is_readonly: number; // 0 or 1
  environment?: ConnectionEnvironment;
  created_at: string;
}

export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  isPrimary?: boolean;
}

export interface TableSummary {
  name: string;
  schema: string;
  rowCount: number;
  columnsCount: number;
  columns: TableColumn[];
}

export interface SchemaGroup {
  name: string;
  tables: TableSummary[];
}

export interface QueryHistoryItem {
  id: string;
  connection_id: string;
  query_text: string;
  status: 'success' | 'error';
  row_count: number;
  duration_ms: number;
  error_message: string | null;
  created_at: string;
}

export interface ThemeConfig {
  theme: 'dark' | 'light';
  fontSize: number;
  autocommitDefault: boolean;
}

export type TabType = 'connection_form' | 'table_data' | 'query_editor';

export interface WorkspaceTab {
  id: string;
  type: TabType;
  title: string;
  isDirty?: boolean;
  connectionId?: string;
  // Specific properties
  tableName?: string;
  schemaName?: string;
  queryText?: string;
  savedQueryId?: string;
}

export interface QueryExecutionResult {
  success: boolean;
  message: string;
  duration_ms: number;
  rowCount: number;
  inTransaction: boolean;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  error?: string;
  sqlState?: string;
  line?: number;
  hint?: string;
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

export interface CompletedTransaction {
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

export interface TransactionLogResponse {
  inTransaction: boolean;
  startedAt: string | null;
  elapsedMs: number;
  statements: TransactionStatement[];
  history: CompletedTransaction[];
}
