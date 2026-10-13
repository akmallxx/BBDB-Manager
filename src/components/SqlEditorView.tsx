import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Play, Sparkles, Trash2, Download, AlertCircle, CheckCircle2, Terminal, ChevronDown, ChevronUp, Minus, Maximize2 } from 'lucide-react';
import { Button } from './ui/button';
import { QueryExecutionResult, SchemaGroup, DatabaseConnection, TableSummary } from '../types/database';
import { cn, triggerDownload, formatRelativeTime } from '../lib/utils';
import { useToast } from './ui/toast';
import { ConnectionFooter } from './ConnectionFooter';

interface SqlEditorViewProps {
  initialQuery?: string;
  connection?: DatabaseConnection;
  connectionId: string;
  database: string;
  schemas: SchemaGroup[];
  autocommit: boolean;
  inTransaction: boolean;
  onCommit: () => void;
  onRollback: () => void;
  onQueryChange?: (newQuery: string) => void;
  onRefreshHistory: () => void;
  onTransactionChange?: (inTx: boolean) => void;
  onDisconnect?: () => void;
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'ORDER BY',
  'ASC', 'DESC', 'LIMIT', 'OFFSET', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  'DISTINCT', 'HAVING', 'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL',
  'LIKE', 'ILIKE', 'IN', 'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'BEGIN', 'COMMIT', 'ROLLBACK'
];

const SQL_KW_SET = new Set([
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL', 'ON', 'GROUP', 'BY',
  'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'HAVING', 'UNION', 'ALL', 'DISTINCT',
  'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'ILIKE', 'BETWEEN', 'EXISTS',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'TRUNCATE',
  'VIEW', 'INDEX', 'BEGIN', 'COMMIT', 'ROLLBACK', 'RETURNING', 'PRIMARY', 'KEY',
  'CONSTRAINT', 'DEFAULT', 'WITH', 'CASCADE'
]);

const SQL_FN_SET = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NOW', 'CONCAT', 'LOWER', 'UPPER',
  'DATE_TRUNC', 'ROUND', 'CAST', 'SUBSTRING', 'TRIM', 'LENGTH', 'JSON_BUILD_OBJECT',
  'JSON_AGG', 'GREATEST', 'LEAST', 'EXTRACT'
]);

// SQL Syntax Highlighter token parser
function highlightSql(text: string): React.ReactNode {
  if (!text) return null;
  const tokenRegex = /(\/\*[\s\S]*?\*\/|--[^\n]*|'(?:''|[^'])*'|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_][a-zA-Z0-9_]*\b|[<>=!+\-*/%:]+|\n|[ \t]+|[^\s\w]+)/g;

  const elements: React.ReactNode[] = [];
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    const token = match[0];
    keyIdx++;

    if (token.startsWith('--') || token.startsWith('/*')) {
      elements.push(<span key={keyIdx} className="text-zinc-500 italic">{token}</span>);
    } else if (token.startsWith("'")) {
      elements.push(<span key={keyIdx} className="text-emerald-400 font-mono">{token}</span>);
    } else if (/^\d+(\.\d+)?$/.test(token)) {
      elements.push(<span key={keyIdx} className="text-amber-400 font-mono">{token}</span>);
    } else {
      const upper = token.toUpperCase();
      if (SQL_KW_SET.has(upper)) {
        elements.push(<span key={keyIdx} className="text-cyan-400 font-semibold">{token}</span>);
      } else if (SQL_FN_SET.has(upper)) {
        elements.push(<span key={keyIdx} className="text-amber-300 font-medium">{token}</span>);
      } else if (/^[<>=!+\-*/%:]+$/.test(token)) {
        elements.push(<span key={keyIdx} className="text-zinc-400">{token}</span>);
      } else {
        elements.push(<span key={keyIdx} className="text-zinc-200">{token}</span>);
      }
    }
  }

  return elements;
}

