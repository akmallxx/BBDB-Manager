import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  Terminal as TerminalIcon,
  RefreshCw,
  Trash2,
  ZoomIn,
  ZoomOut,
  FolderTree,
  Copy,
  Clipboard,
  ShieldCheck,
  AlertCircle,
  Wifi,
  WifiOff,
  Sparkles,
} from 'lucide-react';
import { Button } from '../ui/button';
import { DatabaseConnection, SshConfigParams } from '../../types/database';
import { cn } from '../../lib/utils';
import { SnippetsView } from './SnippetsView';

interface SshTerminalViewProps {
  tabId: string;
  isActive?: boolean;
  connectionId?: string;
  connection?: DatabaseConnection | null;
  sshConfig?: SshConfigParams;
  onOpenSftpTab?: (connectionId?: string, config?: SshConfigParams, path?: string) => void;
  onRunSnippet?: (command: string, autoExecute: boolean) => void;
  terminalFontSize?: number;
  terminalCursorStyle?: 'block' | 'underline' | 'bar';
  theme?: 'dark' | 'light';
}

const xtermDarkTheme = {
  background: '#09090b',
  foreground: '#f4f4f5',
  cursor: '#facc15',
  cursorAccent: '#09090b',
  selectionBackground: 'rgba(250, 204, 21, 0.25)',
  black: '#18181b',
  red: '#ef4444',
  green: '#10b981',
  yellow: '#facc15',
  blue: '#3b82f6',
  magenta: '#d946ef',
  cyan: '#06b6d4',
  white: '#f4f4f5',
  brightBlack: '#71717a',
  brightRed: '#f87171',
  brightGreen: '#34d399',
  brightYellow: '#fde047',
  brightBlue: '#60a5fa',
  brightMagenta: '#e879f9',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};

const xtermLightTheme = {
  background: '#ffffff',
  foreground: '#0f172a',
  cursor: '#ca8a04',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(202, 138, 4, 0.25)',
  black: '#0f172a',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#c026d3',
  cyan: '#0891b2',
  white: '#f8fafc',
  brightBlack: '#64748b',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#d946ef',
  brightCyan: '#06b6d4',
  brightWhite: '#0f172a',
};

