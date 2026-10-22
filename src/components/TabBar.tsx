import { Plus, X, Table, Code, Monitor, CheckCircle, Undo2, ShieldAlert, ScrollText, Unplug, Terminal, FolderArchive } from 'lucide-react';
import { WorkspaceTab, ConnectionEnvironment } from '../types/database';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Switch } from './ui/switch';

interface TabBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewQueryTab: () => void;
  onNewTerminalTab?: () => void;
  workspaceMode?: 'database' | 'ssh';
  activeTabType?: WorkspaceTab['type'];
  // Transaction controls
  autocommit: boolean;
  onToggleAutocommit: () => void;
  inTransaction: boolean;
  onCommit: () => void;
  onRollback: () => void;
  onOpenTransactionLog?: () => void;
  // Connection info
  activeConnectionName?: string;
  activeConnectionColor?: string;
  activeConnectionEnvironment?: ConnectionEnvironment;
  onDisconnect?: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewQueryTab,
  onNewTerminalTab,
  workspaceMode,
  activeTabType,
  autocommit,
  onToggleAutocommit,
  inTransaction,
  onCommit,
  onRollback,
  onOpenTransactionLog,
  activeConnectionName,
  activeConnectionColor = '#06b6d4',
  activeConnectionEnvironment,
  onDisconnect
}: TabBarProps) {
  const isSshMode = activeTabType === 'ssh_terminal' || activeTabType === 'sftp_explorer' || workspaceMode === 'ssh';
  return (
    <div className="h-10 bg-slate-200/70 dark:bg-zinc-950 border-b border-slate-300 dark:border-zinc-800 flex items-center justify-between px-2 select-none shrink-0 overflow-x-auto transition-colors">
      {/* Left: Tab Items List & + Add Query Tab */}
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto no-scrollbar">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={cn(
                'tab-item group flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-medium cursor-pointer select-none shrink-0 max-w-[210px] border-0 outline-none ring-0 transition-colors',
                isActive
                  ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-xs'
                  : 'bg-slate-300/40 dark:bg-zinc-900/50 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-slate-300/80 dark:hover:bg-zinc-900/80'
              )}
              style={{ outline: 'none', boxShadow: 'none' }}
            >
              {/* Tab Icon based on type */}
              {tab.type === 'connection_form' && (
                <Monitor className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400 shrink-0" />
              )}
              {tab.type === 'table_data' && (
                <div className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400 rounded-sm flex items-center justify-center shrink-0">
                  <Table className="w-3.5 h-3.5" />
                </div>
              )}
              {tab.type === 'query_editor' && (
                <Code className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
              )}
              {tab.type === 'ssh_terminal' && (
                <Terminal className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              {tab.type === 'sftp_explorer' && (
                <FolderArchive className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
              )}

              {/* Title with [all] label for table tabs */}
              <span className="truncate text-[11px]">
                {tab.title}
                {tab.type === 'table_data' && <span className="text-slate-400 dark:text-zinc-500 font-sans ml-1 text-[10px]"><i>[all]</i></span>}
              </span>

              {/* Unsaved indicator dot */}
              {tab.isDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 dark:bg-yellow-400 shrink-0" title="Unsaved changes" />
              )}

              {/* Close Button */}
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  title={isActive ? "Close Tab" : "Close Tab"}
                  className="p-0.5 rounded text-slate-400 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-100 hover:bg-slate-200 dark:hover:bg-zinc-700/60 opacity-60 group-hover:opacity-100 cursor-pointer ml-1 border-0"
                  style={{ outline: 'none', boxShadow: 'none' }}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* Add New Tab Button (Context-Aware: New Terminal in SSH mode, New Query in DB mode) */}
        <button
          type="button"
          onClick={isSshMode ? (onNewTerminalTab || onNewQueryTab) : onNewQueryTab}
          title={isSshMode ? "New Terminal Session" : "New Query Tab"}
          className="p-1.5 rounded hover:bg-slate-300/80 dark:hover:bg-zinc-800 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 cursor-pointer shrink-0 border-0 transition-colors"
          style={{ outline: 'none', boxShadow: 'none' }}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right Controls: Database Transactions */}
      {!isSshMode && (
        <div className="flex items-center gap-2 pl-3 shrink-0">
          {/* Manual Commit & Autocommit Switch */}
          <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 rounded px-2 py-0.5 shadow-2xs">
            <div
              onClick={onToggleAutocommit}
              className="flex items-center gap-1.5 text-[11px] font-mono cursor-pointer select-none text-slate-700 dark:text-zinc-300"
              title={activeConnectionEnvironment === 'production' ? "Production Database: Click to toggle autocommit (Caution advised)" : "Toggle Autocommit / Manual Commit mode"}
            >
              <Switch
                size="sm"
                checked={autocommit}
                onCheckedChange={onToggleAutocommit}
              />
              <span className={cn('text-[11px]', autocommit ? 'text-zinc-200' : 'text-amber-300 font-semibold')}>
                {autocommit ? 'Autocommit' : 'Manual Commit'}
              </span>
            </div>

            {/* Active Transaction Controls (Commit & Rollback & Log Modal) */}
            {(!autocommit || inTransaction) && (
              <div className="flex items-center gap-1 border-l border-zinc-700/60 pl-1.5 ml-0.5">
                {/* Commit Button */}
                <Button
                  size="xs"
                  variant="yellow"
                  onClick={onCommit}
                  disabled={!inTransaction}
                  className={cn(
                    "h-5 sm:h-6 text-[10px] px-1.5 sm:px-2 py-0 flex items-center gap-1 font-semibold transition-all cursor-pointer",
                    !inTransaction && "opacity-35 cursor-not-allowed bg-zinc-800/80 text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-500 shadow-none border border-zinc-700/30"
                  )}
                  title={inTransaction ? "Commit pending database changes" : "No active transaction to commit"}
                >
                  <CheckCircle className="w-2.5 h-2.5 shrink-0" />
                  <span className="hidden sm:inline">Commit</span>
                </Button>

                {/* Rollback Button */}
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={onRollback}
                  disabled={!inTransaction}
                  className={cn(
                    "h-5 sm:h-6 text-[10px] px-1.5 sm:px-2 py-0 flex items-center gap-1 transition-all cursor-pointer",
                    inTransaction
                      ? "text-red-300 border-red-500/40 hover:bg-red-500/10 hover:text-red-200"
                      : "opacity-35 cursor-not-allowed text-zinc-500 border-zinc-800 hover:bg-transparent hover:text-zinc-500"
                  )}
                  title={inTransaction ? "Rollback pending database changes" : "No active transaction to rollback"}
                >
                  <Undo2 className="w-2.5 h-2.5 shrink-0" />
                  <span className="hidden sm:inline">Rollback</span>
                </Button>

                {/* Transaction Log Modal Trigger Button */}
                {onOpenTransactionLog && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={onOpenTransactionLog}
                    className="h-5 sm:h-6 text-[10px] px-1.5 py-0 flex items-center gap-1 text-zinc-300 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer"
                    title="View Transaction Logs and History"
                  >
                    <ScrollText className="w-2.5 h-2.5 text-zinc-400" />
                    <span className="hidden md:inline">Log</span>
                    {inTransaction && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