// SQL Beautifier / Formatter
function beautifySql(sql: string): string {
  if (!sql.trim()) return '';

  const preservedTokens: string[] = [];
  let cleanSql = sql.replace(/('(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\/)/g, (match) => {
    preservedTokens.push(match);
    return `___SQL_TOKEN_${preservedTokens.length - 1}___`;
  });

  const majorKeywords = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN',
    'INNER JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON', 'GROUP BY', 'ORDER BY',
    'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'INSERT INTO', 'VALUES',
    'UPDATE', 'SET', 'DELETE FROM', 'RETURNING', 'BEGIN', 'COMMIT', 'ROLLBACK'
  ];

  const topClauses = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
    'UNION', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM'
  ];

  cleanSql = cleanSql.replace(/\s+/g, ' ').trim();

  for (const kw of majorKeywords) {
    const rx = new RegExp(`\\b${kw}\\b`, 'gi');
    cleanSql = cleanSql.replace(rx, kw);
  }

  for (const clause of topClauses) {
    const rx = new RegExp(`\\s*\\b(${clause})\\b\\s*`, 'g');
    cleanSql = cleanSql.replace(rx, `\n$1 `);
  }

  cleanSql = cleanSql.replace(/\s*\b(LEFT JOIN|RIGHT JOIN|INNER JOIN|FULL JOIN|CROSS JOIN|JOIN)\b\s*/g, '\n  $1 ');
  cleanSql = cleanSql.replace(/\s*\b(AND|OR)\b\s*/g, '\n  $1 ');

  cleanSql = cleanSql.replace(/___SQL_TOKEN_(\d+)___/g, (_, idx) => {
    return preservedTokens[Number(idx)];
  });

  return cleanSql.trim();
}