export const SshTerminalView: React.FC<SshTerminalViewProps> = ({
  tabId,
  isActive = true,
  connectionId,
  connection,
  sshConfig,
  onOpenSftpTab,
  onRunSnippet,
  terminalFontSize = 13,
  terminalCursorStyle = 'block',
  theme = 'dark',
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onDataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const onResizeDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSnippetRef = useRef<{ command: string; autoExecute: boolean } | null>(null);
  const isManualDisconnectRef = useRef(false);

  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [statusMessage, setStatusMessage] = useState<string>('Initializing terminal...');
  const [fontSize, setFontSize] = useState<number>(terminalFontSize || 13);

  // Sync terminalFontSize prop if changed externally
  useEffect(() => {
    if (terminalFontSize) {
      setFontSize(terminalFontSize);
    }
  }, [terminalFontSize]);

  // Sync terminalCursorStyle prop if changed externally
  useEffect(() => {
    if (xtermRef.current && terminalCursorStyle) {
      xtermRef.current.options.cursorStyle = terminalCursorStyle;
    }
  }, [terminalCursorStyle]);

  // Sync xterm theme when application theme switches
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = theme === 'light' ? xtermLightTheme : xtermDarkTheme;
    }
  }, [theme]);
  const [isSnippetsOpen, setIsSnippetsOpen] = useState(false);
  const [reconnectCountdown, setReconnectCountdown] = useState<number | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const maxReconnectAttempts = 5;

  // Compute active SSH configuration from props
  const resolvedConfig = useMemo(() => {
    if (sshConfig) return sshConfig;
    if (!connection) return null;
    const isSsh = connection.connection_mode === 'ssh' || connection.driver === 'ssh' || Boolean(connection.ssh_enabled);
    if (!isSsh) return null;

    return {
      host: connection.ssh_host || connection.host || '',
      port: connection.ssh_port || connection.port || 22,
      username: connection.ssh_user || connection.username || 'root',
      authMethod: (connection.ssh_auth_method === 'key' ? 'key' : 'password') as 'password' | 'key',
      password: connection.ssh_password || connection.password || '',
      keyFile: connection.ssh_key_file || '',
      passphrase: connection.ssh_key_passphrase || ''
    };
  }, [sshConfig, connection]);

  const hostDisplay = resolvedConfig
    ? `${resolvedConfig.username}@${resolvedConfig.host}:${resolvedConfig.port || 22}`
    : (connection?.name || 'Remote Host');

  const getWsUrl = useCallback(() => {
    const isTauri = typeof window !== 'undefined' && (
      window.location.protocol === 'tauri:' ||
      window.location.hostname.includes('tauri') ||
      Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
    );

    if (isTauri) {
      const apiPort = (window as any).__API_PORT__ || '39001';
      return `ws://127.0.0.1:${apiPort}/api/ssh/ws`;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/api/ssh/ws`;
  }, []);

  const cancelAutoReconnect = useCallback(() => {
    if (reconnectIntervalRef.current) {
      clearInterval(reconnectIntervalRef.current);
      reconnectIntervalRef.current = null;
    }
    setReconnectCountdown(null);
  }, []);

  const connectTerminal = useCallback((isReconnect = false) => {
    if (!terminalRef.current) return;

    // Reset manual disconnect flag
    isManualDisconnectRef.current = false;

    // Clean up ping interval
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    // Clean up any existing WebSocket instance
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }

    // If not a reconnect, dispose previous xterm instance
    if (!isReconnect && xtermRef.current) {
      try { xtermRef.current.dispose(); } catch {}
      xtermRef.current = null;
    }

    if (!connectionId && !resolvedConfig) {
      setStatus('disconnected');
      setStatusMessage('No SSH server selected. Please select a saved SSH server from the left sidebar.');
      return;
    }

    setStatus('connecting');
    setStatusMessage(isReconnect ? `Reconnecting to ${hostDisplay}...` : `Connecting to ${hostDisplay}...`);

    let term = xtermRef.current;
    let fitAddon = fitAddonRef.current;

    // Create xterm instance only if it doesn't already exist
    if (!term || !fitAddon) {
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: terminalCursorStyle || 'block',
        fontFamily: 'JetBrains Mono, Fira Code, Menlo, Consolas, monospace',
        fontSize,
        lineHeight: 1.25,
        theme: theme === 'light' ? xtermLightTheme : xtermDarkTheme,
        convertEol: true,
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.open(terminalRef.current);

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
    } else if (isReconnect) {
      term.write(`\r\n\x1b[33m[Connecting to ${hostDisplay}...]\x1b[0m\r\n`);
    }

    setTimeout(() => {
      try { fitAddonRef.current?.fit(); } catch {}
    }, 50);

    // Open WebSocket Connection
    const wsUrl = getWsUrl();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      try { fitAddon.fit(); } catch {}

      // Send handshake
      const handshake = {
        type: 'init',
        connectionId,
        config: resolvedConfig,
        cols: term.cols || 80,
        rows: term.rows || 24,
      };
      ws.send(JSON.stringify(handshake));

      // Setup Heartbeat / Keepalive Ping (Every 20 seconds)
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'stdout' && msg.data) {
          term.write(msg.data);
        } else if (msg.type === 'status') {
          if (msg.status === 'connected') {
            setStatus('connected');
            setStatusMessage(msg.message || 'Connected');
            setReconnectAttempt(0);
            cancelAutoReconnect();
            if (isReconnect) {
              term.write('\r\n\x1b[32m[SSH Session Reconnected]\x1b[0m\r\n');
            }
            term.focus();

            if (pendingSnippetRef.current) {
              const pending = pendingSnippetRef.current;
              pendingSnippetRef.current = null;
              const textToSend = pending.autoExecute ? `${pending.command}\r` : pending.command;
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'stdin', data: textToSend }));
                }
              }, 100);
            }
          } else if (msg.status === 'disconnected' || msg.status === 'closed') {
            setStatus('disconnected');
            setStatusMessage(msg.message || 'Session Closed');
            term.write('\r\n\x1b[33m[Connection closed by server]\x1b[0m\r\n');
          }
        } else if (msg.type === 'error') {
          setStatus('error');
          setStatusMessage(msg.message);
          term.write(`\r\n\x1b[31m[SSH Error: ${msg.message}]\x1b[0m\r\n`);
        } else if (msg.type === 'pong') {
          // Heartbeat acknowledged
        }
      } catch {
        // Direct raw string fallback
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      setStatus((prev) => (prev === 'error' ? 'error' : 'disconnected'));

      // Trigger auto-reconnect if not manual disconnect
      if (!isManualDisconnectRef.current && (connectionId || resolvedConfig)) {
        triggerAutoReconnect();
      }
    };

    ws.onerror = () => {
      setStatus('error');
      setStatusMessage('WebSocket connection error.');
    };

    onDataDisposableRef.current?.dispose();
    onResizeDisposableRef.current?.dispose();

    // Forward terminal keypresses to WebSocket
    onDataDisposableRef.current = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stdin', data }));
      }
    });

    // Handle terminal resize
    onResizeDisposableRef.current = term.onResize(({ cols, rows }) => {
      if (cols > 0 && rows > 0 && !isNaN(cols) && !isNaN(rows) && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });
  }, [connectionId, resolvedConfig, hostDisplay, getWsUrl, cancelAutoReconnect]);

  const triggerAutoReconnect = useCallback(() => {
    cancelAutoReconnect();
    if (isManualDisconnectRef.current) return;
    if (!connectionId && !resolvedConfig) return;

    setReconnectAttempt(prev => {
      const next = prev + 1;
      if (next > maxReconnectAttempts) {
        setStatusMessage('Auto-reconnect failed. Click Reconnect to try again.');
        xtermRef.current?.write('\r\n\x1b[31m[Auto-reconnect stopped after 5 failed attempts. Click Reconnect to retry.]\x1b[0m\r\n');
        return prev;
      }

      let seconds = Math.min(10, 3 + next * 2);
      setReconnectCountdown(seconds);
      xtermRef.current?.write(`\r\n\x1b[33m[Connection lost. Auto-reconnecting in ${seconds}s (attempt ${next}/${maxReconnectAttempts})...]\x1b[0m\r\n`);

      reconnectIntervalRef.current = setInterval(() => {
        seconds -= 1;
        if (seconds <= 0) {
          cancelAutoReconnect();
          connectTerminal(true);
        } else {
          setReconnectCountdown(seconds);
        }
      }, 1000);

      return next;
    });
  }, [cancelAutoReconnect, connectionId, resolvedConfig, connectTerminal]);

  const connectTerminalRef = useRef(connectTerminal);
  useEffect(() => {
    connectTerminalRef.current = connectTerminal;
  }, [connectTerminal]);

  // Initial connect & cleanup on unmount
  useEffect(() => {
    connectTerminalRef.current(false);

    const handleResize = () => {
      try { fitAddonRef.current?.fit(); } catch {}
    };

    window.addEventListener('resize', handleResize);
    return () => {
      isManualDisconnectRef.current = true;
      window.removeEventListener('resize', handleResize);
      cancelAutoReconnect();
      onDataDisposableRef.current?.dispose();
      onResizeDisposableRef.current?.dispose();
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        try { wsRef.current.close(); } catch {}
      }
      if (xtermRef.current) {
        try { xtermRef.current.dispose(); } catch {}
      }
    };
  }, [tabId, connectionId, cancelAutoReconnect]);

  // Re-fit and focus whenever tab becomes active
  useEffect(() => {
    if (isActive) {
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          xtermRef.current?.focus();
        } catch {}
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isActive]);

  // Adjust font size smoothly on state change without triggering session reconnect
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = fontSize;
      requestAnimationFrame(() => {
        try { fitAddonRef.current?.fit(); } catch {}
      });
    }
  }, [fontSize]);

  // Handle snippet execution dispatched from SnippetsView
  useEffect(() => {
    const handleRunSnippetEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{
        tabId?: string;
        command: string;
        autoExecute: boolean;
      }>;
      if (!customEvent.detail) return;
      const { tabId: targetTabId, command, autoExecute } = customEvent.detail;
      if (targetTabId && targetTabId !== tabId) return;
      if (!targetTabId && !isActive) return;

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && status === 'connected') {
        const textToSend = autoExecute ? `${command}\r` : command;
        wsRef.current.send(JSON.stringify({ type: 'stdin', data: textToSend }));
        xtermRef.current?.focus();
      } else {
        pendingSnippetRef.current = { command, autoExecute };
      }
    };

    window.addEventListener('bbdb:run-snippet', handleRunSnippetEvent);
    return () => {
      window.removeEventListener('bbdb:run-snippet', handleRunSnippetEvent);
    };
  }, [tabId, isActive, status]);

  const handleClear = () => {
    if (xtermRef.current) {
      xtermRef.current.clear();
      xtermRef.current.focus();
    }
  };

  const handleCopy = async () => {
    try {
      if (xtermRef.current && xtermRef.current.hasSelection()) {
        const selection = xtermRef.current.getSelection();
        await navigator.clipboard.writeText(selection);
      }
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  };

  const handlePaste = async () => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const text = await navigator.clipboard.readText();
        wsRef.current.send(JSON.stringify({ type: 'stdin', data: text }));
      }
    } catch (err) {
      console.warn('Clipboard read failed:', err);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden">
      {/* Top Toolbar */}
      <div className="h-10 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between px-3 select-none shrink-0 gap-2">
        {/* Left: Host Info & Status Badge */}
        <div className="flex items-center gap-2 min-w-0">
          <TerminalIcon className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-zinc-200 truncate">{hostDisplay}</span>

          {status === 'connecting' && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-amber-950/80 text-amber-400 border border-amber-800/60 font-medium">
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              Connecting
            </span>
          )}
          {status === 'disconnected' && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 font-medium">
              <WifiOff className="w-2.5 h-2.5" />
              Disconnected
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-rose-950/80 text-rose-400 border border-rose-800/60 font-medium" title={statusMessage}>
              <AlertCircle className="w-2.5 h-2.5" />
              Error
            </span>
          )}
        </div>

        {/* Right: Actions (SFTP switch, Zoom, Clear, Reconnect) */}
        <div className="flex items-center gap-1 shrink-0">

          {/* Copy / Paste */}
          <button
            onClick={handleCopy}
            title="Copy Selection"
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handlePaste}
            title="Paste Clipboard"
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <Clipboard className="w-3.5 h-3.5" />
          </button>

          {/* Zoom In / Out */}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFontSize(prev => Math.min(prev + 1, 24));
            }}
            title="Zoom In (Font Size)"
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFontSize(prev => Math.max(prev - 1, 9));
            }}
            title="Zoom Out (Font Size)"
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          {/* Clear screen */}
          <button
            type="button"
            onClick={handleClear}
            title="Clear Terminal"
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Reconnect */}
          <button
            type="button"
            onClick={() => {
              cancelAutoReconnect();
              connectTerminal(true);
            }}
            title="Reconnect Session"
            className="p-1.5 rounded text-zinc-400 hover:text-yellow-400 hover:bg-zinc-800 transition-colors ml-1 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* Terminal Snippets Toggle Button */}
          <button
            type="button"
            onClick={() => {
              setIsSnippetsOpen(prev => !prev);
              setTimeout(() => {
                try { fitAddonRef.current?.fit(); } catch {}
              }, 60);
            }}
            title={isSnippetsOpen ? "Hide Snippets Sidebar" : "Show Snippets Sidebar"}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors cursor-pointer ml-1",
              isSnippetsOpen
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            )}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Snippets</span>
          </button>
        </div>
      </div>

      {/* Main Content Area: Terminal Canvas + Collapsible Right Snippets Sidebar */}
      <div className="flex-1 flex flex-row min-h-0 overflow-hidden w-full h-full relative">
        {/* Terminal Canvas */}
        <div className="flex-1 w-full h-full p-2 bg-zinc-950 overflow-hidden relative">
          {/* Floating Auto-reconnect banner (Termius style) */}
          {reconnectCountdown !== null && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-lg bg-zinc-900/95 border border-neutral-800/50 text-xs shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                <span className="text-zinc-200">
                  Connection lost. Auto-reconnecting in <strong className="text-amber-400 font-mono">{reconnectCountdown}s</strong> (Attempt {reconnectAttempt}/{maxReconnectAttempts})
                </span>
              </div>
              <div className="flex items-center gap-1.5 ml-2">
                <button
                  type="button"
                  onClick={cancelAutoReconnect}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[11px] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div ref={terminalRef} className="w-full h-full select-text" />
          {!connectionId && !resolvedConfig && (
            <div className="absolute inset-0 bg-zinc-950/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-10">
              <TerminalIcon className="w-12 h-12 text-zinc-600 mb-3" />
              <h3 className="text-sm font-semibold text-zinc-200 mb-1">No SSH Connection Selected</h3>
              <p className="text-xs text-zinc-400 max-w-sm">
                Please select or configure an SSH connection from the left sidebar to start a terminal session.
              </p>
            </div>
          )}
        </div>

        {/* Right: Collapsible Snippets Drawer */}
        {isSnippetsOpen && (
          <div className="w-80 h-full border-l border-zinc-800 bg-zinc-900/95 flex flex-col shrink-0 z-20 shadow-xl animate-in slide-in-from-right-4 duration-150">
            <SnippetsView
              onRunSnippet={onRunSnippet}
              onClose={() => {
                setIsSnippetsOpen(false);
                setTimeout(() => {
                  try { fitAddonRef.current?.fit(); } catch {}
                }, 60);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
