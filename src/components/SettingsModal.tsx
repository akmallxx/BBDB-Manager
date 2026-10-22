import React, { useState, useEffect } from 'react';
import { 
  X, 
  Settings, 
  Sliders, 
  Database, 
  Terminal, 
  HardDrive, 
  Sun, 
  Moon, 
  Check, 
  Trash2, 
  RefreshCw,
  ShieldAlert,
  Keyboard,
  RotateCcw,
  AlertTriangle
} from 'lucide-react';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Select } from './ui/select';
import { cn } from '../lib/utils';
import { useToast } from './ui/toast';
import { SettingsInfo, ShortcutActionId, ShortcutMap } from '../types/database';
import { 
  DEFAULT_SHORTCUTS, 
  DEFAULT_SHORTCUT_MAP, 
  formatShortcutKeys, 
  parseKeyboardEventToCombo 
} from '../lib/shortcuts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: 'dark' | 'light';
  onThemeChange: (theme: 'dark' | 'light') => void;
  currentAutocommit: boolean;
  onAutocommitChange: (autocommit: boolean) => void;
  onSettingsUpdated?: () => void;
  onClearHistory?: () => void;
}

type SettingsSection = 'appearance' | 'database' | 'terminal' | 'shortcuts' | 'storage';

export function SettingsModal({
  isOpen,
  onClose,
  currentTheme,
  onThemeChange,
  currentAutocommit,
  onAutocommitChange,
  onSettingsUpdated,
  onClearHistory
}: SettingsModalProps) {
  const { success, error, info: toastInfo } = useToast();
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance');

  // Form states
  const [theme, setTheme] = useState<'dark' | 'light'>(currentTheme);
  const [fontSize, setFontSize] = useState<number>(13);
  const [autocommitDefault, setAutocommitDefault] = useState<boolean>(currentAutocommit);
  const [defaultQueryLimit, setDefaultQueryLimit] = useState<number>(50);
  const [confirmDestructive, setConfirmDestructive] = useState<boolean>(true);
  const [terminalFontSize, setTerminalFontSize] = useState<number>(13);
  const [terminalCursorStyle, setTerminalCursorStyle] = useState<'block' | 'underline' | 'bar'>('block');
  const [sftpShowHidden, setSftpShowHidden] = useState<boolean>(false);

  // Keyboard Shortcuts state
  const [shortcuts, setShortcuts] = useState<ShortcutMap>({ ...DEFAULT_SHORTCUT_MAP });
  const [recordingActionId, setRecordingActionId] = useState<ShortcutActionId | null>(null);

  // Storage / System Info
  const [settingsInfo, setSettingsInfo] = useState<SettingsInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Collision detection helper
  const getShortcutConflict = (id: ShortcutActionId, combo: string) => {
    if (!combo) return null;
    const conflict = DEFAULT_SHORTCUTS.find(
      s => s.id !== id && (shortcuts[s.id] || s.defaultKey).toLowerCase() === combo.toLowerCase()
    );
    return conflict ? conflict.name : null;
  };

  // Sync props when opened
  useEffect(() => {
    if (isOpen) {
      setTheme(currentTheme);
      setAutocommitDefault(currentAutocommit);
      loadSettings();
      loadSystemInfo();
    }
  }, [isOpen, currentTheme, currentAutocommit]);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.theme) setTheme(data.theme === 'light' ? 'light' : 'dark');
        if (data.fontSize) setFontSize(parseInt(data.fontSize, 10) || 13);
        if (data.autocommitDefault !== undefined) setAutocommitDefault(data.autocommitDefault === 'true');
        if (data.defaultQueryLimit) setDefaultQueryLimit(parseInt(data.defaultQueryLimit, 10) || 50);
        if (data.confirmDestructiveQueries !== undefined) setConfirmDestructive(data.confirmDestructiveQueries === 'true');
        if (data.terminalFontSize) setTerminalFontSize(parseInt(data.terminalFontSize, 10) || 13);
        if (data.terminalCursorStyle) setTerminalCursorStyle(data.terminalCursorStyle as any);
        if (data.sftpShowHidden !== undefined) setSftpShowHidden(data.sftpShowHidden === 'true');
        if (data.custom_shortcuts) {
          try {
            const parsed = typeof data.custom_shortcuts === 'string' ? JSON.parse(data.custom_shortcuts) : data.custom_shortcuts;
            setShortcuts({ ...DEFAULT_SHORTCUT_MAP, ...parsed });
          } catch (err) {
            console.warn('Failed to parse custom_shortcuts from SQLite:', err);
          }
        } else {
          setShortcuts({ ...DEFAULT_SHORTCUT_MAP });
        }
      }
    } catch (err) {
      console.warn('Failed to fetch settings from SQLite:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadSystemInfo = async () => {
    try {
      const res = await fetch('/api/settings/info');
      if (res.ok) {
        const infoData = await res.json();
        setSettingsInfo(infoData);
      }
    } catch {
      // ignore
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload: Record<string, string> = {
        theme,
        fontSize: String(fontSize),
        autocommitDefault: String(autocommitDefault),
        defaultQueryLimit: String(defaultQueryLimit),
        confirmDestructiveQueries: String(confirmDestructive),
        terminalFontSize: String(terminalFontSize),
        terminalCursorStyle,
        sftpShowHidden: String(sftpShowHidden),
        custom_shortcuts: JSON.stringify(shortcuts)
      };

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        onThemeChange(theme);
        onAutocommitChange(autocommitDefault);
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
        if (onSettingsUpdated) {
          onSettingsUpdated();
        }
        success('Settings Saved', 'Preferences have been persisted to SQLite.');
        onClose();
      } else {
        error('Save Failed', 'Failed to save settings to server.');
      }
    } catch (err) {
      error('Save Failed', err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefaults = () => {
    if (!confirm('Reset all settings to default values?')) return;
    setTheme('dark');
    setFontSize(13);
    setAutocommitDefault(true);
    setDefaultQueryLimit(50);
    setConfirmDestructive(true);
    setTerminalFontSize(13);
    setTerminalCursorStyle('block');
    setSftpShowHidden(false);
    setShortcuts({ ...DEFAULT_SHORTCUT_MAP });
    setRecordingActionId(null);
    toastInfo('Defaults Applied', 'Click "Save Changes" to apply and persist defaults.');
  };

  const handleClearQueryHistory = async () => {
    if (!confirm('Are you sure you want to clear all query history? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/history', { method: 'DELETE' });
      if (res.ok) {
        success('History Cleared', 'Query history table emptied in SQLite.');
        loadSystemInfo();
        if (onClearHistory) onClearHistory();
      } else {
        const data = await res.json().catch(() => ({}));
        error('Clear Failed', data.error || 'Failed to clear query history.');
      }
    } catch (err) {
      error('Clear Failed', err instanceof Error ? err.message : 'Network error');
    }
  };

  // Listen for keypress when actively recording a shortcut
  useEffect(() => {
    if (!recordingActionId) return;

    const handleRecordKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecordingActionId(null);
        return;
      }

      const combo = parseKeyboardEventToCombo(e);
      if (combo) {
        setShortcuts(prev => ({
          ...prev,
          [recordingActionId]: combo
        }));
        setRecordingActionId(null);
      }
    };

    window.addEventListener('keydown', handleRecordKeyDown, true);
    return () => window.removeEventListener('keydown', handleRecordKeyDown, true);
  }, [recordingActionId]);

  // Close on Escape key (guarded if actively recording a shortcut)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (recordingActionId) {
          setRecordingActionId(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, recordingActionId]);

  if (!isOpen) return null;

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in-50 cursor-pointer"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-zinc-700/80 rounded-xl w-full max-w-3xl shadow-2xl flex flex-col h-[600px] max-h-[90vh] overflow-hidden animate-in zoom-in-95 text-zinc-100 cursor-default"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-yellow-400/15 border border-yellow-400/30 flex items-center justify-center text-yellow-400">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 id="settings-modal-title" className="text-sm font-bold text-zinc-100 tracking-tight">
                Studio Settings & Preferences
              </h2>
              <p className="text-[11px] text-zinc-400">
                Managed centrally via SQLite (<code className="font-mono text-zinc-300">app_settings</code>)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Settings"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Close Settings (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: Left Section Nav + Right Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Section Nav */}
          <div className="w-48 border-r border-zinc-800 bg-zinc-950/40 p-2 space-y-1 shrink-0">
            <button
              onClick={() => setActiveSection('appearance')}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer',
                activeSection === 'appearance'
                  ? 'bg-yellow-400/15 text-yellow-400 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              )}
            >
              <Sliders className="w-4 h-4" />
              <span>Appearance</span>
            </button>

            <button
              onClick={() => setActiveSection('database')}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer',
                activeSection === 'database'
                  ? 'bg-yellow-400/15 text-yellow-400 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              )}
            >
              <Database className="w-4 h-4" />
              <span>Database & SQL</span>
            </button>

            <button
              onClick={() => setActiveSection('terminal')}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer',
                activeSection === 'terminal'
                  ? 'bg-yellow-400/15 text-yellow-400 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              )}
            >
              <Terminal className="w-4 h-4" />
              <span>Terminal & SFTP</span>
            </button>

            <button
              onClick={() => {
                setRecordingActionId(null);
                setActiveSection('shortcuts');
              }}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer',
                activeSection === 'shortcuts'
                  ? 'bg-yellow-400/15 text-yellow-400 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              )}
            >
              <Keyboard className="w-4 h-4" />
              <span>Shortcuts</span>
            </button>

            <button
              onClick={() => {
                setRecordingActionId(null);
                setActiveSection('storage');
              }}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer',
                activeSection === 'storage'
                  ? 'bg-yellow-400/15 text-yellow-400 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              )}
            >
              <HardDrive className="w-4 h-4" />
              <span>Storage & SQLite</span>
            </button>
          </div>

          {/* Section Content Area */}
          <div className="flex-1 p-5 overflow-y-auto space-y-5 bg-zinc-900/60">
            {/* 1. APPEARANCE SECTION */}
            {activeSection === 'appearance' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Theme & Color Mode
                  </h3>
                  <p className="text-xs text-zinc-400 mb-3">
                    Choose the visual presentation for database studio surfaces.
                  </p>
                  <div className="grid grid-cols-2 gap-3 max-w-md">
                    <button
                      type="button"
                      onClick={() => setTheme('dark')}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border text-left transition-all cursor-pointer',
                        theme === 'dark'
                          ? 'border-yellow-400 bg-zinc-800 shadow-xs'
                          : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
                      )}
                    >
                      <div className="w-7 h-7 rounded-md bg-zinc-900 flex items-center justify-center text-zinc-200">
                        <Moon className="w-4 h-4 text-yellow-400" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-200">Dark Mode</div>
                        <div className="text-[10px] text-zinc-500">Default dark studio palette</div>
                      </div>
                      {theme === 'dark' && <Check className="w-4 h-4 text-yellow-400 ml-auto" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => setTheme('light')}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border text-left transition-all cursor-pointer',
                        theme === 'light'
                          ? 'border-yellow-400 bg-zinc-800 shadow-xs'
                          : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
                      )}
                    >
                      <div className="w-7 h-7 rounded-md bg-zinc-200 flex items-center justify-center text-zinc-900">
                        <Sun className="w-4 h-4 text-amber-500" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-200">Light Mode</div>
                        <div className="text-[10px] text-zinc-500">Clean bright background</div>
                      </div>
                      {theme === 'light' && <Check className="w-4 h-4 text-yellow-400 ml-auto" />}
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-800/80">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Interface Font Size
                  </h3>
                  <p className="text-xs text-zinc-400 mb-3">
                    Controls font size across SQL editor, data tables, and sidebar trees.
                  </p>
                  <div className="flex items-center gap-3 max-w-xs">
                    <Select
                      aria-label="Interface Font Size"
                      value={String(fontSize)}
                      onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                      sizeVariant="sm"
                    >
                      <option value="11">11px - Compact</option>
                      <option value="12">12px - Small</option>
                      <option value="13">13px - Standard (Default)</option>
                      <option value="14">14px - Medium</option>
                      <option value="15">15px - Large</option>
                      <option value="16">16px - Extra Large</option>
                    </Select>
                    <span className="text-xs text-zinc-400 shrink-0">Current: {fontSize}px</span>
                  </div>
                </div>
              </div>
            )}

            {/* 2. DATABASE & SQL SECTION */}
            {activeSection === 'database' && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/50">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-zinc-200">Default Autocommit Mode</div>
                    <div className="text-[11px] text-zinc-400 max-w-md">
                      When enabled, queries commit automatically. When disabled, queries require explicit manual commit or rollback in the transaction toolbar.
                    </div>
                  </div>
                  <Switch
                    aria-label="Default Autocommit Mode"
                    checked={autocommitDefault}
                    onCheckedChange={setAutocommitDefault}
                  />
                </div>

                <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/50">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-zinc-200">Confirm Destructive Queries</div>
                    <div className="text-[11px] text-zinc-400 max-w-md">
                      Show an interactive confirmation prompt when executing destructive SQL statements such as DROP TABLE, TRUNCATE, or DELETE without a WHERE clause.
                    </div>
                  </div>
                  <Switch
                    aria-label="Confirm Destructive Queries"
                    checked={confirmDestructive}
                    onCheckedChange={setConfirmDestructive}
                  />
                </div>

                <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/50 space-y-2">
                  <div className="text-xs font-semibold text-zinc-200">Default Query Results Page Size</div>
                  <div className="text-[11px] text-zinc-400">
                    Max rows returned per page in the Table Data browser.
                  </div>
                  <div className="max-w-xs pt-1">
                    <Select
                      aria-label="Default Query Results Page Size"
                      value={String(defaultQueryLimit)}
                      onChange={(e) => setDefaultQueryLimit(parseInt(e.target.value, 10))}
                      sizeVariant="sm"
                    >
                      <option value="25">25 rows</option>
                      <option value="50">50 rows (Default)</option>
                      <option value="100">100 rows</option>
                      <option value="200">200 rows</option>
                      <option value="500">500 rows</option>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* 3. TERMINAL & SFTP SECTION */}
            {activeSection === 'terminal' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/50 space-y-2">
                  <div className="text-xs font-semibold text-zinc-200">Terminal Font Size</div>
                  <div className="text-[11px] text-zinc-400">
                    Monospace text size for the interactive xterm.js SSH terminal.
                  </div>
                  <div className="max-w-xs pt-1">
                    <Select
                      aria-label="Terminal Font Size"
                      value={String(terminalFontSize)}
                      onChange={(e) => setTerminalFontSize(parseInt(e.target.value, 10))}
                      sizeVariant="sm"
                    >
                      <option value="11">11px</option>
                      <option value="12">12px</option>
                      <option value="13">13px (Default)</option>
                      <option value="14">14px</option>
                      <option value="16">16px</option>
                      <option value="18">18px</option>
                    </Select>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/50 space-y-2">
                  <div className="text-xs font-semibold text-zinc-200">Terminal Cursor Style</div>
                  <div className="text-[11px] text-zinc-400">
                    Visual appearance of the active terminal prompt cursor.
                  </div>
                  <div className="max-w-xs pt-1">
                    <Select
                      aria-label="Terminal Cursor Style"
                      value={terminalCursorStyle}
                      onChange={(e) => setTerminalCursorStyle(e.target.value as any)}
                      sizeVariant="sm"
                    >
                      <option value="block">Block (Default)</option>
                      <option value="underline">Underline</option>
                      <option value="bar">Vertical Bar</option>
                    </Select>
                  </div>
                </div>

                <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/50">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-zinc-200">Show Hidden Files in SFTP</div>
                    <div className="text-[11px] text-zinc-400 max-w-md">
                      Display hidden files and dotfiles (e.g. <code className="font-mono text-zinc-300">.env</code>, <code className="font-mono text-zinc-300">.bashrc</code>) by default in SFTP remote explorer.
                    </div>
                  </div>
                  <Switch
                    aria-label="Show Hidden Files in SFTP"
                    checked={sftpShowHidden}
                    onCheckedChange={setSftpShowHidden}
                  />
                </div>
              </div>
            )}

            {/* 4. KEYBOARD SHORTCUTS SECTION */}
            {activeSection === 'shortcuts' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                      Keyboard Shortcuts
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Click any key combination to record a new shortcut directly from your keyboard.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShortcuts({ ...DEFAULT_SHORTCUT_MAP });
                      setRecordingActionId(null);
                      toastInfo('Shortcuts Reset', 'All shortcuts reverted to factory defaults.');
                    }}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset All</span>
                  </Button>
                </div>

                {/* Group by Categories */}
                {(['Workspace', 'Navigation', 'Database', 'Remote'] as const).map(category => {
                  const items = DEFAULT_SHORTCUTS.filter(s => s.category === category);
                  if (items.length === 0) return null;

                  return (
                    <div key={category} className="space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 px-1">
                        {category}
                      </div>

                      <div className="space-y-1.5">
                        {items.map(item => {
                          const currentCombo = shortcuts[item.id] || item.defaultKey;
                          const isRecording = recordingActionId === item.id;
                          const conflictName = getShortcutConflict(item.id, currentCombo);
                          const isModified = currentCombo.toLowerCase() !== item.defaultKey.toLowerCase();
                          const keyBadges = formatShortcutKeys(currentCombo);

                          return (
                            <div
                              key={item.id}
                              className={cn(
                                'flex items-center justify-between gap-4 p-2.5 rounded-lg border transition-all',
                                isRecording
                                  ? 'border-yellow-400/80 bg-yellow-400/10'
                                  : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700/80'
                              )}
                            >
                              <div className="space-y-0.5 min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-zinc-200">
                                    {item.name}
                                  </span>
                                  {conflictName && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-500 border border-amber-500/30">
                                      <AlertTriangle className="w-3 h-3" />
                                      <span>Conflict with {conflictName}</span>
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-zinc-400 truncate">
                                  {item.description}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {isRecording ? (
                                  <button
                                    type="button"
                                    onClick={() => setRecordingActionId(null)}
                                    className="px-2.5 py-1 text-xs rounded bg-yellow-400 text-slate-950 font-bold font-mono border border-yellow-300 shadow-xs animate-pulse flex items-center gap-1.5 cursor-pointer"
                                  >
                                    <span>Press keys... (Esc to cancel)</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setRecordingActionId(item.id)}
                                    title="Click to record new shortcut"
                                    className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs transition-colors cursor-pointer group"
                                  >
                                    {keyBadges.map((badge, idx) => (
                                      <kbd
                                        key={idx}
                                        className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-700/80 text-[11px] font-semibold text-zinc-200 font-mono shadow-xs"
                                      >
                                        {badge}
                                      </kbd>
                                    ))}
                                    <span className="text-[10px] text-zinc-400 group-hover:text-yellow-400 ml-1 transition-colors">
                                      Edit
                                    </span>
                                  </button>
                                )}

                                {isModified && (
                                  <button
                                    type="button"
                                    title={`Reset to default (${item.defaultKey})`}
                                    onClick={() => {
                                      setShortcuts(prev => ({
                                        ...prev,
                                        [item.id]: item.defaultKey
                                      }));
                                    }}
                                    className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 5. STORAGE & SQLITE SECTION */}
            {activeSection === 'storage' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-200">SQLite Database Storage</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Connected
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Location: <code className="font-mono text-zinc-300 break-all select-all">{settingsInfo?.dbPath || 'data/database-studio.sqlite'}</code>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2">
                    <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800 text-center">
                      <div className="text-lg font-bold text-yellow-400 font-mono">
                        {settingsInfo?.connectionsCount ?? '...'}
                      </div>
                      <div className="text-[10px] text-zinc-400">Saved Connections</div>
                    </div>
                    <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800 text-center">
                      <div className="text-lg font-bold text-sky-400 font-mono">
                        {settingsInfo?.historyCount ?? '...'}
                      </div>
                      <div className="text-[10px] text-zinc-400">Query History Rows</div>
                    </div>
                    <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800 text-center">
                      <div className="text-lg font-bold text-emerald-400 font-mono">
                        {settingsInfo?.snippetsCount ?? '...'}
                      </div>
                      <div className="text-[10px] text-zinc-400">Terminal Snippets</div>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-red-950/60 bg-red-950/20 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-400">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Database Maintenance</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Safely clear query history table to reclaim space while preserving your saved database and SSH connections intact.
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleClearQueryHistory}
                    className="flex items-center gap-1.5 cursor-pointer mt-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Query History ({settingsInfo?.historyCount || 0} rows)</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800 bg-zinc-950/80 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResetDefaults}
            className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
          >
            Reset Defaults
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSaving}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="yellow"
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 cursor-pointer"
            >
              {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Save Changes</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