export function SqlEditorView({
  initialQuery = 'SELECT * FROM mst_pasien LIMIT 50;',
  connection,
  connectionId,
  database,
  schemas,
  autocommit,
  inTransaction,
  onCommit,
  onRollback,
  onQueryChange,
  onRefreshHistory,
  onTransactionChange,
  onDisconnect
}: SqlEditorViewProps) {
  const { success, error, info } = useToast();

  const [query, setQuery] = useState(initialQuery);
  const [selectedText, setSelectedText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<QueryExecutionResult | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number }>({ row: 0, col: 0 });

  // Inline cell editing state (Double-click edit)
  const [lastExecutedQuery, setLastExecutedQuery] = useState(initialQuery || '');
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; colName: string } | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState<string>('');
  const inlineInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingCell && inlineInputRef.current) {
      inlineInputRef.current.focus();
      inlineInputRef.current.select();
    }
  }, [editingCell]);

  // Minimizable query results & Resizable editor height
  const [isResultsMinimized, setIsResultsMinimized] = useState(false);
  const [editorHeight, setEditorHeight] = useState(200);
  const [isResizing, setIsResizing] = useState(false);

  // Pagination & execution timestamp state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;
  const totalRows = result?.rows?.length ?? (result?.rowCount ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  const [lastExecutedAt, setLastExecutedAt] = useState<Date | null>(null);
  const [relativeTimeText, setRelativeTimeText] = useState('Ready');

  useEffect(() => {
    if (!lastExecutedAt) {
      setRelativeTimeText('Ready');
      return;
    }
    const updateRelative = () => {
      setRelativeTimeText(formatRelativeTime(lastExecutedAt.toISOString()));
    };
    updateRelative();
    const timer = setInterval(updateRelative, 10000);
    return () => clearInterval(timer);
  }, [lastExecutedAt]);

  const paginatedRows = useMemo(() => {
    if (!result?.rows) return [];
    const start = (currentPage - 1) * pageSize;
    return result.rows.slice(start, start + pageSize);
  }, [result?.rows, currentPage, pageSize]);

  // Resolve base table and primary key identifier for inline cell editing
  const resolveTableAndIdentifier = (row: Record<string, unknown>) => {
    const queryToParse = lastExecutedQuery || query;
    let tableName = '';
    let schemaName = 'public';

    // 1. Remove SQL comments
    const cleanSql = queryToParse.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');

    // 2. Match FROM [schema.]table
    const fromMatch = cleanSql.match(/\bFROM\s+(?:["`\[]?([a-zA-Z0-9_]+)["`\]]?(?:\.["`\[]?([a-zA-Z0-9_]+)["`\]]?)?)/i);
    if (fromMatch) {
      if (fromMatch[2]) {
        schemaName = fromMatch[1];
        tableName = fromMatch[2];
      } else {
        tableName = fromMatch[1];
      }
    }

    // 3. Match against schemas metadata to ensure exact casing and primary key
    let matchedTable: TableSummary | undefined;
    for (const s of schemas) {
      for (const t of s.tables) {
        if (t.name.toLowerCase() === tableName.toLowerCase()) {
          if (!fromMatch?.[2] || s.name.toLowerCase() === schemaName.toLowerCase()) {
            matchedTable = t;
            tableName = t.name;
            schemaName = s.name;
            break;
          }
        }
      }
      if (matchedTable) break;
    }

    // If table not found in FROM, check schema tables that have all/most matching column names
    if (!matchedTable && result?.columns && result.columns.length > 0) {
      const colNames = result.columns.map(c => c.name.toLowerCase());
      let bestTable: TableSummary | null = null;
      let bestScore = 0;
      for (const s of schemas) {
        for (const t of s.tables) {
          const tColNames = t.columns.map(c => c.name.toLowerCase());
          const matchCount = colNames.filter(c => tColNames.includes(c)).length;
          if (matchCount > bestScore && matchCount >= 2) {
            bestScore = matchCount;
            bestTable = t;
            schemaName = s.name;
          }
        }
      }
      if (bestTable && bestScore >= Math.min(2, colNames.length)) {
        matchedTable = bestTable;
        tableName = bestTable.name;
      }
    }

    // 4. Resolve identifier column
    let identifierCol = '';
    if (matchedTable) {
      const pk = matchedTable.columns.find(c => c.isPrimary);
      if (pk && row[pk.name] !== undefined) {
        identifierCol = pk.name;
      }
    }

    if (!identifierCol) {
      // Check common identifier candidates
      const rowKeys = Object.keys(row);
      const candidates = [
        'id',
        '_id',
        `${tableName.toLowerCase()}_id`,
        `id_${tableName.toLowerCase()}`,
        'uuid'
      ];
      for (const cand of candidates) {
        const found = rowKeys.find(k => k.toLowerCase() === cand);
        if (found && row[found] !== undefined && row[found] !== null) {
          identifierCol = found;
          break;
        }
      }
    }

    // Fallback to first column if it contains "id"
    if (!identifierCol && result?.columns && result.columns.length > 0) {
      const firstCol = result.columns[0].name;
      if (firstCol.toLowerCase().includes('id') && row[firstCol] !== undefined) {
        identifierCol = firstCol;
      }
    }

    return { tableName, schemaName, identifierCol };
  };

  // Start inline editing of a cell
  const startInlineEdit = (rowIdx: number, colName: string, currentVal: unknown) => {
    if (connection?.is_readonly) {
      error('Read-Only Connection', 'Cannot edit data in a read-only database.');
      return;
    }
    setEditingCell({ rowIdx, colName });
    setInlineEditValue(currentVal === null || currentVal === undefined ? '' : String(currentVal));
  };

  // Commit and persist inline cell change to database & transaction log
  const commitInlineEdit = async () => {
    if (!editingCell || !result?.rows) return;
    const { rowIdx, colName } = editingCell;
    const row = result.rows[rowIdx];
    if (!row) {
      setEditingCell(null);
      return;
    }

    const currentVal = row[colName];
    // If value did not change, just close
    if (String(currentVal ?? '') === inlineEditValue) {
      setEditingCell(null);
      return;
    }

    const { tableName, schemaName, identifierCol } = resolveTableAndIdentifier(row);

    if (!tableName) {
      error(
        'Cannot Persist Edit',
        'Unable to detect the source table from the SQL query. Please query with FROM <table_name>.'
      );
      setEditingCell(null);
      return;
    }

    if (!identifierCol || row[identifierCol] === undefined) {
      error(
        'Missing Primary Key',
        `Cannot update "${tableName}" because no primary key or identifier column (e.g. id) was found in query results.`
      );
      setEditingCell(null);
      return;
    }

    const idVal = row[identifierCol];

    try {
      const isEffectiveManual = connection?.environment === 'production' || !autocommit;
      const res = await fetch(`/api/connections/${connectionId}/tables/${tableName}/rows`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database,
          schema: schemaName || 'public',
          identifierColumn: identifierCol,
          identifierValue: idVal,
          updatedData: { [colName]: inlineEditValue },
          autocommit: !isEffectiveManual,
          sessionId: connectionId
        })
      });

      const data = await res.json();
      if (res.ok) {
        setResult(prev => {
          if (!prev || !prev.rows) return prev;
          const updatedRows = [...prev.rows];
          updatedRows[rowIdx] = { ...updatedRows[rowIdx], [colName]: inlineEditValue };
          return {
            ...prev,
            rows: updatedRows
          };
        });

        if (data.inTransaction) {
          onTransactionChange?.(true);
          success(
            'Cell Updated (Manual Commit)',
            `Edited "${colName}". Statement recorded in Transaction Log. Click Commit to persist.`
          );
        } else {
          success('Cell Updated', `Updated "${colName}" in ${tableName}`);
        }
        onRefreshHistory?.();
      } else {
        error('Update Error', data.error || 'Failed to update cell value.');
      }
    } catch {
      error('Network Error', 'Failed to update cell value.');
    } finally {
      setEditingCell(null);
    }
  };

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Resizing mouse drag listener
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newHeight = Math.max(120, Math.min(e.clientY - 120, window.innerHeight - 200));
      setEditorHeight(newHeight);
    };
    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Synchronized scrolling
  const handleScroll = () => {
    if (!textareaRef.current) return;
    const { scrollTop, scrollLeft } = textareaRef.current;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = scrollTop;
      highlightRef.current.scrollLeft = scrollLeft;
    }
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = scrollTop;
    }
  };

  // Selection change detection
  const handleSelectionChange = () => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    if (start !== end) {
      const sel = query.substring(start, end).trim();
      setSelectedText(sel);
    } else {
      setSelectedText('');
    }
  };

  // Available database entities for autocomplete
  const tableNames = useMemo(() => {
    return schemas.flatMap(s => s.tables.map(t => t.name));
  }, [schemas]);

  const columnNames = useMemo(() => {
    return Array.from(new Set(schemas.flatMap(s => s.tables.flatMap(t => t.columns.map(c => c.name)))));
  }, [schemas]);

  const allCompletions = useMemo(() => {
    return [...SQL_KEYWORDS, ...tableNames, ...columnNames];
  }, [tableNames, columnNames]);

  // Sync initial query
  useEffect(() => {
    if (initialQuery && initialQuery !== query) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  // Execute query handler (supports selection)
  const handleExecute = async (forceAll: boolean = false) => {
    const queryToRun = (!forceAll && selectedText) ? selectedText : query.trim();
    if (!queryToRun) {
      error('Empty Query', 'Please write or select a SQL statement before running.');
      return;
    }

    setEditingCell(null);
    setLastExecutedQuery(queryToRun);
    setIsRunning(true);
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          database,
          query: queryToRun,
          autocommit,
          sessionId: connectionId
        })
      });

      const data = await res.json();
      setResult(data);
      setCurrentPage(1);

      if (typeof data.inTransaction === 'boolean') {
        onTransactionChange?.(data.inTransaction);
      }

      if (res.ok && data.success) {
        setLastExecutedAt(new Date());
        const label = (!forceAll && selectedText) ? 'Selection Executed' : 'Query Executed';
        success(label, `${data.message} (${data.duration_ms}ms)`);
      } else {
        error('Query Error', data.message || 'Error occurred while executing query statement.');
      }
      onRefreshHistory();
    } catch {
      error('Network Error', 'Failed to reach database execution engine.');
    } finally {
      setIsRunning(false);
    }
  };

  // Keyboard shortcut Ctrl+Enter or Cmd+Enter
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleExecute();
      return;
    }

    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestionIndex(idx => (idx + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestionIndex(idx => (idx - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applySuggestion(suggestions[suggestionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
        return;
      }
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setQuery(val);
    setCursorPos(pos);
    onQueryChange?.(val);

    // Find current word
    const leftText = val.slice(0, pos);
    const match = leftText.match(/([a-zA-Z0-9_]+)$/);

    if (match) {
      const prefix = match[1].toUpperCase();
      const filtered = allCompletions
        .filter(item => item.toUpperCase().startsWith(prefix) && item.toUpperCase() !== prefix)
        .slice(0, 8);

      if (filtered.length > 0) {
        setSuggestions(filtered);
        setSuggestionIndex(0);
        setShowSuggestions(true);
        return;
      }
    }
    setShowSuggestions(false);
  };

  const applySuggestion = (suggestion: string) => {
    if (!textareaRef.current) return;
    const pos = cursorPos;
    const leftText = query.slice(0, pos);
    const rightText = query.slice(pos);
    const match = leftText.match(/([a-zA-Z0-9_]+)$/);

    if (match) {
      const startPos = pos - match[1].length;
      const newQuery = query.slice(0, startPos) + suggestion + ' ' + rightText;
      setQuery(newQuery);
      onQueryChange?.(newQuery);
      setShowSuggestions(false);

      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = startPos + suggestion.length + 1;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newPos, newPos);
        }
      }, 10);
    }
  };

  const handleFormatSql = () => {
    const formatted = beautifySql(query);
    setQuery(formatted);
    onQueryChange?.(formatted);
    success('Formatted SQL', 'Beautified SQL keywords, clauses, and indentation.');
  };

  const handleClear = () => {
    setQuery('');
    setSelectedText('');
    onQueryChange?.('');
    setResult(null);
    setEditingCell(null);
  };

  const handleExport = (format: 'csv' | 'json' | 'sql') => {
    if (!result || !result.rows || result.rows.length === 0) return;
    const tableName = 'query_result';

    if (format === 'json') {
      triggerDownload(JSON.stringify(result.rows, null, 2), `${tableName}.json`, 'application/json');
    } else if (format === 'csv') {
      const colNames = result.columns.map(c => c.name);
      const headerLine = colNames.map(n => `"${n.replace(/"/g, '""')}"`).join(',');
      const dataLines = result.rows.map(r => {
        return colNames.map(n => {
          const val = r[n];
          if (val === null || val === undefined) return '';
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(',');
      });
      triggerDownload([headerLine, ...dataLines].join('\n'), `${tableName}.csv`, 'text/csv');
    } else if (format === 'sql') {
      const colNames = result.columns.map(c => c.name);
      const colsSql = colNames.join(', ');
      const sqlLines = result.rows.map(r => {
        const values = colNames.map(n => {
          const val = r[n];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return String(val);
          return `'${String(val).replace(/'/g, "''")}'`;
        }).join(', ');
        return `INSERT INTO ${tableName} (${colsSql}) VALUES (${values});`;
      });
      triggerDownload(sqlLines.join('\n'), `${tableName}.sql`, 'text/plain');
    }
    success('Exported Results', `Saved ${result.rows.length} rows as ${format.toUpperCase()}.`);
  };

  // Line numbers calculation
  const lineCount = Math.max(query.split('\n').length, 8);

  return (
    <div className="flex-1 h-full flex flex-col bg-zinc-950 overflow-hidden select-none">
      {/* =========================================================================
          SQL EDITOR TOOLBAR
      ========================================================================== */}
      <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          {/* Run Query Button (supports selection) */}
          <Button
            size="sm"
            variant="yellow"
            onClick={() => handleExecute(false)}
            disabled={isRunning}
            className={cn(
              "flex items-center gap-1.5 h-7 px-3 text-xs font-semibold shadow-sm transition-all",
              selectedText && "bg-yellow-400 text-zinc-950 ring-2 ring-yellow-400/40"
            )}
            title={selectedText ? `Run selected query (${selectedText.length} chars) - Ctrl+Enter` : "Run query - Ctrl+Enter"}
          >
            <Play className={cn('w-3 h-3 fill-current', isRunning && 'animate-spin')} />
            <span>{isRunning ? 'Running...' : selectedText ? 'Run Selection (Ctrl+Enter)' : 'Run (Ctrl+Enter)'}</span>
          </Button>

          {selectedText && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleExecute(true)}
              disabled={isRunning}
              className="h-7 text-xs bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-zinc-100"
              title="Run entire query regardless of selection"
            >
              Run All
            </Button>
          )}

          {/* Format SQL */}
          <Button
            size="sm"
            variant="secondary"
            onClick={handleFormatSql}
            className="h-7 text-xs bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-zinc-100"
            title="Beautify and indent SQL query"
          >
            <Sparkles className="w-3 h-3 mr-1 text-zinc-400" />
            Format
          </Button>

          {/* Clear */}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleClear}
            className="h-7 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Clear
          </Button>
        </div>

        {/* Right Status & Export */}
        <div className="flex items-center gap-2">
          {/* Manual Commit Banner / Status */}
          {(!autocommit || inTransaction) && (
            <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-0.5 text-[11px] text-amber-300 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Manual Commit Active</span>
            </div>
          )}

          {result && result.rows && result.rows.length > 0 && (
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant="secondary"
                onClick={() => handleExport('csv')}
                className="h-6 text-[10px] px-2 text-zinc-300 border-zinc-700"
                title="Export as CSV"
              >
                <Download className="w-2.5 h-2.5 mr-1" />
                CSV
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => handleExport('json')}
                className="h-6 text-[10px] px-2 text-zinc-300 border-zinc-700"
                title="Export as JSON"
              >
                JSON
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => handleExport('sql')}
                className="h-6 text-[10px] px-2 text-zinc-300 border-zinc-700"
                title="Export as SQL Inserts"
              >
                SQL
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* =========================================================================
          SQL CODE EDITOR (Line numbers + Syntax Highlighting + Textarea + Autocomplete)
      ========================================================================== */}
      <div
        style={{ height: isResultsMinimized ? undefined : `${editorHeight}px` }}
        className={cn(
          "relative flex border-b border-zinc-800 bg-zinc-950 font-mono text-xs overflow-hidden transition-[height] duration-150",
          isResultsMinimized ? "flex-1 min-h-0" : "min-h-[120px] shrink-0"
        )}
      >
        {/* Line Numbers Column */}
        <div
          ref={lineNumbersRef}
          className="w-10 bg-zinc-900/60 border-r border-zinc-800/80 text-zinc-600 select-none py-2 text-right pr-2 text-[11px] leading-5 shrink-0 overflow-hidden"
        >
          {Array.from({ length: lineCount }).map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Textarea Area with Syntax Highlighting Layer */}
        <div className="flex-1 relative h-full overflow-hidden">
          {/* Syntax Highlighted Layer Behind */}
          <pre
            ref={highlightRef}
            aria-hidden="true"
            className="w-full h-full p-2 bg-transparent font-mono text-xs leading-5 whitespace-pre-wrap break-all pointer-events-none select-none overflow-hidden absolute inset-0 z-0"
          >
            <code>{highlightSql(query)}{query.endsWith('\n') ? ' ' : ''}</code>
          </pre>

          {/* Real Editable Textarea on Top */}
          <textarea
            ref={textareaRef}
            value={query}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            onSelect={handleSelectionChange}
            onKeyUp={handleSelectionChange}
            onMouseUp={handleSelectionChange}
            placeholder="-- Write your SQL query here (e.g. SELECT * FROM mst_pasien LIMIT 50;)"
            spellCheck={false}
            className="w-full h-full p-2 bg-transparent text-transparent caret-yellow-400 placeholder:text-zinc-600 focus:outline-none resize-none leading-5 font-mono text-xs select-text overflow-auto absolute inset-0 z-10 selection:bg-yellow-400/30 selection:text-white"
          />

          {/* SQL Autocomplete Popup Menu */}
          {showSuggestions && (
            <div className="absolute left-10 top-12 z-50 w-56 rounded-md bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden py-1">
              <div className="px-2 py-0.5 text-[10px] text-zinc-500 uppercase font-mono tracking-wider border-b border-zinc-800">
                Suggestions (Tab or Enter)
              </div>
              <div className="max-h-40 overflow-y-auto">
                {suggestions.map((s, idx) => {
                  const isSelected = idx === suggestionIndex;
                  const isKeyword = SQL_KEYWORDS.includes(s.toUpperCase());
                  const isTable = tableNames.includes(s);

                  return (
                    <div
                      key={s}
                      onClick={() => applySuggestion(s)}
                      className={cn(
                        'px-2.5 py-1 text-xs font-mono flex items-center justify-between cursor-pointer transition-colors',
                        isSelected ? 'bg-yellow-400/20 text-yellow-300 font-semibold' : 'text-zinc-300 hover:bg-zinc-800'
                      )}
                    >
                      <span>{s}</span>
                      <span className="text-[9px] text-zinc-500 uppercase">
                        {isKeyword ? 'keyword' : isTable ? 'table' : 'column'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Draggable Resizer Splitter between Editor and Results */}
      {!isResultsMinimized && (
        <div
          onMouseDown={() => setIsResizing(true)}
          className={cn(
            "h-1.5 hover:h-2 bg-zinc-800/80 hover:bg-yellow-400/80 cursor-row-resize transition-all shrink-0 z-20 flex items-center justify-center group",
            isResizing && "bg-yellow-400 h-2"
          )}
          title="Drag to resize SQL editor height"
        >
          <div className="w-8 h-0.5 bg-zinc-600 group-hover:bg-zinc-950 rounded-full" />
        </div>
      )}

      {/* =========================================================================
          BOTTOM RESULTS / ERROR NOTIFICATION PANEL (Minimizable)
      ========================================================================== */}
      <div className={cn(
        "flex flex-col bg-zinc-950 overflow-hidden transition-[height] duration-200",
        isResultsMinimized ? "h-8 shrink-0" : "flex-1 min-h-0"
      )}>
        {/* Results Header Status with Minimize Toggle */}
        <div
          onDoubleClick={() => setIsResultsMinimized(prev => !prev)}
          className="h-8 bg-zinc-900/80 border-b border-zinc-800 flex items-center justify-between px-3 text-xs shrink-0 select-none cursor-pointer hover:bg-zinc-900"
          title="Double-click header to minimize or restore Query Results"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsResultsMinimized(prev => !prev);
              }}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              title={isResultsMinimized ? "Expand Query Results" : "Minimize Query Results"}
            >
              {isResultsMinimized ? (
                <ChevronUp className="w-3.5 h-3.5 text-yellow-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
            <Terminal className="w-3.5 h-3.5 text-zinc-400" />
            <span className="font-semibold text-zinc-300 text-xs">Query Results</span>
            {result && (
              <span className={cn(
                'text-[11px] font-mono flex items-center gap-1',
                result.success ? 'text-emerald-400' : 'text-red-400'
              )}>
                {result.success ? (
                  <>
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{result.rowCount} rows ({result.duration_ms}ms)</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3 h-3" />
                    <span>Query Failed</span>
                  </>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
              {isResultsMinimized ? "Double-click to expand" : "Double-click to minimize"}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsResultsMinimized(prev => !prev);
              }}
              className="text-zinc-400 hover:text-zinc-200 text-[11px] flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {isResultsMinimized ? (
                <>
                  <Maximize2 className="w-3 h-3 text-yellow-400" />
                  <span className="text-yellow-400 font-medium">Expand</span>
                </>
              ) : (
                <>
                  <Minus className="w-3 h-3" />
                  <span>Minimize</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results Content or Error Notification */}
        {!isResultsMinimized && (
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col">
          {/* Informative Error Card (Requirement #3) */}
          {result && !result.success && (
            <div className="p-4 overflow-auto">
              <div className="p-4 rounded-lg bg-red-950/40 border border-red-500/40 text-red-200 space-y-2 animate-in fade-in-50">
                <div className="flex items-center gap-2 font-semibold text-xs text-red-300">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <span>SQL Execution Error {result.sqlState ? `[State: ${result.sqlState}]` : ''}</span>
                </div>
                <p className="text-xs font-mono text-red-100 bg-red-900/30 p-2 rounded border border-red-800/50">
                  {result.message || result.error}
                </p>
                {result.hint && (
                  <div className="text-[11px] text-zinc-400 bg-zinc-900/80 p-2 rounded border border-zinc-800">
                    <span className="text-yellow-400 font-semibold mr-1">Hint:</span>
                    <span>{result.hint}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Successful Tabular Grid Result */}
          {result && result.success && result.rows && result.rows.length > 0 && (
            <div className="flex-1 min-h-0 min-w-0 overflow-auto font-mono text-xs">
              <table className="min-w-full w-max border-collapse select-text">
                <thead className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800">
                  <tr>
                    <th className="w-10 px-2 py-1 text-center text-zinc-500 font-normal border-r border-zinc-800 select-none">
                      #
                    </th>
                    {result.columns.map(col => (
                      <th
                        key={col.name}
                        className="min-w-[130px] px-3 py-1.5 text-left border-r border-zinc-800 text-zinc-200 select-none"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[11px] font-semibold text-zinc-100">{col.name}</span>
                          {col.type && (
                            <span className="text-[10px] text-zinc-500 font-sans lowercase font-normal shrink-0">
                              {col.type}
                            </span>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row, rowIdx) => {
                    const actualRowIdx = (currentPage - 1) * pageSize + rowIdx + 1;
                    const globalRowIdx = (currentPage - 1) * pageSize + rowIdx;
                    return (
                      <tr
                        key={rowIdx}
                        className="hover:bg-zinc-900/60 border-b border-zinc-900"
                      >
                        <td className="w-10 px-2 py-1 text-center text-zinc-500 text-[10px] border-r border-zinc-800 select-none bg-zinc-950">
                          {actualRowIdx}
                        </td>
                        {result.columns.map((col, colIdx) => {
                          const val = row[col.name];
                          const isSelected = selectedCell.row === actualRowIdx - 1 && selectedCell.col === colIdx;
                          const isCellEditing = editingCell?.rowIdx === globalRowIdx && editingCell?.colName === col.name;
                          const isNull = val === null || val === undefined;
                          const isEmpty = val === '';

                          return (
                            <td
                              key={col.name}
                              onClick={() => setSelectedCell({ row: actualRowIdx - 1, col: colIdx })}
                              onDoubleClick={() => startInlineEdit(globalRowIdx, col.name, val)}
                              title="Double-click to edit cell"
                              className={cn(
                                'px-3 py-1 border-r border-zinc-800 whitespace-nowrap overflow-hidden text-ellipsis cursor-cell transition-colors relative max-w-[400px]',
                                isSelected && 'bk-cell-selected',
                                'hover:bg-zinc-800/40'
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
                                    className="w-full bg-zinc-900 text-yellow-300 font-mono text-[11px] px-2 py-0.5 focus:outline-none border border-yellow-500/50 rounded-sm shadow-inner"
                                  />
                                </div>
                              ) : isNull ? (
                                <span className="text-zinc-600 italic select-none text-[11px]">(NULL)</span>
                              ) : isEmpty ? (
                                <span className="text-zinc-600 italic select-none text-[11px]">(EMPTY)</span>
                              ) : (
                                <span className="text-zinc-200 text-[11px] tabular-nums">{String(val)}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* DDL or Action Success without rows */}
          {result && result.success && (!result.rows || result.rows.length === 0) && (
            <div className="p-6 text-center text-zinc-400 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <div className="text-xs font-semibold text-zinc-200">{result.message}</div>
              <div className="text-[11px] text-zinc-500 font-mono">Duration: {result.duration_ms}ms</div>
            </div>
          )}

          {/* Zero State / Waiting for Query Execution */}
          {!result && (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 text-xs gap-2 select-none">
              <Play className="w-6 h-6 text-zinc-700" />
              <span>Click Run or press Ctrl+Enter to execute SQL query</span>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Beekeeper Connection Footer */}
      {connection && (
        <ConnectionFooter
          connection={connection}
          rowCount={totalRows}
          lastActiveTime={result ? `${result.duration_ms}ms • ${relativeTimeText}` : relativeTimeText}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          onRefresh={handleExecute}
          onNewRow={handleClear}
          onOpenStructure={() => {
            info('Database Entities', `Schema has ${schemas.length} schema group(s) with ${schemas.flatMap(s => s.tables).length} table(s).`);
          }}
          onDisconnect={onDisconnect}
        />
      )}
    </div>
  );
}
