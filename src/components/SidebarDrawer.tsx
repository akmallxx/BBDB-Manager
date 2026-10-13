import { useState } from 'react';
import { Plus, Search, ChevronRight, ChevronDown, Table as TableIcon, RefreshCw, Trash2, Database, Layers, Terminal, MoreVertical, Edit3, Copy, Plug, Key, Unplug, FileCode, Download, ExternalLink } from 'lucide-react';
import { DatabaseConnection, SchemaGroup, QueryHistoryItem, TableColumn } from '../types/database';
import { Badge } from './ui/badge';
import { Select } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { cn, formatRelativeTime, triggerDownload } from '../lib/utils';
import { RailView } from './NavigationRail';
import { TableDdlModal } from './TableDdlModal';
import { useToast } from './ui/toast';
import { APP_NAME } from '../lib/config';

interface SidebarDrawerProps {
  currentView: RailView;
  // Connections
  connections: DatabaseConnection[];
  activeConnectionId?: string;
  selectedConnectionId?: string;
  onSelectConnection: (id: string) => void;
  onConnectConnection: (conn: DatabaseConnection) => void;
  onNewConnectionClick: () => void;
  onDeleteConnection: (id: string) => void;
  onDuplicateConnection?: (conn: DatabaseConnection) => void;
  onDisconnect?: () => void;
  // Entities
  activeDatabase: string;
  databasesList: string[];
  onChangeDatabase: (db: string) => void;
  schemas: SchemaGroup[];
  totalEntities: number;
  onRefreshSchemas: () => void;
  onOpenTable: (tableName: string, schemaName: string) => void;
  onOpenQueryTab?: (queryText: string) => void;
  activeTableName?: string;
  // History
  history: QueryHistoryItem[];
  onRefreshHistory: () => void;
  onClearHistory: () => void;
  onSelectHistoryItem: (query: string) => void;
}

