import React, { useState, useEffect } from 'react';
import { X, CheckCircle, Undo2, Clock, Terminal, AlertTriangle, Copy, Check, ShieldAlert, History, Layers, RefreshCw } from 'lucide-react';
import { TransactionStatement, CompletedTransaction, TransactionLogResponse } from '../types/database';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { useToast } from './ui/toast';

interface TransactionLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId?: string;
  database?: string;
  inTransaction: boolean;
  onCommit: () => void;
  onRollback: () => void;
  isProduction?: boolean;
}

export function TransactionLogModal({
  isOpen,
  onClose,
  connectionId,
  database,
  inTransaction,
  onCommit,
  onRollback,
  isProduction = false
}: TransactionLogModalProps) {
  const { success, error } = useToast();
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [logData, setLogData] = useState<TransactionLogResponse>({
    inTransaction: false,
    startedAt: null,
    elapsedMs: 0,
    statements: [],
    history: []
  });
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchLogs = async () => {
    if (!isOpen || !connectionId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/transaction/logs?sessionId=${encodeURIComponent(connectionId)}&connectionId=${encodeURIComponent(connectionId)}`);
      if (res.ok) {
        const data: TransactionLogResponse = await res.json();
        setLogData(data);
      }
    } catch {
      console.warn('Failed to load transaction logs');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, connectionId, inTransaction]);

  const handleCopyQuery = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    success('Copied SQL', 'Query copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isOpen) return null;

  const pendingStatements = logData.statements || [];
  const historyList = logData.history || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in-50">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden animate-in zoom-in-95">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/70">
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center border",
              inTransaction
                ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                : "bg-zinc-800 border-zinc-700 text-zinc-400"
            )}>
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-zinc-100 tracking-tight">Transaction Log Inspector</h3>
                {inTransaction ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    ACTIVE TRANSACTION
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                    IDLE (NO PENDING CHANGES)
                  </span>
                )}
                {isProduction && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                    <ShieldAlert className="w-3 h-3" />
                    PROD
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                Target: {database || 'postgres'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-zinc-800/80 bg-zinc-950/40">
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-0.5 rounded-lg text-xs">
            <button
              onClick={() => setActiveTab('pending')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors cursor-pointer text-xs",
                activeTab === 'pending'
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Pending Statements</span>
              <span className={cn(
                "px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ml-0.5",
                pendingStatements.length > 0 ? "bg-amber-500/30 text-amber-300" : "bg-zinc-800 text-zinc-500"
              )}>
                {pendingStatements.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-colors cursor-pointer text-xs",
                activeTab === 'history'
                  ? "bg-zinc-800 text-zinc-100 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <History className="w-3.5 h-3.5 text-zinc-400" />
              <span>Transaction History</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium ml-0.5 bg-zinc-800 text-zinc-400">
                {historyList.length}
              </span>
            </button>
          </div>

          <Button
            size="xs"
            variant="ghost"
            onClick={fetchLogs}
            disabled={isLoading}
            className="text-[11px] text-zinc-400 hover:text-zinc-200 h-7 flex items-center"
          >
            <RefreshCw className={cn('w-3 h-3 mr-1.5 transition-transform', isLoading && 'animate-spin text-yellow-400')} />
            {isLoading ? 'Refreshing...' : 'Refresh Logs'}
          </Button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'pending' && (
            <>
              {inTransaction ? (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="leading-snug">
                    <strong className="text-amber-100">Uncommitted Transaction Pending:</strong>
                    <p className="text-amber-200/90 text-[11px] mt-0.5">
                      The statements below have been executed within your private transaction session client. They are <span className="underline decoration-amber-400 font-semibold">not yet visible</span> to other users or connections until you click <strong>Commit</strong>. You can click <strong>Rollback</strong> to completely discard them.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 text-zinc-500">
                  <Clock className="w-8 h-8 mx-auto mb-2 text-zinc-600 opacity-80" />
                  <h4 className="text-xs font-semibold text-zinc-300">No Open Transaction</h4>
                  <p className="text-[11px] text-zinc-500 max-w-md mx-auto mt-1">
                    When in Manual Commit mode (or Production), any query executed will remain in an active transaction and show up here until you Commit or Rollback.
                  </p>
                </div>
              )}

              {/* Pending Statements List */}
              {pendingStatements.length > 0 && (
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                    <span>Statements in Current Transaction</span>
                    <span className="text-[10px] text-zinc-500 font-mono">({pendingStatements.length})</span>
                  </h4>

                  <div className="space-y-2">
                    {pendingStatements.map((stmt, idx) => (
                      <div
                        key={stmt.id || idx}
                        className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 space-y-2 hover:border-zinc-700 transition-colors"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded bg-zinc-800 text-zinc-300 font-mono font-bold flex items-center justify-center text-[10px]">
                              #{idx + 1}
                            </span>
                            <span className="text-zinc-400 font-mono">
                              {new Date(stmt.timestamp).toLocaleTimeString()}
                            </span>
                            <span className="text-zinc-500 font-mono">
                              {stmt.duration_ms}ms
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300">
                              {stmt.rowCount} affected
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                              PENDING
                            </span>
                            <button
                              onClick={() => handleCopyQuery(stmt.id, stmt.query)}
                              className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                              title="Copy SQL statement"
                            >
                              {copiedId === stmt.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* SQL Code Box */}
                        <pre className="p-2.5 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-200 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed select-text">
                          {stmt.query}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'history' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                  Past Completed Transactions
                </h4>
                <span className="text-[11px] text-zinc-500 font-mono">
                  {historyList.length} recorded
                </span>
              </div>

              {historyList.length === 0 ? (
                <div className="p-8 text-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 text-zinc-500">
                  <History className="w-7 h-7 mx-auto mb-2 text-zinc-600" />
                  <p className="text-xs">No transaction history yet.</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">Transactions committed or rolled back in manual mode will appear here.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {historyList.map((tx) => (
                    <div
                      key={tx.id}
                      className="p-3.5 rounded-lg border border-zinc-800/80 bg-zinc-950/60 space-y-2.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border",
                            tx.action === 'committed'
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                              : "bg-red-500/20 text-red-300 border-red-500/40"
                          )}>
                            {tx.action === 'committed' ? 'COMMITTED' : 'ROLLED BACK'}
                          </span>
                          <span className="text-zinc-300 font-mono text-[11px]">
                            {new Date(tx.endedAt).toLocaleTimeString()}
                          </span>
                          <span className="text-zinc-500 text-[11px] font-mono">
                            {tx.durationMs}ms duration
                          </span>
                        </div>

                        <span className="text-[11px] font-mono text-zinc-400">
                          {tx.statementCount} statement(s)
                        </span>
                      </div>

                      {/* Statements in this completed transaction */}
                      {tx.statements && tx.statements.length > 0 && (
                        <div className="space-y-1.5 pl-2 border-l border-zinc-800">
                          {tx.statements.map((stmt, sIdx) => (
                            <div key={sIdx} className="text-[11px] font-mono text-zinc-400 truncate flex items-center justify-between">
                              <span className="truncate pr-2">• {stmt.query}</span>
                              <span className="text-[10px] text-zinc-500 shrink-0">{stmt.rowCount} rows</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between gap-3">
          <div className="text-[11px] text-zinc-500 hidden sm:block">
            {inTransaction
              ? '⚠️ Unsaved transaction: changes remain temporary until committed.'
              : 'Auto/Manual commit controller.'}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onRollback();
                setTimeout(fetchLogs, 250);
              }}
              disabled={!inTransaction}
              className={cn(
                "h-8 text-xs px-3 text-red-300 border-red-500/30 hover:bg-red-500/10 hover:text-red-200 transition-all cursor-pointer",
                !inTransaction && "opacity-40 cursor-not-allowed border-zinc-800 text-zinc-500 hover:bg-transparent hover:text-zinc-500"
              )}
              title={inTransaction ? "Discard all pending changes in this transaction" : "No active transaction to rollback"}
            >
              <Undo2 className="w-3.5 h-3.5 mr-1" />
              Rollback All
            </Button>

            <Button
              size="sm"
              variant="yellow"
              onClick={() => {
                onCommit();
                setTimeout(fetchLogs, 250);
              }}
              disabled={!inTransaction}
              className={cn(
                "h-8 text-xs px-4 font-semibold shadow-sm transition-all cursor-pointer",
                !inTransaction && "opacity-40 cursor-not-allowed bg-zinc-800 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-500 shadow-none"
              )}
              title={inTransaction ? "Commit all pending changes permanently to database" : "No active transaction to commit"}
            >
              <CheckCircle className="w-3.5 h-3.5 mr-1" />
              Commit All
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="h-8 text-xs px-3 text-zinc-400 hover:text-zinc-100"
            >
              Close
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
