import React, { useState, useEffect } from 'react';
import { Link2, ExternalLink, Hash, Clock, Info, RefreshCw, Plus, Settings, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { DatabaseConnection } from '../types/database';
import { cn } from '../lib/utils';
import { useToast } from './ui/toast';

interface ConnectionFooterProps {
  connection: DatabaseConnection;
  activeTableName?: string;
  rowCount?: number;
  lastActiveTime?: string;
  currentPage?: number;
  totalPages?: number;
  isEditingEnabled?: boolean;
  onToggleEditing?: () => void;
  onPageChange?: (newPage: number) => void;
  onRefresh?: () => void;
  onNewRow?: () => void;
  onOpenStructure?: () => void;
  onDisconnect?: () => void;
}

export function ConnectionFooter({
  connection,
  activeTableName,
  rowCount = 28,
  lastActiveTime = 'Just now',
  currentPage = 1,
  totalPages = 1,
  isEditingEnabled = false,
  onToggleEditing,
  onPageChange,
  onRefresh,
  onNewRow,
  onOpenStructure,
  onDisconnect
}: ConnectionFooterProps) {
  const { info, success } = useToast();
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const handleRefreshClick = () => {
    setIsRefreshing(true);
    onRefresh?.();
    setTimeout(() => {
      setIsRefreshing(false);
    }, 700);
  };

  // Determine contrast for custom background color
  const hex = (connection.color || '#ef4444').replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const isLight = luminance > 0.45;

  const textClass = isLight ? 'text-zinc-950 font-medium' : 'text-zinc-100 font-medium';
  const pillClass = isLight
    ? 'bg-black/15 hover:bg-black/25 text-zinc-950 active:bg-black/30'
    : 'bg-white/15 hover:bg-white/25 text-zinc-100 active:bg-white/30';
  const borderClass = isLight ? 'border-black/25' : 'border-white/25';
  const inputClass = isLight
    ? 'bg-black/15 border-black/30 text-zinc-950 focus:border-black'
    : 'bg-white/15 border-white/30 text-zinc-100 focus:border-white';

  const handlePageSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const p = parseInt(pageInput, 10);
      if (!isNaN(p)) {
        const clamped = Math.max(1, Math.min(p, totalPages));
        setPageInput(String(clamped));
        onPageChange?.(clamped);
      }
    }
  };

  const handlePageBlur = () => {
    const p = parseInt(pageInput, 10);
    if (!isNaN(p)) {
      const clamped = Math.max(1, Math.min(p, totalPages));
      setPageInput(String(clamped));
      if (clamped !== currentPage) {
        onPageChange?.(clamped);
      }
    } else {
      setPageInput(String(currentPage));
    }
  };

  return (
    <footer
      className={cn(
        'h-8.5 min-h-[34px] px-3.5 flex items-center justify-between text-xs select-none shrink-0 transition-colors z-20 shadow-inner',
        textClass
      )}
      style={{ backgroundColor: connection.color || '#ef4444' }}
    >
      {/* =========================================================================
          LEFT SECTION: Link Icon, Connection Name, Driver, Structure Button, Stats
      ========================================================================== */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Link icon + Connection Name */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Link2 className="w-3.5 h-3.5 stroke-[2.5]" />
          <span className="font-bold tracking-tight text-xs">{connection.name}</span>
        </div>

        {/* Driver pill/text */}
        <span className="text-[11px] font-mono opacity-80 shrink-0">
          {connection.driver}
        </span>

        {/* Environment pill */}
        <span
          className={cn(
            'px-1.5 py-0.2 rounded text-[10px] font-mono font-bold uppercase shrink-0',
            connection.environment === 'production' && 'bg-red-950/70 text-red-200 border border-red-400/50',
            connection.environment === 'test' && 'bg-amber-950/70 text-amber-200 border border-amber-400/50',
            (!connection.environment || connection.environment === 'development') && 'bg-black/20 text-current border border-black/20'
          )}
        >
          {connection.environment ? connection.environment.toUpperCase() : 'DEV'}
        </span>

        {/* Structure Button with external arrow (Exact match from screenshot) */}
        {activeTableName && (
          <button
            onClick={onOpenStructure}
            className={cn(
              'px-2 py-0.5 rounded text-[11px] flex items-center gap-1 transition-colors cursor-pointer shrink-0 font-medium',
              pillClass
            )}
            title={`View schema structure for ${activeTableName}`}
          >
            <span>Structure</span>
            <ExternalLink className="w-2.5 h-2.5 stroke-[2.5]" />
          </button>
        )}

        {/* Row count / Unknown badge */}
        <div className="hidden sm:flex items-center gap-1 text-[11px] opacity-80 shrink-0">
          <Hash className="w-3 h-3 stroke-[2.5]" />
          <span>{rowCount > 0 ? `${rowCount.toLocaleString('en-US')} rows` : 'Unknown'}</span>
        </div>

        {/* History / Sync relative time */}
        <div className="hidden md:flex items-center gap-1 text-[11px] opacity-80 shrink-0">
          <Clock className="w-3 h-3 stroke-[2.5]" />
          <span>{lastActiveTime}</span>
        </div>
      </div>

      {/* =========================================================================
          CENTER / RIGHT SECTION: Pagination & Toolbar Controls
      ========================================================================== */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Pagination Box: |< < [ 1 ] / 5 > >| */}
        <div className="flex items-center gap-0.5">
          {/* First Page */}
          <button
            onClick={() => onPageChange?.(1)}
            disabled={currentPage <= 1 || !onPageChange}
            className={cn(
              'p-1 rounded cursor-pointer transition-colors',
              pillClass,
              (currentPage <= 1 || !onPageChange) && 'opacity-35 cursor-not-allowed hover:bg-transparent'
            )}
            title="First page"
          >
            <ChevronsLeft className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>

          {/* Previous Page */}
          <button
            onClick={() => onPageChange?.(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1 || !onPageChange}
            className={cn(
              'p-1 rounded cursor-pointer transition-colors',
              pillClass,
              (currentPage <= 1 || !onPageChange) && 'opacity-35 cursor-not-allowed hover:bg-transparent'
            )}
            title="Previous page"
          >
            <ChevronLeft className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>

          {/* Page input & of totalPages */}
          <div className="flex items-center gap-1 mx-0.5">
            <input
              type="text"
              value={pageInput}
              onChange={e => setPageInput(e.target.value)}
              onKeyDown={handlePageSubmit}
              onBlur={handlePageBlur}
              className={cn(
                'w-8 h-5.5 text-center text-[11px] font-bold rounded border focus:outline-none transition-colors tabular-nums',
                inputClass
              )}
            />
            <span className="text-[11px] opacity-75 font-mono select-none">
              / {totalPages}
            </span>
          </div>

          {/* Next Page */}
          <button
            onClick={() => onPageChange?.(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages || !onPageChange}
            className={cn(
              'p-1 rounded cursor-pointer transition-colors',
              pillClass,
              (currentPage >= totalPages || !onPageChange) && 'opacity-35 cursor-not-allowed hover:bg-transparent'
            )}
            title="Next page"
          >
            <ChevronRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>

          {/* Last Page */}
          <button
            onClick={() => onPageChange?.(totalPages)}
            disabled={currentPage >= totalPages || !onPageChange}
            className={cn(
              'p-1 rounded cursor-pointer transition-colors',
              pillClass,
              (currentPage >= totalPages || !onPageChange) && 'opacity-35 cursor-not-allowed hover:bg-transparent'
            )}
            title="Last page"
          >
            <ChevronsRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>

        {/* Editing Status Badge (ⓘ Editing Disabled / Enabled toggle) */}
        <button
          onClick={onToggleEditing}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer',
            isEditingEnabled
              ? (isLight ? 'bg-emerald-600/30 text-emerald-950 font-bold border border-emerald-700/40' : 'bg-emerald-500/25 text-emerald-300 font-bold border border-emerald-500/40')
              : pillClass
          )}
          title={
            connection.is_readonly
              ? 'Connection is in Read Only mode'
              : isEditingEnabled
              ? 'Editing Enabled: Double-click any cell to edit value'
              : 'Click to enable editing mode (Double-click cells to edit)'
          }
        >
          <Info className="w-3 h-3 stroke-[2.5]" />
          <span>
            {connection.is_readonly
              ? 'Read Only'
              : isEditingEnabled
              ? 'Editing Enabled'
              : 'Editing Disabled'}
          </span>
        </button>

        {/* Refresh Table Data Button */}
        <button
          onClick={handleRefreshClick}
          className={cn('p-1 rounded cursor-pointer transition-colors', pillClass)}
          title="Refresh data"
        >
          <RefreshCw className={cn('w-3 h-3 stroke-[2.5] transition-transform', isRefreshing && 'animate-spin')} />
        </button>

        {/* Add Row Button */}
        <button
          onClick={onNewRow}
          className={cn('p-1 rounded cursor-pointer transition-colors', pillClass)}
          title="Add new row / record"
        >
          <Plus className="w-3 h-3 stroke-[2.5]" />
        </button>

        {/* Settings Gear with Caret (Exact match from screenshot) */}
        <div className="relative">
          <button
            onClick={() => setShowSettingsMenu(!showSettingsMenu)}
            className={cn('p-1 rounded cursor-pointer transition-colors flex items-center gap-0.5', pillClass)}
            title="Table & Connection Options"
          >
            <Settings className="w-3 h-3 stroke-[2.5]" />
            <span className="text-[9px] leading-none">▼</span>
          </button>

          {/* Settings Dropdown Menu */}
          {showSettingsMenu && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setShowSettingsMenu(false)}
              />
              <div
                onClick={() => setShowSettingsMenu(false)}
                className="absolute right-0 bottom-8 z-40 w-48 rounded-md bg-zinc-900 border border-zinc-700 shadow-2xl py-1 text-xs text-zinc-200 select-none animate-in fade-in-50 zoom-in-95"
              >
                <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase font-mono border-b border-zinc-800">
                  {connection.name} ({connection.driver})
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${connection.driver}://${connection.username || 'user'}@${connection.host}:${connection.port}/${connection.default_database}`);
                    success('Copied URI', 'Database URI copied to clipboard');
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Copy Connection URI
                </button>
                <button
                  onClick={() => {
                    info('Connection Info', `Host: ${connection.host}:${connection.port} | SSL: ${connection.ssl ? 'Enabled' : 'Disabled'}`);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Connection Details
                </button>
                {onDisconnect && (
                  <>
                    <div className="border-t border-zinc-800 my-1" />
                    <button
                      onClick={() => {
                        onDisconnect();
                      }}
                      className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer flex items-center justify-between"
                    >
                      <span>Disconnect</span>
                      <span className="text-[10px] text-zinc-500 font-mono">Ctrl+Shift+Q</span>
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