export function SidebarDrawer({
  currentView,
  connections,
  activeConnectionId,
  selectedConnectionId,
  onSelectConnection,
  onConnectConnection,
  onNewConnectionClick,
  onDeleteConnection,
  onDuplicateConnection,
  onDisconnect,
  activeDatabase,
  databasesList,
  onChangeDatabase,
  schemas,
  totalEntities,
  onRefreshSchemas,
  onOpenTable,
  onOpenQueryTab,
  activeTableName,
  history,
  onRefreshHistory,
  onClearHistory,
  onSelectHistoryItem
}: SidebarDrawerProps) {
  const { success, error, info } = useToast();

  const [filterText, setFilterText] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [tableMenu, setTableMenu] = useState<{
    tableName: string;
    schemaName: string;
    x: number;
    y: number;
  } | null>(null);

  const [ddlModalData, setDdlModalData] = useState<{
    isOpen: boolean;
    tableName: string;
    schemaName: string;
    ddl: string;
    columnsCount?: number;
    primaryKeys?: string[];
  } | null>(null);

  const [expandedSchemas, setExpandedSchemas] = useState<Record<string, boolean>>({
    public: true,
    dbo: true,
    main: true
  });
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [tableColumns, setTableColumns] = useState<Record<string, TableColumn[]>>({});
  const [loadingTableCols, setLoadingTableCols] = useState<Record<string, boolean>>({});
  const [isRefreshingEntities, setIsRefreshingEntities] = useState(false);
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);

  const handleTableContextMenu = (tableName: string, schemaName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 230);
    const y = Math.min(e.clientY, window.innerHeight - 340);
    setTableMenu({ tableName, schemaName, x, y });
  };

  const handleTableThreeDotsClick = (tableName: string, schemaName: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.right + 4, window.innerWidth - 230);
    const y = Math.min(rect.top, window.innerHeight - 340);
    setTableMenu({ tableName, schemaName, x, y });
  };

  const handleFetchDdl = async (tableName: string, schemaName: string) => {
    if (!activeConnectionId) return;
    try {
      const res = await fetch(`/api/connections/${activeConnectionId}/tables/${tableName}/ddl?database=${encodeURIComponent(activeDatabase)}&schema=${encodeURIComponent(schemaName)}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setDdlModalData({
          isOpen: true,
          tableName,
          schemaName,
          ddl: data.ddl,
          columnsCount: data.columnsCount,
          primaryKeys: data.primaryKeys
        });
      } else {
        error('DDL Error', data.error || 'Failed to generate DDL.');
      }
    } catch {
      error('Network Error', 'Failed to fetch table DDL definition.');
    }
  };

  const handleExportTable = async (tableName: string, schemaName: string, format: 'csv' | 'json' | 'sql') => {
    if (!activeConnectionId) return;
    try {
      info('Exporting Table', `Fetching records from "${tableName}"...`);
      const res = await fetch(`/api/connections/${activeConnectionId}/tables/${tableName}/data?database=${encodeURIComponent(activeDatabase)}&schema=${encodeURIComponent(schemaName)}&limit=200`);
      const data = await res.json();
      if (!res.ok || !data.rows || data.rows.length === 0) {
        error('Export Failed', data.error || 'No rows found to export.');
        return;
      }

      if (format === 'json') {
        triggerDownload(JSON.stringify(data.rows, null, 2), `${tableName}.json`, 'application/json');
      } else if (format === 'csv') {
        const colNames = data.columns.map((c: any) => c.name);
        const headerLine = colNames.map((n: string) => `"${n.replace(/"/g, '""')}"`).join(',');
        const dataLines = data.rows.map((r: any) => {
          return colNames.map((n: string) => {
            const val = r[n];
            if (val === null || val === undefined) return '';
            return `"${String(val).replace(/"/g, '""')}"`;
          }).join(',');
        });
        triggerDownload([headerLine, ...dataLines].join('\n'), `${tableName}.csv`, 'text/csv');
      } else if (format === 'sql') {
        const colNames = data.columns.map((c: any) => c.name);
        const colsSql = colNames.map((n: string) => `"${n}"`).join(', ');
        const sqlLines = data.rows.map((r: any) => {
          const values = colNames.map((n: string) => {
            const val = r[n];
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number') return String(val);
            return `'${String(val).replace(/'/g, "''")}'`;
          }).join(', ');
          return `INSERT INTO "${schemaName}"."${tableName}" (${colsSql}) VALUES (${values});`;
        });
        triggerDownload(sqlLines.join('\n'), `${tableName}.sql`, 'text/plain');
      }
      success('Export Complete', `Successfully exported ${data.rows.length} rows as ${format.toUpperCase()}.`);
    } catch {
      error('Network Error', 'Failed to export table data.');
    }
  };

  const handleTruncateTable = async (tableName: string, schemaName: string) => {
    if (!activeConnectionId) return;
    const confirmed = window.confirm(`⚠️ WARNING: Are you sure you want to TRUNCATE "${schemaName}"."${tableName}"?\n\nThis will permanently delete all records from this table.`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/connections/${activeConnectionId}/tables/${tableName}/truncate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database: activeDatabase,
          schema: schemaName,
          cascade: false
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        success('Table Truncated', data.message || `Table "${tableName}" was truncated.`);
        onRefreshSchemas();
      } else {
        error('Truncate Error', data.error || 'Failed to truncate table.');
      }
    } catch {
      error('Network Error', 'Failed to truncate table.');
    }
  };

  const handleRefreshEntitiesClick = () => {
    setIsRefreshingEntities(true);
    onRefreshSchemas();
    setTimeout(() => {
      setIsRefreshingEntities(false);
    }, 700);
  };

  const handleRefreshHistoryClick = () => {
    setIsRefreshingHistory(true);
    onRefreshHistory();
    setTimeout(() => {
      setIsRefreshingHistory(false);
    }, 700);
  };

  const toggleSchema = (schemaName: string) => {
    setExpandedSchemas(prev => ({ ...prev, [schemaName]: !prev[schemaName] }));
  };

  const toggleTable = async (tableName: string, schemaName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const willExpand = !expandedTables[tableName];
    setExpandedTables(prev => ({ ...prev, [tableName]: willExpand }));

    if (willExpand && !tableColumns[tableName] && activeConnectionId) {
      setLoadingTableCols(prev => ({ ...prev, [tableName]: true }));
      try {
        const res = await fetch(`/api/connections/${activeConnectionId}/tables/${tableName}/columns?database=${encodeURIComponent(activeDatabase)}&schema=${encodeURIComponent(schemaName)}`);
        if (res.ok) {
          const data = await res.json();
          setTableColumns(prev => ({ ...prev, [tableName]: data.columns || [] }));
        }
      } catch {
        // ignore error
      } finally {
        setLoadingTableCols(prev => ({ ...prev, [tableName]: false }));
      }
    }
  };

  return (
    <aside className="w-64 h-screen bg-zinc-900 border-r border-zinc-800 flex flex-col shrink-0 select-none overflow-hidden">
      {/* =========================================================================
          VIEW 1: CONNECTIONS LIST (Matches Beekeeper Image #2)
      ========================================================================== */}
      {currentView === 'connections' && (
        <div className="flex flex-col h-full">
          {/* Top Button & Filter */}
          <div className="p-3 border-b border-zinc-800/80 space-y-2">
            {/* App Brand Header */}
            <div className="flex items-center gap-2 px-0.5 pb-1">
              <img src="/logo.png" alt={APP_NAME} className="w-5 h-5 rounded object-contain shadow-xs" />
              <span className="text-xs font-semibold font-mono tracking-wider text-zinc-200">{APP_NAME}</span>
            </div>

            <button
              onClick={onNewConnectionClick}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700/80 text-zinc-100 text-xs font-medium border border-zinc-700/50 transition-colors shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4 text-zinc-300" />
              <span>New Connection</span>
            </button>

            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Filter"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                className="w-full bg-zinc-950/80 border border-zinc-800 rounded-md py-1.5 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-yellow-400"
              />
            </div>
          </div>

          {/* Section: SAVED */}
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">Saved</span>
              <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-zinc-800 text-zinc-400 font-mono">
                {connections.length}
              </span>
            </div>
          </div>

          {/* List of Saved Connections */}
          <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
            {connections
              .filter(c => c.name.toLowerCase().includes(filterText.toLowerCase()) || c.driver.toLowerCase().includes(filterText.toLowerCase()))
              .map(conn => {
                const isSelected = conn.id === selectedConnectionId;
                const isActive = conn.id === activeConnectionId;
                const subtitle = conn.ssh_enabled
                  ? `${conn.host || 'localhost'} > ${conn.ssh_host}:${conn.port}/${conn.default_database}`
                  : `${conn.host || 'localhost'}:${conn.port}/${conn.default_database}`;

                return (
                  <div
                    key={conn.id}
                    onClick={() => onSelectConnection(conn.id)}
                    onDoubleClick={() => onConnectConnection(conn)}
                    className={cn(
                      'group relative flex items-center justify-between p-1 rounded-md transition-all cursor-pointer border',
                      isSelected
                        ? 'bg-zinc-800/90 border-zinc-700'
                        : 'bg-zinc-900/50 hover:bg-zinc-800/50 border-transparent hover:border-zinc-800'
                    )}
                  >
                    {/* Vertical colored strip on the left (Signature Beekeeper) */}
                    <div
                      className="absolute left-1 top-1 bottom-1 w-0.5 rounded-r-sm"
                      style={{ backgroundColor: conn.color || '#06b6d4' }}
                    />

                    {/* Connection Info */}
                    <div className="ml-2.5 flex-1 min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-zinc-300 truncate">{conn.name}</span>
                        {conn.environment === 'production' && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/30 shrink-0">
                            PROD
                          </span>
                        )}
                        {conn.environment === 'test' && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
                            TEST
                          </span>
                        )}
                        {(!conn.environment || conn.environment === 'development') && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                            DEV
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-zinc-400 font-mono truncate tracking-tight">
                        {subtitle}
                      </div>
                    </div>

                    {/* Driver Badge & 3-Dots Action Menu */}
                    <div className="flex items-center gap-1 shrink-0 relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === conn.id ? null : conn.id);
                        }}
                        className={cn(
                          'p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60 transition-opacity cursor-pointer',
                          openMenuId === conn.id ? 'opacity-100 bg-zinc-700/60 text-zinc-100' : 'opacity-0 group-hover:opacity-100'
                        )}
                        title="Connection options"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>

                      {/* 3-Dots Dropdown Menu */}
                      {openMenuId === conn.id && (
                        <>
                          {/* Invisible backdrop to dismiss menu */}
                          <div
                            className="fixed inset-0 z-40"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(null);
                            }}
                          />
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 top-7 z-50 w-44 rounded-md bg-zinc-900 border border-zinc-700 shadow-xl py-1 text-xs select-none animate-in fade-in-50 zoom-in-95"
                          >
                            {conn.id === activeConnectionId && onDisconnect ? (
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  onDisconnect();
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-amber-300 hover:bg-amber-500/10 transition-colors cursor-pointer text-left"
                              >
                                <Unplug className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span>Disconnect</span>
                                <span className="text-[10px] text-zinc-500 ml-auto font-mono">Ctrl+Shift+Q</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  onConnectConnection(conn);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
                              >
                                <Plug className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                <span>Connect</span>
                              </button>
                            )}

                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                onSelectConnection(conn.id);
                              }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                              <span>Edit Connection</span>
                            </button>

                            {onDuplicateConnection && (
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  onDuplicateConnection(conn);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
                              >
                                <Copy className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                                <span>Duplicate</span>
                              </button>
                            )}

                            <div className="border-t border-zinc-800 my-1" />

                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                if (confirm(`Delete connection "${conn.name}"?`)) {
                                  onDeleteConnection(conn.id);
                                }
                              }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer text-left"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-400 shrink-0" />
                              <span>Delete Connection</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

            {connections.length === 0 && (
              <div className="p-4 text-center text-xs text-zinc-500">
                No saved connections yet. Click New Connection to start.
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW 2: ENTITIES / SCHEMA EXPLORER (Matches Beekeeper Image #3 & #5)
      ========================================================================== */}
      {currentView === 'entities' && (
        <div className="flex flex-col h-full">
          {/* Database Selector Header */}
          <div className="p-2 border-b border-zinc-800/80 bg-zinc-950/40">
            <div className="flex items-center justify-between gap-1 mb-2">
              <div className="flex-1 min-w-0">
                <Select
                  value={activeDatabase}
                  onChange={e => onChangeDatabase(e.target.value)}
                  icon={<Database className="w-3.5 h-3.5 text-zinc-400" />}
                  sizeVariant="sm"
                >
                  {databasesList.map(db => (
                    <option key={db} value={db}>
                      {db}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                onClick={handleRefreshEntitiesClick}
                title="Refresh database entities"
                className="p-1.5 text-zinc-400 hover:text-zinc-100 rounded hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
              >
                <RefreshCw className={cn('w-3.5 h-3.5 transition-transform', isRefreshingEntities && 'animate-spin text-yellow-400')} />
              </button>
            </div>

            {/* Entities Filter Input */}
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2 top-2 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Filter"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded py-1 pl-7 pr-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-yellow-400"
              />
            </div>
          </div>

          {/* Section: ENTITIES + Count Badge (e.g. ENTITIES 14) */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">Entities</span>
              <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-zinc-800 text-zinc-300 font-mono">
                {totalEntities.toLocaleString('en-US')}
              </span>
            </div>
          </div>

          {/* Schemas & Tables Tree View */}
          <div className="flex-1 overflow-y-auto px-1 py-1 text-xs">
            {schemas.map(schema => {
              const isExpanded = expandedSchemas[schema.name] ?? true;
              const filteredTables = schema.tables.filter(t =>
                t.name.toLowerCase().includes(filterText.toLowerCase())
              );

              return (
                <div key={schema.name} className="mb-2">
                  {/* Schema Folder Header (e.g. public) */}
                  <button
                    onClick={() => toggleSchema(schema.name)}
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-zinc-300 hover:bg-zinc-800/60 rounded text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-zinc-500" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-zinc-500" />
                    )}
                    <Layers className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="font-mono text-zinc-300">{schema.name}</span>
                  </button>

                  {/* Tables List */}
                  {isExpanded && (
                    <div className="ml-3 pl-1 border-l border-zinc-800/60 space-y-0.5 mt-0.5">
                      {filteredTables.map(tbl => {
                        const isCurrentActive = activeTableName === tbl.name;
                        const isTableExpanded = Boolean(expandedTables[tbl.name]);
                        const cols = tableColumns[tbl.name] || tbl.columns || [];
                        const isLoadingCols = Boolean(loadingTableCols[tbl.name]);
                        const canExpand = cols.length > 0 || tbl.columnsCount > 0;

                        return (
                          <div key={tbl.name} className="flex flex-col">
                            <div
                              onClick={() => onOpenTable(tbl.name, schema.name)}
                              onContextMenu={e => handleTableContextMenu(tbl.name, schema.name, e)}
                              className={cn(
                                'w-full flex items-center justify-between px-1.5 py-1 rounded text-left transition-colors cursor-pointer group',
                                isCurrentActive
                                  ? 'bg-yellow-400/15 text-yellow-300 font-medium'
                                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70',
                                tableMenu?.tableName === tbl.name && 'bg-zinc-800 text-zinc-100'
                              )}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                {canExpand ? (
                                  <button
                                    type="button"
                                    onClick={e => toggleTable(tbl.name, schema.name, e)}
                                    className="p-0.5 hover:text-yellow-400 text-zinc-500 rounded transition-colors"
                                    title={isTableExpanded ? "Collapse columns" : "Expand columns"}
                                  >
                                    {isTableExpanded ? (
                                      <ChevronDown className="w-2.5 h-2.5" />
                                    ) : (
                                      <ChevronRight className="w-2.5 h-2.5" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="w-3.5" />
                                )}
                                <TableIcon className={cn('w-3 h-3 shrink-0', isCurrentActive ? 'text-yellow-400' : 'text-yellow-500/80')} />
                                <span className="truncate font-mono text-[11px]">{tbl.name}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {tbl.columnsCount > 0 && (
                                  <span
                                    className="text-[9px] text-zinc-500 font-mono opacity-0 group-hover:opacity-100 transition-opacity"
                                    title={`${tbl.columnsCount} columns`}
                                  >
                                    {tbl.columnsCount}
                                  </span>
                                )}
                                {/* Three dots button */}
                                <button
                                  type="button"
                                  onClick={e => handleTableThreeDotsClick(tbl.name, schema.name, e)}
                                  className={cn(
                                    "p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/60 transition-opacity cursor-pointer",
                                    tableMenu?.tableName === tbl.name ? "opacity-100 text-zinc-200" : "opacity-0 group-hover:opacity-100"
                                  )}
                                  title="Table Actions (Click or Right-Click)"
                                >
                                  <MoreVertical className="w-3 h-3" />
                                </button>
                              </div>
                            </div>

                            {/* Expanded Table Columns List */}
                            {isTableExpanded && (
                              <div className="ml-5 pl-1.5 border-l border-zinc-800 space-y-0.5 py-0.5 my-0.5">
                                {isLoadingCols && (
                                  <div className="text-[10px] text-zinc-500 italic px-1 py-0.5">
                                    Loading columns...
                                  </div>
                                )}
                                {!isLoadingCols && cols.length === 0 && (
                                  <div className="text-[10px] text-zinc-500 italic px-1 py-0.5">
                                    No columns found
                                  </div>
                                )}
                                {!isLoadingCols && cols.map(col => (
                                  <div
                                    key={col.name}
                                    className="flex items-center justify-between py-0.5 px-1 rounded text-[10px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                                    title={`${col.name} (${col.type})${col.isPrimary ? ' • Primary Key' : ''}${col.nullable ? ' • Nullable' : ' • NOT NULL'}`}
                                  >
                                    <div className="flex items-center gap-1 min-w-0">
                                      {col.isPrimary ? (
                                        <Key className="w-2.5 h-2.5 text-yellow-400 shrink-0" />
                                      ) : (
                                        <span className="w-2.5 text-center text-zinc-600">·</span>
                                      )}
                                      <span className={cn('truncate', col.isPrimary && 'text-yellow-300 font-medium')}>
                                        {col.name}
                                      </span>
                                    </div>
                                    <span className="text-[9px] text-zinc-500 font-sans lowercase shrink-0">
                                      {col.type.split(' ')[0].slice(0, 7)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {filteredTables.length === 0 && (
                        <div className="px-2 py-1 text-[11px] text-zinc-500 italic">
                          No matching tables
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW 3: QUERY HISTORY (Matches Beekeeper Image #4)
      ========================================================================== */}
      {currentView === 'history' && (
        <div className="flex flex-col h-full">
          {/* History Header */}
          <div className="p-3 border-b border-zinc-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-wider text-zinc-300 uppercase">History</span>
              <button
                onClick={handleRefreshHistoryClick}
                title="Refresh history"
                className="text-zinc-500 hover:text-zinc-200 p-1 rounded hover:bg-zinc-800 cursor-pointer"
              >
                <RefreshCw className={cn('w-3 h-3 transition-transform', isRefreshingHistory && 'animate-spin text-yellow-400')} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="showAllHistory"
                checked={showAllHistory}
                onCheckedChange={setShowAllHistory}
                label="Show all"
              />
              <button
                onClick={() => {
                  if (confirm('Clear all query history?')) {
                    onClearHistory();
                  }
                }}
                title="Clear history"
                className="text-zinc-500 hover:text-red-400 p-1 rounded hover:bg-zinc-800 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* History Query List */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
            {history
              .filter(item => showAllHistory || (activeConnectionId ? item.connection_id === activeConnectionId : true))
              .map(item => {
                const isError = item.status === 'error';
                return (
                  <div
                    key={item.id}
                    onClick={() => onSelectHistoryItem(item.query_text)}
                    className="p-2 rounded bg-zinc-950/60 hover:bg-zinc-800/80 border border-zinc-800 hover:border-zinc-700 transition-all cursor-pointer group"
                  >
                    <div className="flex items-start gap-1.5">
                      <Terminal className={cn('w-3 h-3 mt-0.5 shrink-0', isError ? 'text-red-400' : 'text-purple-400')} />
                      <div className="flex-1 min-w-0">
                        <pre className="text-[11px] font-mono text-zinc-200 truncate leading-snug">
                          {item.query_text.split('\n')[0]}
                        </pre>
                        <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-1">
                          <span>
                            {isError ? 'Error' : `${item.row_count} Results`}
                          </span>
                          <span className="font-mono">
                            {formatRelativeTime(item.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

            {history.length === 0 && (
              <div className="p-4 text-center text-xs text-zinc-500">
                No queries executed yet. Run queries from the SQL editor to see history.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table Context Menu (Right Click & Three Dots) */}
      {tableMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setTableMenu(null)}
            onContextMenu={e => {
              e.preventDefault();
              setTableMenu(null);
            }}
          />
          <div
            style={{ left: `${tableMenu.x}px`, top: `${tableMenu.y}px` }}
            className="fixed z-50 w-56 bg-zinc-900 border border-zinc-700/80 rounded-lg shadow-2xl py-1 text-xs text-zinc-200 font-sans animate-in fade-in-50 zoom-in-95"
          >
            <div className="px-3 py-1.5 border-b border-zinc-800 text-[10px] font-mono text-zinc-400 flex items-center justify-between bg-zinc-950/50 rounded-t-lg">
              <span className="truncate font-semibold text-yellow-300">{tableMenu.tableName}</span>
              <span className="text-zinc-500 shrink-0">{tableMenu.schemaName}</span>
            </div>

            {/* 1. Open Table Data */}
            <button
              onClick={() => {
                onOpenTable(tableMenu.tableName, tableMenu.schemaName);
                setTableMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <TableIcon className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
              <span>Open Table Data</span>
            </button>

            {/* 2. Query TOP 100 */}
            <button
              onClick={() => {
                onOpenQueryTab?.(`SELECT * FROM "${tableMenu.schemaName}"."${tableMenu.tableName}" LIMIT 100;`);
                setTableMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>Query Data (TOP 100)</span>
            </button>

            {/* 3. View DDL */}
            <button
              onClick={() => {
                handleFetchDdl(tableMenu.tableName, tableMenu.schemaName);
                setTableMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <FileCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>View DDL (CREATE TABLE)</span>
            </button>

            <div className="border-t border-zinc-800 my-1" />

            {/* 4. Export Table actions */}
            <button
              onClick={() => {
                handleExportTable(tableMenu.tableName, tableMenu.schemaName, 'csv');
                setTableMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Export as CSV</span>
            </button>

            <button
              onClick={() => {
                handleExportTable(tableMenu.tableName, tableMenu.schemaName, 'json');
                setTableMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Export as JSON</span>
            </button>

            <button
              onClick={() => {
                handleExportTable(tableMenu.tableName, tableMenu.schemaName, 'sql');
                setTableMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Export as SQL Inserts</span>
            </button>

            <div className="border-t border-zinc-800 my-1" />

            {/* 5. Copy actions */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(tableMenu.tableName);
                success('Copied', `Copied "${tableMenu.tableName}" to clipboard`);
                setTableMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <Copy className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Copy Table Name</span>
            </button>

            <button
              onClick={() => {
                const sql = `SELECT * FROM "${tableMenu.schemaName}"."${tableMenu.tableName}";`;
                navigator.clipboard.writeText(sql);
                success('Copied SQL', `Copied SELECT query to clipboard`);
                setTableMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <Copy className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span>Copy SELECT Query</span>
            </button>

            <div className="border-t border-zinc-800 my-1" />

            {/* 6. Truncate Table */}
            <button
              onClick={() => {
                handleTruncateTable(tableMenu.tableName, tableMenu.schemaName);
                setTableMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer text-left"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span>Truncate Table...</span>
            </button>
          </div>
        </>
      )}

      {/* DDL Viewer Modal */}
      {ddlModalData && (
        <TableDdlModal
          isOpen={ddlModalData.isOpen}
          onClose={() => setDdlModalData(null)}
          tableName={ddlModalData.tableName}
          schemaName={ddlModalData.schemaName}
          ddl={ddlModalData.ddl}
          columnsCount={ddlModalData.columnsCount}
          primaryKeys={ddlModalData.primaryKeys}
          onOpenInEditor={(ddl) => {
            onOpenQueryTab?.(ddl);
            setDdlModalData(null);
          }}
        />
      )}
    </aside>
  );
}
