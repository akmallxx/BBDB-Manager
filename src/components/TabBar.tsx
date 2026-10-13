import { Plus, X, Table, Code, Monitor, CheckCircle, Undo2, ShieldAlert, ScrollText, Unplug } from 'lucide-react';
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
  return (
    <div className="h-10 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-2 select-none shrink-0 overflow-x-auto">
      {/* Left: Tab Items List & + Add Query Tab */}
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto no-scrollbar">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={cn(
                'group flex items-center gap-1 px-3 py-1.5 rounded-t-sm text-xs font-medium cursor-pointer transition-colors shrink-0 max-w-[200px]',
                isActive
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 border-transparent'
              )}
            >
              {/* Tab Icon based on type */}
              {tab.type === 'connection_form' && (
                <Monitor className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              )}
              {tab.type === 'table_data' && (
                <div className="w-3.5 h-3.5 text-yellow-400 rounded-sm flex items-center justify-center shrink-0">
                  <Table className="w-3.5 h-3.5" />
                </div>
              )}
              {tab.type === 'query_editor' && (
                <Code className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              )}

              {/* Title with [all] label for table tabs */}
              <span className="truncate text-[11px]">
                {tab.title}
                {tab.type === 'table_data' && <span className="text-zinc-500 font-sans ml-1 text-[10px]"><i>[all]</i></span>}
              </span>

              {/* Unsaved indicator dot */}
              {tab.isDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" title="Unsaved changes" />
              )}

              {/* Close Button */}
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  title={isActive ? "Close Tab (Ctrl+W)" : "Close Tab"}
                  className="p-0.5 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 opacity-60 group-hover:opacity-100 transition-opacity cursor-pointer ml-1"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* Add New Query Button */}
        <button
          onClick={onNewQueryTab}
          title="New Query Tab (Alt+T)"
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right Controls: Manual Commit / Autocommit & Connection Info & Upgrade Badge */}
      <div className="flex items-center gap-2 pl-3 shrink-0">
        {activeConnectionEnvironment === 'production' && (
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-950/60 border border-red-500/40 text-red-300 text-[11px] font-semibold animate-pulse"
            title="Production Database Active: Autocommit is disabled. Manual commit required to persist changes."
          >
            <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
            <span className="font-mono text-[10px] tracking-wide">PROD • MANUAL COMMIT</span>
          </div>
        )}
        {activeConnectionEnvironment === 'test' && (
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/50 border border-amber-500/30 text-amber-300 text-[10px] font-mono font-bold"
            title="Test / Staging Database"
          >
            TEST / STAGING
          </div>
        )}

        {/* Manual Commit & Autocommit Switch */}
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5">
          <div
            onClick={onToggleAutocommit}
            className="flex items-center gap-1.5 text-[11px] font-mono cursor-pointer select-none"
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
    </div>
  );
}
