import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, Plus, Download, RefreshCw, Copy, Check, Filter, Trash2, Edit3, X, Save, PlusCircle, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown, Key, Columns, ExternalLink, MoreVertical, FileCode, Terminal } from 'lucide-react';
import { TableColumn, DatabaseConnection } from '../types/database';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { cn, triggerDownload, getColumnTypeBadgeClass, formatRelativeTime } from '../lib/utils';
import { useToast } from './ui/toast';
import { ConnectionFooter } from './ConnectionFooter';

interface DataTableViewProps {
  connection: DatabaseConnection;
  connectionId: string;
  database: string;
  schemaName: string;
  tableName: string;
  autocommit?: boolean;
  inTransaction?: boolean;
  fontSize?: number;
  defaultQueryLimit?: number;
  onTransactionChange?: (inTx: boolean) => void;
  onRefreshHistory?: () => void;
  onDisconnect?: () => void;
  onOpenQueryTab?: (queryText: string) => void;
}

export function DataTableView({
  connection,
  connectionId,
  database,
  schemaName,
  tableName,
  autocommit = true,
  inTransaction = false,
  fontSize = 13,
  defaultQueryLimit = 50,
  onTransactionChange,
  onRefreshHistory,
  onDisconnect,
  onOpenQueryTab
}: DataTableViewProps) {
  const { success, error, info } = useToast();

  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalRows, setTotalRows] = useState(0);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(defaultQueryLimit || 50);

  useEffect(() => {
    if (defaultQueryLimit && defaultQueryLimit !== limit) {
      setLimit(defaultQueryLimit);
      setPage(1);
    }
  }, [defaultQueryLimit]);
  const [lastFetchedTime, setLastFetchedTime] = useState<Date>(new Date());
  const [relativeTimeText, setRelativeTimeText] = useState('Just now');

  useEffect(() => {
    const updateRelative = () => {
      setRelativeTimeText(formatRelativeTime(lastFetchedTime.toISOString()));
    };
    updateRelative();
    const timer = setInterval(updateRelative, 10000);
    return () => clearInterval(timer);
  }, [lastFetchedTime]);

  // Filter toolbar state
  const [filterCol, setFilterCol] = useState('created_at');
  const [filterOp, setFilterOp] = useState('equals');
  const [filterVal, setFilterVal] = useState('');
  const [activeFilterActive, setActiveFilterActive] = useState(false);

  // Sorting
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Selected cell & copied cell
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  // Export dropdown
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const handleManualRefresh = () => {
    setIsManualRefreshing(true);
    fetchData(activeFilterActive);
    setTimeout(() => {
      setIsManualRefreshing(false);
    }, 700);
  };

  // ==========================================
  // CRUD STATE
  // ==========================================
  const [isEditingEnabled, setIsEditingEnabled] = useState(true);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; colName: string } | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState<string>('');
  const inlineInputRef = useRef<HTMLInputElement>(null);

  // Insert Row Modal (Create)
  const [showInsertModal, setShowInsertModal] = useState(false);
  const [insertFormData, setInsertFormData] = useState<Record<string, string>>({});

  // Edit Row Modal (Full Row Update)
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState<Record<string, string>>({});
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);

  // Delete confirmation modal
  const [rowToDelete, setRowToDelete] = useState<{ rowIdx: number; label: string } | null>(null);

  // Table Structure Modal
  const [showStructureModal, setShowStructureModal] = useState(false);
  const [structureSearch, setStructureSearch] = useState('');

  // Primary key column helper
  const primaryKeyCol = useMemo(() => {
    return columns.find(c => c.isPrimary)?.name || columns[0]?.name || '_id';
  }, [columns]);

  // Row Action Context Menu / 3-dots Dropdown state
  const [rowMenu, setRowMenu] = useState<{
    rowIdx: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && rowMenu) {
        setRowMenu(null);
      }
    };
    if (rowMenu) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rowMenu]);

  const handleRowThreeDotsClick = (rowIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.right + 4, window.innerWidth - 260);
    const y = Math.min(rect.top, window.innerHeight - 440);
    setRowMenu({ rowIdx, x, y });
  };

  const handleRowContextMenu = (rowIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 260);
    const y = Math.min(e.clientY, window.innerHeight - 440);
    setRowMenu({ rowIdx, x, y });
  };

  const handleCloneRow = (rowIdx: number) => {
    if (connection.is_readonly) {
      error('Read Only', 'Cannot insert records into a read-only database.');
      return;
    }
    const row = rows[rowIdx];
    if (!row) return;
    const clonedValues: Record<string, string> = {};
    columns.forEach(col => {
      if (col.isPrimary || col.name === primaryKeyCol) {
        clonedValues[col.name] = '';
      } else {
        clonedValues[col.name] = row[col.name] === null || row[col.name] === undefined ? '' : String(row[col.name]);
      }
    });
    setInsertFormData(clonedValues);
    setShowInsertModal(true);
  };

  const generateInsertSql = (row: Record<string, unknown>) => {
    const colList = columns.map(c => `"${c.name}"`).join(', ');
    const valList = columns.map(c => {
      const v = row[c.name];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return String(v);
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return `'${String(v).replace(/'/g, "''")}'`;
    }).join(', ');
    return `INSERT INTO "${schemaName}"."${tableName}" (${colList})\nVALUES (${valList});`;
  };

  const generateUpdateSql = (row: Record<string, unknown>) => {
    const setParts = columns
      .filter(c => c.name !== primaryKeyCol)
      .map(c => {
        const v = row[c.name];
        const valStr = v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : `'${String(v).replace(/'/g, "''")}'`;
        return `  "${c.name}" = ${valStr}`;
      })
      .join(',\n');
    const pkVal = row[primaryKeyCol];
    const pkStr = pkVal === null || pkVal === undefined ? 'NULL' : typeof pkVal === 'number' ? String(pkVal) : `'${String(pkVal).replace(/'/g, "''")}'`;
    return `UPDATE "${schemaName}"."${tableName}"\nSET\n${setParts}\nWHERE "${primaryKeyCol}" = ${pkStr};`;
  };

  const generateDeleteSql = (row: Record<string, unknown>) => {
    const pkVal = row[primaryKeyCol];
    const pkStr = pkVal === null || pkVal === undefined ? 'NULL' : typeof pkVal === 'number' ? String(pkVal) : `'${String(pkVal).replace(/'/g, "''")}'`;
    return `DELETE FROM "${schemaName}"."${tableName}"\nWHERE "${primaryKeyCol}" = ${pkStr};`;
  };

  const handleCopyDdl = async () => {
    try {
      const res = await fetch(`/api/connections/${connectionId}/tables/${tableName}/ddl?database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schemaName)}`);
      const data = await res.json();
      if (res.ok && data.success && data.ddl) {
        navigator.clipboard.writeText(data.ddl);
        success('Copied DDL', `CREATE TABLE statement for "${tableName}" copied to clipboard.`);
      } else {
        error('DDL Error', data.error || 'Failed to generate table DDL.');
      }
    } catch {
      error('Network Error', 'Failed to generate table DDL.');
    }
  };

  // Fetch Table Data (Read)
  const fetchData = useCallback(async (isFilterApplied: boolean = false) => {
    setLoading(true);
    try {
      let url = `/api/connections/${connectionId}/tables/${tableName}/data?database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schemaName)}&page=${page}&limit=${limit}`;

      if (isFilterApplied && filterVal.trim()) {
        url += `&filterCol=${encodeURIComponent(filterCol)}&filterOp=${encodeURIComponent(filterOp)}&filterVal=${encodeURIComponent(filterVal.trim())}`;
      }

      if (sortCol) {
        url += `&sortCol=${encodeURIComponent(sortCol)}&sortDir=${sortDir}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (res.ok) {
        setColumns(data.columns || []);
        setRows(data.rows || []);
        setTotalRows(data.total || 0);
        setLastFetchedTime(new Date());
        if (data.columns && data.columns.length > 0 && !columns.length) {
          setFilterCol(data.columns[0].name);
        }
      } else {
        error('Data Error', data.error || 'Failed to load table rows');
      }
    } catch {
      error('Network Error', 'Failed to fetch table records from server.');
    } finally {
      setLoading(false);
    }
  }, [connectionId, database, schemaName, tableName, page, limit, filterCol, filterOp, filterVal, sortCol, sortDir, columns.length, error]);

  useEffect(() => {
    fetchData(activeFilterActive);
  }, [fetchData, activeFilterActive]);

  // Refresh table data if transaction was committed or rolled back externally
  const prevInTxRef = useRef(inTransaction);
  useEffect(() => {
    if (prevInTxRef.current && !inTransaction) {
      fetchData(activeFilterActive);
    }
    prevInTxRef.current = inTransaction;
  }, [inTransaction, fetchData, activeFilterActive]);

  useEffect(() => {
    if (editingCell && inlineInputRef.current) {
      inlineInputRef.current.focus();
      inlineInputRef.current.select();
    }
  }, [editingCell]);

  const handleApplyFilter = () => {
    setPage(1);
    setActiveFilterActive(Boolean(filterVal.trim()));
    fetchData(Boolean(filterVal.trim()));
  };

  const handleSort = (colName: string) => {
    if (sortCol === colName) {
      if (sortDir === 'asc') setSortDir('desc');
      else {
        setSortCol(null);
        setSortDir('asc');
      }
    } else {
      setSortCol(colName);
      setSortDir('asc');
    }
  };

  const handleCopyCell = (val: unknown) => {
    const text = val === null || val === undefined ? 'NULL' : String(val);
    navigator.clipboard.writeText(text);
    setCopiedCell(`${selectedCell.row}-${selectedCell.col}`);
    success('Copied to clipboard', text);
    setTimeout(() => setCopiedCell(null), 1500);
  };

  // Start inline editing
  const startInlineEdit = (rowIdx: number, colName: string, currentVal: unknown) => {
    if (!isEditingEnabled || connection.is_readonly) {
      info('Editing Disabled', 'Click "Editing Disabled" on the bottom bar to enable editing mode.');
      return;
    }
    setEditingCell({ rowIdx, colName });
    setInlineEditValue(currentVal === null || currentVal === undefined ? '' : String(currentVal));
  };

  // Save inline cell update (Update)
  const commitInlineEdit = async () => {
    if (!editingCell) return;
    const { rowIdx, colName } = editingCell;
    const row = rows[rowIdx];
    if (!row) return;

    const idVal = row[primaryKeyCol] ?? row._id ?? rowIdx;
    const currentVal = row[colName];

    // If unchanged, simply close
    if (String(currentVal ?? '') === inlineEditValue) {
      setEditingCell(null);
      return;
    }

    try {
      const isEffectiveManual = connection.environment === 'production' || !autocommit;
      const res = await fetch(`/api/connections/${connectionId}/tables/${tableName}/rows`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database,
          schema: schemaName,
          identifierColumn: primaryKeyCol,
          identifierValue: idVal,
          updatedData: { [colName]: inlineEditValue },
          autocommit: !isEffectiveManual,
          sessionId: connectionId
        })
      });

      const data = await res.json();
      if (res.ok) {
        setRows(prev => {
          const updated = [...prev];
          updated[rowIdx] = { ...updated[rowIdx], [colName]: inlineEditValue };
          return updated;
        });
        if (data.inTransaction) {
          onTransactionChange?.(true);
          success('Cell Updated (Manual Commit)', `Edited "${colName}". Statement recorded in Transaction Log. Click Commit to persist.`);
        } else {
          success('Cell Updated', `Updated "${colName}" in ${tableName}`);
        }
        onRefreshHistory?.();
      } else {
        error('Update Error', data.error || 'Failed to update cell value.');
      }
    } catch {
      error('Network Error', 'Failed to update cell.');
    } finally {
      setEditingCell(null);
    }
  };

  // Open Insert Modal (Create)
  const handleOpenInsertModal = () => {
    if (connection.is_readonly) {
      error('Read Only', 'Cannot insert records into a read-only database.');
      return;
    }
    const initialValues: Record<string, string> = {};
    columns.forEach(col => {
      if (col.name === 'created_at') initialValues[col.name] = new Date().toISOString().replace('T', ' ').slice(0, 19);
      else if (col.name === 'created_by') initialValues[col.name] = 'Admin';
      else if (col.name === 'active_st') initialValues[col.name] = '1';
      else if (col.name === 'deleted_st') initialValues[col.name] = '0';
      else initialValues[col.name] = '';
    });
    setInsertFormData(initialValues);
    setShowInsertModal(true);
  };

  // Submit Insert New Row (Create)
  const handleInsertSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const isEffectiveManual = connection.environment === 'production' || !autocommit;
      const res = await fetch(`/api/connections/${connectionId}/tables/${tableName}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database,
          schema: schemaName,
          rowData: insertFormData,
          autocommit: !isEffectiveManual,
          sessionId: connectionId
        })
      });

      const data = await res.json();
      if (res.ok) {
        setRows(prev => [data.row, ...prev]);
        setTotalRows(t => t + 1);
        setShowInsertModal(false);
        setInsertFormData({});
        if (data.inTransaction) {
          onTransactionChange?.(true);
          success('Row Created (Manual Commit)', `New record inserted into "${tableName}". Statement recorded in Transaction Log. Click Commit to persist.`);
        } else {
          success('Row Created', `New record inserted into "${tableName}".`);
        }
        onRefreshHistory?.();
      } else {
        error('Insert Error', data.error || 'Failed to insert row.');
      }
    } catch {
      error('Network Error', 'Failed to insert row.');
    }
  };

  // Open Edit Row Modal (Full Update)
  const handleOpenEditRowModal = (rowIdx: number) => {
    if (connection.is_readonly) {
      error('Read Only', 'Cannot edit records in a read-only database.');
      return;
    }
    const row = rows[rowIdx];
    if (!row) return;

    setEditingRowIndex(rowIdx);
    const formVals: Record<string, string> = {};
    columns.forEach(col => {
      const val = row[col.name];
      formVals[col.name] = val === null || val === undefined ? '' : String(val);
    });
    setEditFormData(formVals);
    setShowEditModal(true);
  };

  // Submit Full Row Edit (Update)
  const handleEditRowSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRowIndex === null) return;
    const row = rows[editingRowIndex];
    if (!row) return;

    const idVal = row[primaryKeyCol] ?? row._id ?? editingRowIndex;

    try {
      const isEffectiveManual = connection.environment === 'production' || !autocommit;
      const res = await fetch(`/api/connections/${connectionId}/tables/${tableName}/rows`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database,
          schema: schemaName,
          identifierColumn: primaryKeyCol,
          identifierValue: idVal,
          updatedData: editFormData,
          autocommit: !isEffectiveManual,
          sessionId: connectionId
        })
      });

      const data = await res.json();
      if (res.ok) {
        setRows(prev => {
          const updated = [...prev];
          updated[editingRowIndex] = { ...updated[editingRowIndex], ...editFormData };
          return updated;
        });
        setShowEditModal(false);
        if (data.inTransaction) {
          onTransactionChange?.(true);
          success('Row Updated (Manual Commit)', `Updated record in "${tableName}". Statement recorded in Transaction Log. Click Commit to persist.`);
        } else {
          success('Row Updated', `Updated record in "${tableName}".`);
        }
        onRefreshHistory?.();
      } else {
        error('Update Error', data.error || 'Failed to update row.');
      }
    } catch {
      error('Network Error', 'Failed to update row.');
    }
  };

  // Delete Row Handler (Delete)
  const handleConfirmDelete = async () => {
    if (!rowToDelete) return;
    const { rowIdx } = rowToDelete;
    const row = rows[rowIdx];
    if (!row) return;

    const idVal = row[primaryKeyCol] ?? row._id ?? rowIdx;

    try {
      const isEffectiveManual = connection.environment === 'production' || !autocommit;
      const res = await fetch(`/api/connections/${connectionId}/tables/${tableName}/rows`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database,
          schema: schemaName,
          identifierColumn: primaryKeyCol,
          identifierValue: idVal,
          autocommit: !isEffectiveManual,
          sessionId: connectionId
        })
      });

      const data = await res.json();
      if (res.ok) {
        setRows(prev => prev.filter((_, idx) => idx !== rowIdx));
        setTotalRows(t => Math.max(0, t - 1));
        setRowToDelete(null);
        if (data.inTransaction) {
          onTransactionChange?.(true);
          success('Row Deleted (Manual Commit)', `Successfully deleted record from "${tableName}". Statement recorded in Transaction Log. Click Commit to persist.`);
        } else {
          success('Row Deleted', `Successfully deleted record from "${tableName}".`);
        }
        onRefreshHistory?.();
      } else {
        error('Delete Error', data.error || 'Failed to delete row.');
      }
    } catch {
      error('Network Error', 'Failed to delete row.');
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (editingCell) return;
    if (rows.length === 0 || columns.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedCell(prev => ({ ...prev, row: Math.min(rows.length - 1, prev.row + 1) }));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedCell(prev => ({ ...prev, row: Math.max(0, prev.row - 1) }));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSelectedCell(prev => ({ ...prev, col: Math.min(columns.length - 1, prev.col + 1) }));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSelectedCell(prev => ({ ...prev, col: Math.max(0, prev.col - 1) }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const col = columns[selectedCell.col];
      const row = rows[selectedCell.row];
      if (col && row) {
        startInlineEdit(selectedCell.row, col.name, row[col.name]);
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!editingCell && rows[selectedCell.row]) {
        setRowToDelete({
          rowIdx: selectedCell.row,
          label: `Row #${selectedCell.row + 1}`
        });
      }
    }
  };

  const handleExport = async (format: 'csv' | 'json' | 'sql') => {
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          tableName,
          columns,
          rows
        })
      });
      const content = await res.text();
      const mime = format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/plain';
      triggerDownload(content, `${tableName}.${format}`, mime);
      success('Export Completed', `Successfully exported ${rows.length} rows as ${format.toUpperCase()}.`);
    } catch {
      error('Export Error', 'Failed to generate exported data file.');
    } finally {
      setShowExportMenu(false);
    }
  };

  const currentCellVal = useMemo(() => {
    if (!rows[selectedCell.row] || !columns[selectedCell.col]) return null;
    return rows[selectedCell.row][columns[selectedCell.col].name];
  }, [rows, columns, selectedCell]);

  return (
    <div
      className="flex-1 h-full flex flex-col bg-zinc-950 overflow-hidden outline-none select-none relative"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* =========================================================================
          TOP QUICK FILTER BAR & CRUD ACTION BUTTONS
      ========================================================================== */}
      <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-3 shrink-0 gap-3">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {/* Quick Filter Icon */}
          <div className="p-1 rounded text-zinc-400 bg-zinc-800/80 border border-zinc-700/60">
            <Filter className="w-3.5 h-3.5 text-zinc-300" />
          </div>

          {/* Column selector */}
          <div className="w-44 shrink-0">
            <Select
              sizeVariant="sm"
              value={filterCol}
              onChange={e => setFilterCol(e.target.value)}
              className="font-mono"
            >
              {columns.map(c => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Operator selector */}
          <div className="w-36 shrink-0">
            <Select
              sizeVariant="sm"
              value={filterOp}
              onChange={e => setFilterOp(e.target.value)}
            >
              <option value="equals">equals</option>
              <option value="contains">contains</option>
              <option value="starts_with">starts with</option>
              <option value="gt">greater than (&gt;)</option>
              <option value="lt">less than (&lt;)</option>
            </Select>
          </div>

          {/* Value input */}
          <input
            type="text"
            placeholder="Enter Value"
            value={filterVal}
            onChange={e => setFilterVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleApplyFilter()}
            className="h-7 flex-1 min-w-0 w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-yellow-400 transition-all"
          />

          {/* Add Filter & Search button */}
          <button
            onClick={handleApplyFilter}
            className="h-7 px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded border border-zinc-700/60 flex items-center justify-center cursor-pointer transition-colors shrink-0"
            title="Apply Filter"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          {activeFilterActive && (
            <button
              onClick={() => {
                setFilterVal('');
                setActiveFilterActive(false);
              }}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 underline ml-1 cursor-pointer shrink-0"
            >
              Clear
            </button>
          )}
        </div>

        {/* Right Actions: CRUD New Row Button, Selected Row Actions, Export */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Insert Row Button (Create) */}
          <Button
            size="sm"
            variant="yellow"
            onClick={handleOpenInsertModal}
            className="flex items-center gap-1.5 h-7 text-xs px-2.5 font-semibold text-zinc-950"
            title="Insert new row into table"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>New Row</span>
          </Button>

          {/* Export Dropdown Menu */}
          <div className="relative">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1.5 text-xs h-7 bg-zinc-800 text-zinc-200 border-zinc-700"
            >
              <Download className="w-3 h-3 text-zinc-400" />
              <span>Export</span>
            </Button>

            {showExportMenu && (
              <div className="absolute right-0 top-8 z-40 w-44 rounded-md bg-zinc-900 border border-zinc-700 shadow-xl py-1 text-xs">
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                >
                  Export to CSV (.csv)
                </button>
                <button
                  onClick={() => handleExport('json')}
                  className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                >
                  Export to JSON (.json)
                </button>
                <button
                  onClick={() => handleExport('sql')}
                  className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                >
                  Export as SQL Inserts (.sql)
                </button>
              </div>
            )}
          </div>

          {/* Refresh Table */}
          <button
            onClick={handleManualRefresh}
            title="Refresh table data"
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <RefreshCw className={cn('w-3.5 h-3.5 transition-transform', (loading || isManualRefreshing) && 'animate-spin text-yellow-400')} />
          </button>
        </div>
      </div>

      {/* =========================================================================
          DATA GRID (Signature Beekeeper Yellow Outline + Inline Cell Editing)
      ========================================================================== */}
      <div 
        className="flex-1 min-h-0 min-w-0 overflow-auto bg-zinc-950 font-mono relative"
        style={{ fontSize: `${fontSize || 13}px` }}
      >
        <table className="min-w-full w-max border-collapse select-text">
          {/* Header Row */}
          <thead className="sticky top-0 z-20 bg-zinc-900 border-b border-zinc-800 shadow-sm">
            <tr className="h-8">
              {/* Row Number Header + Row Actions */}
              <th className="w-12 px-2 py-1.5 text-center text-zinc-500 font-normal border-r border-zinc-800 select-none bg-zinc-900/90">
                #
              </th>

              {/* Dynamic Table Column Headers */}
              {columns.map(col => {
                const isSorted = sortCol === col.name;
                const isPk = col.isPrimary || col.name === primaryKeyCol;

                return (
                  <th
                    key={col.name}
                    onClick={() => handleSort(col.name)}
                    className="min-w-[150px] px-3 py-2 text-left font-normal border-r border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/80 cursor-pointer transition-colors group select-none"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isPk && (
                          <span className="flex items-center gap-0.5 px-1 py-0.2 rounded bg-yellow-400/15 text-yellow-300 border border-yellow-400/30 text-[9px] font-bold" title="Primary Key">
                            <Key className="w-2.5 h-2.5 text-yellow-400 stroke-[2.5]" />
                            <span>PK</span>
                          </span>
                        )}
                        <span className="font-semibold truncate text-[11px] text-zinc-100 font-mono">{col.name}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-zinc-500 font-sans lowercase font-normal shrink-0">
                          {col.type.split(' ')[0]}
                        </span>
                        {isSorted ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="w-3 h-3 text-yellow-400" />
                          ) : (
                            <ArrowDown className="w-3 h-3 text-yellow-400" />
                          )
                        ) : (
                          <ArrowUpDown className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Table Body Rows */}
          <tbody>
            {rows.map((row, rowIdx) => {
              const isRowSelected = selectedCell.row === rowIdx;

              return (
                <tr
                  key={rowIdx}
                  onContextMenu={e => handleRowContextMenu(rowIdx, e)}
                  className={cn(
                    'border-b border-zinc-900 group transition-colors h-7',
                    isRowSelected ? 'bg-zinc-900/40' : 'hover:bg-zinc-900/30'
                  )}
                >
                  {/* Row Number Column + 3-dots / Context Menu Actions */}
                  <td
                    onContextMenu={e => handleRowContextMenu(rowIdx, e)}
                    className="w-12 h-7 p-0 text-center text-zinc-500 text-[10px] border-r border-zinc-800 select-none bg-zinc-950 relative group-hover:bg-zinc-900/80"
                  >
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="group-hover:hidden leading-none select-none">{rowIdx + 1}</span>
                      <button
                        onClick={e => handleRowThreeDotsClick(rowIdx, e)}
                        className="hidden group-hover:inline-flex items-center justify-center w-5 h-5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-yellow-400 transition-colors cursor-pointer"
                        title="Row Actions & SQL Generator (Right click)"
                      >
                        <MoreVertical className="w-3 h-3" />
                      </button>
                    </div>
                  </td>

                  {/* Cell Data Columns */}
                  {columns.map((col, colIdx) => {
                    const val = row[col.name];
                    const isSelected = selectedCell.row === rowIdx && selectedCell.col === colIdx;
                    const isCellEditing = editingCell?.rowIdx === rowIdx && editingCell?.colName === col.name;
                    const isNull = val === null || val === undefined;
                    const isEmpty = val === '';

                    return (
                      <td
                        key={col.name}
                        onClick={() => setSelectedCell({ row: rowIdx, col: colIdx })}
                        onDoubleClick={() => startInlineEdit(rowIdx, col.name, val)}
                        className={cn(
                          'px-3 py-1 h-7 border-r border-zinc-800 whitespace-nowrap overflow-hidden text-ellipsis cursor-cell transition-colors relative max-w-[400px]',
                          isSelected && 'bk-cell-selected'
                        )}
                      >
                        {isCellEditing ? (
                          <div className="flex items-center gap-1 -my-1 -mx-2">
                            <input
                              ref={inlineInputRef}
                              type="text"
                              value={inlineEditValue}
                              onChange={e => setInlineEditValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitInlineEdit();
                                if (e.key === 'Escape') setEditingCell(null);
                              }}
                              onBlur={commitInlineEdit}
                              className="w-full bg-zinc-900 text-yellow-300 font-mono text-[11px] px-2 py-0.5 focus:outline-none"
                            />
                            {/* <button
                              onMouseDown={commitInlineEdit}
                              className="p-0.5 bg-yellow-400 text-zinc-950 rounded cursor-pointer"
                              title="Save cell"
                            >
                              <Save className="w-3 h-3" />
                            </button> */}
                          </div>
                        ) : isNull ? (
                          <span className="text-zinc-600 italic select-none text-[11px]">(NULL)</span>
                        ) : isEmpty ? (
                          <span className="text-zinc-600 italic select-none text-[11px]">(EMPTY)</span>
                        ) : (
                          <span className="text-zinc-200 text-[11px] tabular-nums">
                            {String(val)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {rows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="p-8 text-center text-zinc-500 font-sans"
                >
                  <p className="mb-2">No records found in table "{tableName}".</p>
                  <Button
                    size="sm"
                    variant="yellow"
                    onClick={handleOpenInsertModal}
                    className="inline-flex items-center gap-1.5"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>Insert First Record</span>
                  </Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* =========================================================================
          BEEKEEPER CONNECTION FOOTER (Matches screenshot with responsive connection color)
      ========================================================================== */}
      <ConnectionFooter
        connection={connection}
        activeTableName={tableName}
        rowCount={totalRows}
        lastActiveTime={relativeTimeText}
        currentPage={page}
        totalPages={Math.max(1, Math.ceil(totalRows / limit))}
        isEditingEnabled={isEditingEnabled}
        onToggleEditing={() => {
          const next = !isEditingEnabled;
          setIsEditingEnabled(next);
          info(
            next ? 'Editing Enabled' : 'Editing Disabled',
            next ? 'Double-click any table cell to edit values inline.' : 'Table is now protected in read-only mode.'
          );
        }}
        onPageChange={(newPage) => setPage(newPage)}
        onRefresh={() => fetchData(activeFilterActive)}
        onNewRow={handleOpenInsertModal}
        onOpenStructure={() => setShowStructureModal(true)}
        onDisconnect={onDisconnect}
      />

      {/* =========================================================================
          MODAL 1: INSERT NEW ROW (Create)
      ========================================================================== */}
      {showInsertModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 w-full max-w-lg shadow-2xl space-y-4 max-h-[85vh] flex flex-col animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-yellow-400" />
                <h3 className="text-sm font-semibold text-zinc-100">Insert Row into {tableName}</h3>
              </div>
              <button
                onClick={() => setShowInsertModal(false)}
                className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleInsertSubmit} className="flex-1 overflow-y-auto space-y-3 pr-1">
              {columns.map(col => (
                <div key={col.name} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-300 font-mono">
                      {col.name}
                    </label>
                    <span className="text-[10px] text-zinc-500 font-sans">{col.type}</span>
                  </div>
                  <Input
                    value={insertFormData[col.name] ?? ''}
                    onChange={e => setInsertFormData({ ...insertFormData, [col.name]: e.target.value })}
                    placeholder={`Value for ${col.name}`}
                  />
                </div>
              ))}

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowInsertModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="yellow"
                  className="font-semibold text-zinc-950"
                >
                  Insert Record
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: EDIT FULL ROW (Update)
      ========================================================================== */}
      {showEditModal && editingRowIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 w-full max-w-lg shadow-2xl space-y-4 max-h-[85vh] flex flex-col animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-yellow-400" />
                <h3 className="text-sm font-semibold text-zinc-100">Edit Row #{editingRowIndex + 1} ({tableName})</h3>
              </div>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditRowSubmit} className="flex-1 overflow-y-auto space-y-3 pr-1">
              {columns.map(col => (
                <div key={col.name} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-300 font-mono">
                      {col.name}
                    </label>
                    <span className="text-[10px] text-zinc-500 font-sans">{col.type}</span>
                  </div>
                  <Input
                    value={editFormData[col.name] ?? ''}
                    onChange={e => setEditFormData({ ...editFormData, [col.name]: e.target.value })}
                    placeholder={`Value for ${col.name}`}
                  />
                </div>
              ))}

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowEditModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="yellow"
                  className="font-semibold text-zinc-950"
                >
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 3: DELETE CONFIRMATION (Delete)
      ========================================================================== */}
      {rowToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-red-500/40 rounded-lg p-5 w-full max-w-sm shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center gap-2.5 text-red-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-semibold text-zinc-100">Delete Record</h3>
            </div>
            <p className="text-xs text-zinc-300">
              Are you sure you want to delete <span className="font-bold text-zinc-100">{rowToDelete.label}</span> from table <span className="font-mono text-yellow-300">{tableName}</span>?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => setRowToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
              >
                Delete Record
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 4: TABLE STRUCTURE & COLUMN DEFINITIONS
      ========================================================================== */}
      {showStructureModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-lg p-5 w-full max-w-3xl shadow-2xl space-y-4 max-h-[85vh] flex flex-col animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Columns className="w-4 h-4 text-yellow-400" />
                <h3 className="text-sm font-semibold text-zinc-100">
                  Table Structure: <span className="font-mono text-yellow-300">{schemaName}.{tableName}</span>
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 text-xs font-mono">
                  {columns.length} columns
                </span>
              </div>
              <button
                onClick={() => setShowStructureModal(false)}
                className="text-zinc-400 hover:text-zinc-200 cursor-pointer p-1 rounded hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Actions & Column Search Bar */}
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500 pointer-events-none" />
                <Input
                  value={structureSearch}
                  onChange={e => setStructureSearch(e.target.value)}
                  placeholder="Filter columns by name or datatype..."
                  className="pl-8 h-8 text-xs bg-zinc-950 border-zinc-800 focus:border-yellow-400"
                />
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(columns.map(c => c.name).join(', '));
                  success('Copied', 'Column names copied as comma-separated list');
                }}
                className="h-8 text-xs flex items-center gap-1.5 shrink-0"
              >
                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                <span>Copy Column List</span>
              </Button>
            </div>

            {/* Columns Table Grid */}
            <div className="flex-1 overflow-auto border border-zinc-800 rounded-md bg-zinc-950">
              <table className="w-full text-xs font-mono">
                <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 sticky top-0 z-10 select-none">
                  <tr>
                    <th className="w-10 px-3 py-2 text-center font-normal">#</th>
                    <th className="px-3 py-2 text-left font-normal">Column Name</th>
                    <th className="px-3 py-2 text-left font-normal">Data Type</th>
                    <th className="px-3 py-2 text-left font-normal">Constraints</th>
                    <th className="px-3 py-2 text-left font-normal">Nullable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-zinc-200">
                  {columns
                    .filter(c =>
                      !structureSearch ||
                      c.name.toLowerCase().includes(structureSearch.toLowerCase()) ||
                      c.type.toLowerCase().includes(structureSearch.toLowerCase())
                    )
                    .map((col, idx) => (
                      <tr key={col.name} className="hover:bg-zinc-900/60 transition-colors">
                        <td className="px-3 py-2 text-center text-zinc-500 text-[11px] select-none">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          <div className="flex items-center gap-1.5">
                            {col.isPrimary && (
                              <Key className="w-3 h-3 text-yellow-400 shrink-0 stroke-[2.5]" />
                            )}
                            <span className={cn(col.isPrimary ? 'text-yellow-300' : 'text-zinc-100')}>
                              {col.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono text-zinc-400 bg-zinc-800/60 border border-zinc-700/50">
                            {col.type}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {col.isPrimary ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-400/15 text-yellow-300 border border-yellow-400/30 text-[10px] font-bold">
                              PRIMARY KEY
                            </span>
                          ) : (
                            <span className="text-zinc-600">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {col.nullable ? (
                            <span className="text-zinc-400 text-[11px]">NULL</span>
                          ) : (
                            <span className="text-amber-400/90 font-medium text-[11px]">NOT NULL</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2 border-t border-zinc-800">
              <Button
                variant="secondary"
                onClick={() => setShowStructureModal(false)}
                className="text-xs"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Row Context Menu / 3-dots Dropdown */}
      {rowMenu && rows[rowMenu.rowIdx] && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setRowMenu(null)}
            onContextMenu={e => {
              e.preventDefault();
              setRowMenu(null);
            }}
          />
          <div
            style={{ left: `${rowMenu.x}px`, top: `${rowMenu.y}px` }}
            className="fixed z-50 w-64 bg-zinc-900 border border-zinc-700/80 rounded-lg shadow-2xl py-1 text-xs text-zinc-200 font-sans animate-in fade-in-50 zoom-in-95"
          >
            {/* Header */}
            <div className="px-3 py-1.5 border-b border-zinc-800 text-[10px] font-mono text-zinc-400 flex items-center justify-between bg-zinc-950/70 rounded-t-lg">
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-zinc-500 font-medium">Row #{rowMenu.rowIdx + 1}</span>
                {rows[rowMenu.rowIdx][primaryKeyCol] !== undefined && (
                  <span className="text-yellow-400 font-semibold truncate">
                    ({primaryKeyCol}: {String(rows[rowMenu.rowIdx][primaryKeyCol])})
                  </span>
                )}
              </div>
              <span className="text-zinc-500 text-[9px] font-mono shrink-0">{tableName}</span>
            </div>

            {/* Actions: Edit, Delete, Clone */}
            <div className="py-1">
              <button
                onClick={() => {
                  handleOpenEditRowModal(rowMenu.rowIdx);
                  setRowMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 hover:text-yellow-400 transition-colors cursor-pointer text-left"
              >
                <Edit3 className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                <span>Edit Row</span>
              </button>

              <button
                onClick={() => {
                  handleCloneRow(rowMenu.rowIdx);
                  setRowMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
              >
                <PlusCircle className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Duplicate Row (Insert Clone)</span>
              </button>

              <button
                onClick={() => {
                  const r = rows[rowMenu.rowIdx];
                  setRowToDelete({
                    rowIdx: rowMenu.rowIdx,
                    label: `Row #${rowMenu.rowIdx + 1} (${primaryKeyCol}: ${r?.[primaryKeyCol] ?? ''})`
                  });
                  setRowMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-200 hover:bg-red-950/50 hover:text-red-300 transition-colors cursor-pointer text-left"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span>Delete Row</span>
              </button>
            </div>

            <div className="border-t border-zinc-800/80 my-1" />

            {/* SQL Generators */}
            <div className="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider font-mono">
              Generate SQL
            </div>

            <button
              onClick={() => {
                const sql = generateInsertSql(rows[rowMenu.rowIdx]);
                navigator.clipboard.writeText(sql);
                success('Copied INSERT SQL', `INSERT statement for Row #${rowMenu.rowIdx + 1} copied to clipboard.`);
                setRowMenu(null);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2 truncate">
                <FileCode className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Generate INSERT SQL</span>
              </div>
              <Copy className="w-3 h-3 text-zinc-500 shrink-0" />
            </button>

            <button
              onClick={() => {
                const sql = generateUpdateSql(rows[rowMenu.rowIdx]);
                navigator.clipboard.writeText(sql);
                success('Copied UPDATE SQL', `UPDATE statement for Row #${rowMenu.rowIdx + 1} copied to clipboard.`);
                setRowMenu(null);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2 truncate">
                <FileCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Generate UPDATE SQL</span>
              </div>
              <Copy className="w-3 h-3 text-zinc-500 shrink-0" />
            </button>

            <button
              onClick={() => {
                const sql = generateDeleteSql(rows[rowMenu.rowIdx]);
                navigator.clipboard.writeText(sql);
                success('Copied DELETE SQL', `DELETE statement for Row #${rowMenu.rowIdx + 1} copied to clipboard.`);
                setRowMenu(null);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2 truncate">
                <FileCode className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>Generate DELETE SQL</span>
              </div>
              <Copy className="w-3 h-3 text-zinc-500 shrink-0" />
            </button>

            <button
              onClick={async () => {
                await handleCopyDdl();
                setRowMenu(null);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2 truncate">
                <FileCode className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span>Generate CREATE (DDL)</span>
              </div>
              <Copy className="w-3 h-3 text-zinc-500 shrink-0" />
            </button>

            {onOpenQueryTab && (
              <button
                onClick={() => {
                  const sql = generateInsertSql(rows[rowMenu.rowIdx]);
                  onOpenQueryTab(sql);
                  setRowMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-yellow-300 hover:bg-zinc-800 transition-colors cursor-pointer text-left font-medium"
              >
                <Terminal className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                <span>Open in SQL Editor</span>
              </button>
            )}

            <div className="border-t border-zinc-800/80 my-1" />

            {/* Copy Row Data */}
            <div className="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider font-mono">
              Copy Row Data
            </div>

            <button
              onClick={() => {
                const r = rows[rowMenu.rowIdx];
                navigator.clipboard.writeText(JSON.stringify(r, null, 2));
                success('Copied JSON', `Row #${rowMenu.rowIdx + 1} copied as JSON.`);
                setRowMenu(null);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2">
                <Copy className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>Copy as JSON</span>
              </div>
            </button>

            <button
              onClick={() => {
                const r = rows[rowMenu.rowIdx];
                const csvRow = columns.map(c => `"${String(r[c.name] ?? '').replace(/"/g, '""')}"`).join(',');
                navigator.clipboard.writeText(csvRow);
                success('Copied CSV', `Row #${rowMenu.rowIdx + 1} copied as CSV.`);
                setRowMenu(null);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-2">
                <Copy className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>Copy as CSV</span>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
