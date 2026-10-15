import { Monitor, Database, Code, History, Sun, Moon, Info, Unplug } from 'lucide-react';
import { cn } from '../lib/utils';
import { APP_NAME } from '../lib/config';

export type RailView = 'connections' | 'entities' | 'history';

interface NavigationRailProps {
  currentView: RailView;
  isSidebarOpen?: boolean;
  onViewChange: (view: RailView) => void;
  onNewQuery: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  activeConnectionName?: string;
  activeConnectionColor?: string;
  hasActiveConnection: boolean;
  onDisconnect?: () => void;
}

export function NavigationRail({
  currentView,
  isSidebarOpen = true,
  onViewChange,
  onNewQuery,
  theme,
  onToggleTheme,
  activeConnectionName,
  activeConnectionColor = '#06b6d4',
  hasActiveConnection,
  onDisconnect
}: NavigationRailProps) {
  return (
    <aside className="w-12 h-screen bg-zinc-950 border-r border-zinc-800/80 flex flex-col items-center justify-between py-3 z-30 shrink-0 select-none">
      {/* Top Icons */}
      <div className="flex flex-col items-center gap-2 w-full">
        {/* Brand App Logo */}
        <div
          title={APP_NAME}
          className="w-8 h-8 rounded-lg flex items-center justify-center p-0.5 bg-zinc-900 border border-zinc-800 shadow-sm mb-1"
        >
          <img src="/logo.png" alt={APP_NAME} className="w-full h-full object-contain rounded" />
        </div>

        {/* Connections View Button */}
        <button
          onClick={() => onViewChange('connections')}
          title={isSidebarOpen && currentView === 'connections' ? 'Connections (Click to collapse)' : 'Connections (Click to open)'}
          className={cn(
            'relative w-8 h-8 rounded flex items-center justify-center transition-colors cursor-pointer',
            isSidebarOpen && currentView === 'connections'
              ? 'text-zinc-100 bg-zinc-800/90'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
          )}
        >
          {isSidebarOpen && currentView === 'connections' && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-yellow-400 rounded-r" />
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
              ? 'text-zinc-100 bg-zinc-800/90'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
          )}
        >
          {isSidebarOpen && currentView === 'entities' && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-yellow-400 rounded-r" />
          )}
          <Database className="w-4 h-4" />
        </button>

        {/* Quick New Query Button */}
        <button
          onClick={onNewQuery}
          disabled={!hasActiveConnection}
          title="New Query Tab (Alt+T)"
          className={cn(
            'w-8 h-8 rounded flex items-center justify-center transition-colors cursor-pointer text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900',
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
              ? 'text-zinc-100 bg-zinc-800/90'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
          )}
        >
          {isSidebarOpen && currentView === 'history' && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-yellow-400 rounded-r" />
          )}
          <History className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom Icons: Active status dot, Theme toggle, App Info */}
      <div className="flex flex-col items-center gap-2 w-full">
        {hasActiveConnection && (
          <>
            <button
              onClick={onDisconnect}
              title={`Disconnect from ${activeConnectionName} (Ctrl+Shift+Q)`}
              className="w-8 h-8 rounded flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Unplug className="w-4 h-4" />
            </button>
          </>
        )}

        {/* Dark/Light mode toggle */}
        <button
          onClick={onToggleTheme}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          className="w-8 h-8 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-zinc-400" />}
        </button>

        {/* App Info Tooltip trigger */}
        <div
          title={`${APP_NAME} v1.0.0`}
          className="w-8 h-8 rounded flex items-center justify-center text-zinc-600 hover:text-zinc-400 cursor-help"
        >
          <Info className="w-3.5 h-3.5" />
        </div>
      </div>
    </aside>
  );
}
