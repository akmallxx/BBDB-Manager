import { Monitor, Database, Code, History, Sun, Moon, Info, Unplug, Terminal, FolderArchive, Settings } from 'lucide-react';
import { cn } from '../lib/utils';
import { APP_NAME } from '../lib/config';

export type RailView = 'connections' | 'entities' | 'history' | 'snippets';

interface NavigationRailProps {
  currentView: RailView;
  isSidebarOpen?: boolean;
  onViewChange: (view: RailView) => void;
  onNewQuery: () => void;
  onOpenSsh?: () => void;
  onOpenSftp?: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenSettings?: () => void;
  activeConnectionName?: string;
  activeConnectionColor?: string;
  hasActiveConnection: boolean;
  onDisconnect?: () => void;
  // Context-aware Workspace Mode
  workspaceMode: 'database' | 'ssh';
  onWorkspaceModeChange: (mode: 'database' | 'ssh') => void;
  activeTabType?: string;
}

export function NavigationRail({
  currentView,
  isSidebarOpen = true,
  onViewChange,
  onNewQuery,
  onOpenSsh,
  onOpenSftp,
  theme,
  onToggleTheme,
  onOpenSettings,
  activeConnectionName,
  activeConnectionColor = '#06b6d4',
  hasActiveConnection,
  onDisconnect,
  workspaceMode,
  onWorkspaceModeChange,
  activeTabType
}: NavigationRailProps) {
  return (
    <aside className="w-12 h-screen bg-slate-100 dark:bg-zinc-950 border-r border-slate-300 dark:border-zinc-800/80 flex flex-col items-center justify-between py-3 z-30 shrink-0 select-none transition-colors">
      {/* Top Icons */}
      <div className="flex flex-col items-center gap-2 w-full">
        {/* Brand App Logo */}
        <div
          title={APP_NAME}
          className="w-8 h-8 rounded-lg flex items-center justify-center p-0.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 shadow-sm mb-1"
        >
          <img src="/logo.png" alt={APP_NAME} className="w-full h-full object-contain rounded" />
        </div>

        {/* Mode Switcher Pill (Database vs SSH) */}
        <div className="flex flex-col gap-1 p-0.5 rounded-lg bg-slate-200 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 shadow-inner">
          <button
            type="button"
            onClick={() => onWorkspaceModeChange('database')}
            title="Database Workspace Mode (SQL, Tables, Schemas)"
            className={cn(
              'w-7 h-7 rounded flex items-center justify-center transition-all cursor-pointer',
              workspaceMode === 'database'
                ? 'bg-yellow-500 dark:bg-yellow-400 text-slate-950 dark:text-zinc-950 shadow-xs'
                : 'text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800/60'
            )}
          >
            <Database className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onWorkspaceModeChange('ssh')}
            title="Remote SSH & SFTP Mode (Terminal CLI & SFTP Explorer)"
            className={cn(
              'w-7 h-7 rounded flex items-center justify-center transition-all cursor-pointer',
              workspaceMode === 'ssh'
                ? 'bg-emerald-500 text-slate-950 dark:text-zinc-950 shadow-xs'
                : 'text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800/60'
            )}
          >
            <Terminal className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="w-6 h-px bg-slate-300 dark:bg-zinc-800 my-1" />

        {/* MODE 1: DATABASE NAVIGATION BUTTONS */}
        {workspaceMode === 'database' && (
          <>
            {/* Connections View Button */}
            <button
              onClick={() => onViewChange('connections')}
              title={isSidebarOpen && currentView === 'connections' ? 'Database Connections (Click to collapse)' : 'Database Connections (Click to open)'}
              className={cn(
                'relative w-8 h-8 rounded flex items-center justify-center transition-colors cursor-pointer',
                isSidebarOpen && currentView === 'connections'
                  ? 'text-slate-900 dark:text-zinc-100 bg-slate-200 dark:bg-zinc-800/90'
                  : 'text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-zinc-900'
              )}
            >
              {isSidebarOpen && currentView === 'connections' && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-yellow-500 dark:bg-yellow-400 rounded-r" />
              )}
              <Monitor className="w-4 h-4" />
            </button>

            {/* Entities / Tables Schema Tree View Button */}
            <button
              onClick={() => onViewChange('entities')}
              disabled={!hasActiveConnection}
              title={
                !hasActiveConnection
                  ? 'Connect to a database first'
                  : isSidebarOpen && currentView === 'entities'
                  ? `Entities (${activeConnectionName}) (Click to collapse)`
                  : `Entities (${activeConnectionName}) (Click to open)`
              }
              className={cn(
                'relative w-8 h-8 rounded flex items-center justify-center transition-colors cursor-pointer',
                !hasActiveConnection && 'opacity-40 cursor-not-allowed',
                isSidebarOpen && currentView === 'entities'
                  ? 'text-slate-900 dark:text-zinc-100 bg-slate-200 dark:bg-zinc-800/90'
                  : 'text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-zinc-900'
              )}
            >
              {isSidebarOpen && currentView === 'entities' && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-yellow-500 dark:bg-yellow-400 rounded-r" />
              )}
              <Database className="w-4 h-4" />
            </button>

            {/* Quick New Query Button */}
            <button
              onClick={onNewQuery}
              disabled={!hasActiveConnection}
              title={!hasActiveConnection ? "Connect to a database first" : "New Query Tab"}
              className={cn(
                'w-8 h-8 rounded flex items-center justify-center transition-colors cursor-pointer text-slate-500 dark:text-zinc-500 hover:text-yellow-600 dark:hover:text-yellow-400 hover:bg-yellow-500/10 dark:hover:bg-yellow-400/10',
                !hasActiveConnection && 'opacity-40 cursor-not-allowed'
              )}
            >
              <Code className="w-4 h-4" />
            </button>

            {/* Query History Button */}
            <button
              onClick={() => onViewChange('history')}
              title={isSidebarOpen && currentView === 'history' ? 'Query History (Click to collapse)' : 'Query History (Click to open)'}
              className={cn(
                'relative w-8 h-8 rounded flex items-center justify-center transition-colors cursor-pointer',
                isSidebarOpen && currentView === 'history'
                  ? 'text-slate-900 dark:text-zinc-100 bg-slate-200 dark:bg-zinc-800/90'
                  : 'text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-zinc-900'
              )}
            >
              {isSidebarOpen && currentView === 'history' && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-yellow-500 dark:bg-yellow-400 rounded-r" />
              )}
              <History className="w-4 h-4" />
            </button>
          </>
        )}

        {/* MODE 2: SSH & SFTP NAVIGATION BUTTONS */}
        {workspaceMode === 'ssh' && (
          <>
            {/* SSH & SFTP Hosts Button */}
            <button
              onClick={() => onViewChange('connections')}
              title={isSidebarOpen && currentView === 'connections' ? 'SSH & SFTP Hosts (Click to collapse)' : 'SSH & SFTP Hosts (Click to open)'}
              className={cn(
                'relative w-8 h-8 rounded flex items-center justify-center transition-colors cursor-pointer',
                isSidebarOpen && currentView === 'connections'
                  ? 'text-slate-900 dark:text-zinc-100 bg-slate-200 dark:bg-zinc-800/90'
                  : 'text-slate-500 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-zinc-300 hover:bg-slate-200/60 dark:hover:bg-zinc-900'
              )}
            >
              {isSidebarOpen && currentView === 'connections' && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-emerald-500 dark:bg-emerald-400 rounded-r" />
              )}
              <Monitor className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </button>

            {/* Remote SSH Terminal Quick Launch / Switch */}
            {onOpenSsh && (
              <button
                onClick={onOpenSsh}
                title={activeConnectionName ? `SSH CLI (${activeConnectionName})` : "SSH CLI"}
                className={cn(
                  "relative w-8 h-8 rounded flex items-center justify-center transition-colors cursor-pointer",
                  activeTabType === 'ssh_terminal'
                    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 dark:bg-emerald-950/60 border border-emerald-500/30 dark:border-emerald-800/50 shadow-xs"
                    : "text-slate-500 dark:text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/10 dark:hover:bg-emerald-950/40"
                )}
              >
                {activeTabType === 'ssh_terminal' && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-emerald-500 dark:bg-emerald-400 rounded-r" />
                )}
                <Terminal className="w-4 h-4" />
              </button>
            )}

            {/* Remote SFTP Explorer Quick Launch / Switch */}
            {onOpenSftp && (
              <button
                onClick={onOpenSftp}
                title={activeConnectionName ? `SFTP Explorer (${activeConnectionName})` : "SFTP Explorer"}
                className={cn(
                  "relative w-8 h-8 rounded flex items-center justify-center transition-colors cursor-pointer",
                  activeTabType === 'sftp_explorer'
                    ? "text-sky-600 dark:text-sky-400 bg-sky-500/15 dark:bg-sky-950/60 border border-sky-500/30 dark:border-sky-800/50 shadow-xs"
                    : "text-slate-500 dark:text-zinc-500 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-500/10 dark:hover:bg-sky-950/40"
                )}
              >
                {activeTabType === 'sftp_explorer' && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-sky-500 dark:bg-sky-400 rounded-r" />
                )}
                <FolderArchive className="w-4 h-4" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Bottom Icons: Active status dot, Theme toggle, App Info */}
      <div className="flex flex-col items-center gap-2 w-full">
        {hasActiveConnection && (
          <>
            <button
              onClick={onDisconnect}
              title={`Disconnect from ${activeConnectionName} (Ctrl+Shift+Q)`}
              className="w-8 h-8 rounded flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Unplug className="w-4 h-4" />
            </button>
          </>
        )}

        {/* Settings Menu Button */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            aria-label="Studio Settings & Preferences (Ctrl+,)"
            aria-haspopup="dialog"
            title="Studio Settings & Preferences (Ctrl+,)"
            className="w-8 h-8 rounded flex items-center justify-center text-slate-500 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}

        {/* Dark/Light mode toggle */}
        <button
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          className="w-8 h-8 rounded flex items-center justify-center text-slate-500 dark:text-zinc-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-200 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
        </button>

        {/* App Info Tooltip trigger */}
        <div
          title={`${APP_NAME} v1.0.0`}
          className="w-8 h-8 rounded flex items-center justify-center text-slate-400 dark:text-zinc-600 hover:text-slate-600 dark:hover:text-zinc-400 cursor-help"
        >
          <Info className="w-3.5 h-3.5" />
        </div>
      </div>
    </aside>
  );
}
