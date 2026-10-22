import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DatabaseConnection, SchemaGroup, WorkspaceTab, QueryHistoryItem, ThemeConfig, SshConfigParams, ShortcutMap } from './types/database';
import { DEFAULT_SHORTCUT_MAP, isShortcutMatch } from './lib/shortcuts';
import { NavigationRail, RailView } from './components/NavigationRail';
import { SidebarDrawer } from './components/SidebarDrawer';
import { TabBar } from './components/TabBar';
import { ConnectionView } from './components/ConnectionView';
import { DataTableView } from './components/DataTableView';
import { SqlEditorView } from './components/SqlEditorView';
import { SshTerminalView } from './components/ssh/SshTerminalView';
import { SftpExplorerView } from './components/sftp/SftpExplorerView';
import { TransactionLogModal } from './components/TransactionLogModal';
import { SnippetVariableModal, SnippetVariable } from './components/ssh/SnippetVariableModal';
import { SettingsModal } from './components/SettingsModal';
import { ToastProvider, useToast } from './components/ui/toast';
import { APP_NAME } from './lib/config';
import { cn } from './lib/utils';

function AppContent() {
  const { success, error, info } = useToast();

  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  // Navigation rail view
  const [railView, setRailView] = useState<RailView>('connections');

  // Sidebar Width & Visibility State (persisted via localStorage)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('bbdb_sidebar_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 180 && parsed <= 800) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return 260;
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('bbdb_sidebar_open');
      if (saved !== null) {
        return saved === 'true';
      }
    } catch {
      // ignore
    }
    return true;
  });

  const [isResizing, setIsResizing] = useState(false);

  const setSidebarOpenState = useCallback((open: boolean) => {
    setIsSidebarOpen(open);
    try {
      localStorage.setItem('bbdb_sidebar_open', String(open));
    } catch {
      // ignore
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => {
      const next = !prev;
      try {
        localStorage.setItem('bbdb_sidebar_open', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const handleRailViewChange = useCallback((view: RailView) => {
    if (isSidebarOpen && railView === view) {
      setSidebarOpenState(false);
    } else {
      setRailView(view);
      setSidebarOpenState(true);
    }
  }, [isSidebarOpen, railView, setSidebarOpenState]);

  // Theme & App settings (persisted via SQLite)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [autocommitDefault, setAutocommitDefault] = useState(true);
  const [autocommit, setAutocommit] = useState(true);
  const [inTransaction, setInTransaction] = useState(false);
  const [isTransactionLogOpen, setIsTransactionLogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [appFontSize, setAppFontSize] = useState<number>(13);
  const [defaultQueryLimit, setDefaultQueryLimit] = useState<number>(50);
  const [confirmDestructiveQueries, setConfirmDestructiveQueries] = useState<boolean>(true);
  const [terminalFontSize, setTerminalFontSize] = useState<number>(13);
  const [terminalCursorStyle, setTerminalCursorStyle] = useState<'block' | 'underline' | 'bar'>('block');
  const [sftpShowHidden, setSftpShowHidden] = useState<boolean>(false);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>({ ...DEFAULT_SHORTCUT_MAP });

  // Connections (persisted via SQLite)
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>(undefined);
  const [activeConnection, setActiveConnection] = useState<DatabaseConnection | null>(null);
  const activeConnectionRef = useRef<DatabaseConnection | null>(null);
  activeConnectionRef.current = activeConnection;

  // Entities & Database Schemas
  const [activeDatabase, setActiveDatabase] = useState('');
  const [databasesList, setDatabasesList] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<SchemaGroup[]>([]);
  const [totalEntities, setTotalEntities] = useState(0);

  // Query History (persisted via SQLite)
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);

  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    {
      id: 'tab-conn-main',
      type: 'connection_form',
      title: 'New Connection',
      initialMode: 'database'
    }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-conn-main');
  const [queryCounter, setQueryCounter] = useState(1);

  // Snippet Template Variables Modal State
  const [snippetModal, setSnippetModal] = useState<{
    isOpen: boolean;
    rawCommand: string;
    variables: SnippetVariable[];
    autoExecute: boolean;
  }>({
    isOpen: false,
    rawCommand: '',
    variables: [],
    autoExecute: true,
  });

  // Context-aware Workspace Mode ('database' | 'ssh')
  const [workspaceMode, setWorkspaceMode] = useState<'database' | 'ssh'>('database');

  // Auto-sync workspaceMode with the active workspace tab
  useEffect(() => {
    const currentTab = tabs.find(t => t.id === activeTabId);
    if (!currentTab) return;

    if (currentTab.type === 'ssh_terminal' || currentTab.type === 'sftp_explorer') {
      setWorkspaceMode('ssh');
      if (railView === 'entities' || railView === 'history') {
        setRailView('connections');
      }
    } else if (currentTab.type === 'table_data' || currentTab.type === 'query_editor') {
      setWorkspaceMode('database');
    } else if (currentTab.type === 'connection_form') {
      if (currentTab.initialMode === 'ssh') {
        setWorkspaceMode('ssh');
        if (railView === 'entities' || railView === 'history') {
          setRailView('connections');
        }
      } else if (currentTab.initialMode === 'database') {
        setWorkspaceMode('database');
      }
    }
  }, [activeTabId, tabs, railView]);

  const handleWorkspaceModeChange = (mode: 'database' | 'ssh') => {
    setWorkspaceMode(mode);
    if (mode === 'ssh') {
      if (railView === 'entities' || railView === 'history') {
        setRailView('connections');
      }

      // 1. Check if an SSH tab already exists
      const existingSshTab = tabs.find(t =>
        t.type === 'ssh_terminal' ||
        t.type === 'sftp_explorer' ||
        (t.type === 'connection_form' && t.initialMode === 'ssh')
      );

      if (existingSshTab) {
        setActiveTabId(existingSshTab.id);
      } else {
        const newTabId = `tab-conn-new-${Date.now()}`;
        const newTab: WorkspaceTab = {
          id: newTabId,
          type: 'connection_form',
          title: 'New SSH Server',
          initialMode: 'ssh'
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTabId);
      }
    } else {
      // 2. Switching to Database mode
      const existingDbTab = tabs.find(t =>
        t.type === 'table_data' ||
        t.type === 'query_editor' ||
        (t.type === 'connection_form' && t.initialMode !== 'ssh')
      );

      if (existingDbTab) {
        setActiveTabId(existingDbTab.id);
        if (activeConnection && (existingDbTab.type === 'table_data' || existingDbTab.type === 'query_editor')) {
          setRailView('entities');
        }
      } else if (activeConnection) {
        setQueryCounter(prev => {
          const nextCount = prev + 1;
          const newTab: WorkspaceTab = {
            id: `tab-query-${Date.now()}`,
            type: 'query_editor',
            title: `Query #${nextCount}`,
            connectionId: activeConnection.id,
            queryText: 'SELECT current_database(), now();'
          };
          setTabs(p => [...p, newTab]);
          setActiveTabId(newTab.id);
          return nextCount;
        });
        setRailView('entities');
      } else {
        const newTabId = `tab-conn-new-${Date.now()}`;
        const newTab: WorkspaceTab = {
          id: newTabId,
          type: 'connection_form',
          title: 'New Connection',
          initialMode: 'database'
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTabId);
        setRailView('connections');
      }
    }
  };

  // 1. Load Settings (Theme, Autocommit, Fonts, Limits) from SQLite settings endpoint
  const loadTheme = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const settings = await res.json();
        const currentTheme = settings.theme || 'dark';
        setTheme(currentTheme === 'light' ? 'light' : 'dark');
        if (currentTheme === 'light') {
          document.documentElement.classList.remove('dark');
        } else {
          document.documentElement.classList.add('dark');
        }

        if (settings.fontSize) {
          const fs = parseInt(settings.fontSize, 10) || 13;
          setAppFontSize(fs);
          document.documentElement.style.setProperty('--app-font-size', `${fs}px`);
        }
        if (settings.defaultQueryLimit) {
          setDefaultQueryLimit(parseInt(settings.defaultQueryLimit, 10) || 50);
        }
        if (settings.confirmDestructiveQueries !== undefined) {
          setConfirmDestructiveQueries(settings.confirmDestructiveQueries === 'true');
        }
        if (settings.terminalFontSize) {
          setTerminalFontSize(parseInt(settings.terminalFontSize, 10) || 13);
        }
        if (settings.terminalCursorStyle) {
          setTerminalCursorStyle(settings.terminalCursorStyle as any);
        }
        if (settings.sftpShowHidden !== undefined) {
          setSftpShowHidden(settings.sftpShowHidden === 'true');
        }

        if (settings.autocommitDefault !== undefined) {
          const isAuto = settings.autocommitDefault === 'true';
          setAutocommitDefault(isAuto);
          if (activeConnectionRef.current?.environment !== 'production') {
            setAutocommit(isAuto);
          }
        }

        if (settings.custom_shortcuts) {
          try {
            const parsed = typeof settings.custom_shortcuts === 'string' ? JSON.parse(settings.custom_shortcuts) : settings.custom_shortcuts;
            setShortcuts(prev => ({ ...prev, ...parsed }));
          } catch (err) {
            console.warn('Failed to parse custom_shortcuts from SQLite:', err);
          }
        }
      }
    } catch {
      // Default to dark mode
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = async () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    try {
      await fetch('/api/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: nextTheme })
      });
    } catch {
      console.warn('Failed to save theme to SQLite settings');
    }
  };

  // 2. Load Connections from SQLite endpoint
  const loadConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/connections');
      if (res.ok) {
        const data: DatabaseConnection[] = await res.json();
        setConnections(data);
      }
    } catch {
      error('Load Error', 'Failed to fetch saved connections from SQLite database.');
    }
  }, [error]);

  // 3. Load Query History from SQLite endpoint
  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data: QueryHistoryItem[] = await res.json();
        setHistory(data);
      }
    } catch {
      console.warn('Failed to fetch query history');
    }
  }, []);

  // Initial Load
  useEffect(() => {
    loadTheme();
    loadConnections();
    loadHistory();
  }, [loadTheme, loadConnections, loadHistory]);

  // 4. Fetch Schemas for Active Connection & Database
  const fetchSchemas = useCallback(async (connId: string, dbName: string) => {
    try {
      const res = await fetch(`/api/connections/${connId}/schemas?database=${encodeURIComponent(dbName)}`);
      if (res.ok) {
        const data = await res.json();
        setSchemas(data.schemas || []);
        setTotalEntities(data.totalEntities || 0);
      }
    } catch {
      console.warn('Failed to fetch database schemas');
    }
  }, []);

  // 5. Disconnect from active connection
  const handleDisconnect = useCallback(() => {
    if (!activeConnection) {
      info('Not Connected', 'No active database connection to disconnect.');
      return;
    }
    const name = activeConnection.name;
    setActiveConnection(null);
    setSelectedConnectionId(undefined);
    setSchemas([]);
    setDatabasesList([]);
    setActiveDatabase('');
    setInTransaction(false);

    // Reset workspace tabs to clean "New Connection" tab
    const newTab: WorkspaceTab = {
      id: 'tab-conn-main',
      type: 'connection_form',
      title: 'New Connection',
      initialMode: 'database'
    };
    setTabs([newTab]);
    setActiveTabId(newTab.id);
    setRailView('connections');
    success('Disconnected', `Disconnected from ${name}. (Shortcut: Ctrl+Shift+Q)`);
  }, [activeConnection, info, success]);



  // 6. Connect to a database
  const handleConnect = async (conn: DatabaseConnection) => {
    if (conn.connection_mode === 'ssh' || conn.driver === 'ssh') {
      handleOpenSshTab(conn.id);
      return;
    }
    setActiveConnection(conn);
    setSelectedConnectionId(conn.id);
    const defaultFallback = conn.driver === 'sqlite' ? 'main' : conn.driver === 'sqlserver' ? 'master' : conn.driver === 'mysql' ? '' : 'postgres';
    let targetDb = conn.default_database || defaultFallback;
    setActiveDatabase(targetDb);

    // Save/persist connection so backend SQLite has the latest credentials and environment
    await handleSaveConnection(conn);

    // If production, disable autocommit and require manual commit
    if (conn.environment === 'production') {
      setAutocommit(false);
      info(
        'Production Protection Active',
        'Autocommit is disabled for production connections. All mutations require manual Commit and can be Rolled back.'
      );
    } else {
      setAutocommit(autocommitDefault);
    }

    try {
      // Get databases list
      let activeDb = targetDb;
      const dbRes = await fetch(`/api/connections/${conn.id}/databases`);
      if (dbRes.ok) {
        const dbData = await dbRes.json();
        const dbs: string[] = dbData.databases || [targetDb];
        setDatabasesList(dbs);
        if (dbData.current && (!activeDb || !dbs.includes(activeDb))) {
          activeDb = dbData.current;
          setActiveDatabase(activeDb);
        }
      }

      // Fetch schemas for active database
      const schemaRes = await fetch(`/api/connections/${conn.id}/schemas?database=${encodeURIComponent(activeDb)}`);
      let fetchedSchemas: SchemaGroup[] = [];
      if (schemaRes.ok) {
        const schemaData = await schemaRes.json();
        fetchedSchemas = schemaData.schemas || [];
        setSchemas(fetchedSchemas);
        setTotalEntities(schemaData.totalEntities || 0);
      }

      // Find first existing table in database
      const firstSchemaWithTables = fetchedSchemas.find(s => s.tables && s.tables.length > 0) || fetchedSchemas[0];
      const firstTable = firstSchemaWithTables?.tables?.[0];

      let initialTab: WorkspaceTab;
      if (firstTable) {
        initialTab = {
          id: `tab-tbl-${Date.now()}`,
          type: 'table_data',
          title: firstTable.name,
          connectionId: conn.id,
          tableName: firstTable.name,
          schemaName: firstSchemaWithTables?.name || (conn.driver === 'sqlite' ? 'main' : conn.driver === 'sqlserver' ? 'dbo' : conn.driver === 'mysql' ? (conn.default_database || '') : 'public')
        };
      } else {
        let defaultQueryText = `SELECT current_database(), current_user, version();`;
        if (conn.driver === 'mysql') {
          defaultQueryText = `SELECT VERSION(), DATABASE(), CURRENT_USER();`;
        } else if (conn.driver === 'sqlite') {
          defaultQueryText = `SELECT sqlite_version();`;
        } else if (conn.driver === 'sqlserver') {
          defaultQueryText = `SELECT @@VERSION as version, DB_NAME() as database_name, SYSTEM_USER as user_name;`;
        }

        initialTab = {
          id: `tab-query-${Date.now()}`,
          type: 'query_editor',
          title: 'Query #1',
          connectionId: conn.id,
          queryText: defaultQueryText
        };
      }

      setTabs(prev => {
        // Replace connection tabs with the initial tab
        const dataTabs = prev.filter(t => t.type !== 'connection_form');
        return [initialTab, ...dataTabs];
      });
      setActiveTabId(initialTab.id);
      setRailView('entities');
      success('Connected to Database', `Connected to ${conn.name} (${conn.driver}${conn.environment ? ` • ${conn.environment.toUpperCase()}` : ''})`);
    } catch {
      error('Connection Failed', `Could not connect to ${conn.name}`);
    }
  };

  const handleSaveConnection = async (connData: Partial<DatabaseConnection>) => {
    try {
      const existing = connections.find(c => c.id === connData.id);
      let res;
      if (existing) {
        res = await fetch(`/api/connections/${connData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(connData)
        });
      } else {
        res = await fetch('/api/connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(connData)
        });
      }

      if (res.ok) {
        await loadConnections();
      }
    } catch {
      error('Save Failed', 'Failed to persist connection to SQLite.');
    }
  };

  const handleDeleteConnection = async (id: string) => {
    try {
      const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await loadConnections();
        if (selectedConnectionId === id) {
          setSelectedConnectionId(connections.find(c => c.id !== id)?.id);
        }
        success('Deleted Connection', 'Removed connection record from SQLite.');
      }
    } catch {
      error('Delete Failed', 'Failed to delete connection.');
    }
  };

  const handleDuplicateConnection = (conn: DatabaseConnection) => {
    const duplicated: Partial<DatabaseConnection> = {
      ...conn,
      name: `${conn.name} (Copy)`
    };
    delete duplicated.id;
    handleSaveConnection(duplicated);
  };

  // Switch Database within connection
  const handleChangeDatabase = (newDb: string) => {
    setActiveDatabase(newDb);
    if (activeConnection) {
      fetchSchemas(activeConnection.id, newDb);
    }
  };

  // Open Table Tab & automatically direct sidebar to entities
  const handleOpenTable = (tableName: string, schemaName: string) => {
    const existing = tabs.find(t => t.type === 'table_data' && t.tableName === tableName);
    if (existing) {
      setActiveTabId(existing.id);
    } else {
      const newTab: WorkspaceTab = {
        id: `tab-tbl-${Date.now()}-${tableName}`,
        type: 'table_data',
        title: tableName,
        connectionId: activeConnection?.id,
        tableName,
        schemaName
      };

      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    }

    // Auto-focus sidebar to entities and ensure sidebar is opened
    setRailView('entities');
    setSidebarOpenState(true);
  };

  // Open New Query Tab
  const handleNewQueryTab = (customQuery?: string) => {
    const nextCount = queryCounter + 1;
    setQueryCounter(nextCount);

    const firstTableName = schemas.find(s => s.tables && s.tables.length > 0)?.tables?.[0]?.name;
    const fallbackSql = firstTableName ? `SELECT * FROM ${firstTableName} LIMIT 50;` : 'SELECT current_database(), now();';

    const newTab: WorkspaceTab = {
      id: `tab-query-${Date.now()}`,
      type: 'query_editor',
      title: `Query #${nextCount}`,
      connectionId: activeConnection?.id,
      queryText: customQuery || fallbackSql
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setRailView('entities');
  };

  const handleOpenSshTab = useCallback((connId?: string, config?: SshConfigParams, forceNew?: boolean) => {
    let targetConn = connId ? connections.find(c => c.id === connId) : undefined;
    if (!targetConn && !config) {
      if (activeConnection && (activeConnection.connection_mode === 'ssh' || activeConnection.driver === 'ssh' || activeConnection.ssh_enabled)) {
        targetConn = activeConnection;
      } else if (selectedConnectionId) {
        targetConn = connections.find(c => c.id === selectedConnectionId && (c.connection_mode === 'ssh' || c.driver === 'ssh' || c.ssh_enabled));
      }
    }

    if (!targetConn && !config) {
      const existingTab = tabs.find(t => t.type === 'ssh_terminal');
      if (existingTab) {
        setWorkspaceMode('ssh');
        setActiveTabId(existingTab.id);
        return;
      }

      setWorkspaceMode('ssh');
      setRailView('connections');
      const newTabId = `tab-conn-new-${Date.now()}`;
      const newTab: WorkspaceTab = {
        id: newTabId,
        type: 'connection_form',
        title: 'New SSH Server',
        initialMode: 'ssh'
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTabId);
      info('Select SSH Server', 'Please configure or select an SSH server connection to open SSH CLI.');
      return;
    }

    const effectiveConnId = connId || targetConn?.id;

    // Reuse existing SSH Terminal tab if forceNew is not requested
    if (!forceNew) {
      const existingTab = tabs.find(t =>
        t.type === 'ssh_terminal' &&
        (
          (effectiveConnId && t.connectionId === effectiveConnId) ||
          (config?.host && t.sshConfig?.host === config.host)
        )
      );
      if (existingTab) {
        setWorkspaceMode('ssh');
        setActiveTabId(existingTab.id);
        return;
      }
    }

    const title = config?.host
      ? `SSH: ${config.host}`
      : targetConn
      ? `SSH: ${targetConn.name}`
      : 'SSH Terminal';

    const newTabId = `tab-ssh-${Date.now()}`;
    const newTab: WorkspaceTab = {
      id: newTabId,
      type: 'ssh_terminal',
      title,
      connectionId: effectiveConnId,
      sshConfig: config,
    };

    setWorkspaceMode('ssh');
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [connections, activeConnection, selectedConnectionId, tabs, info]);

  const handleOpenSftpTab = useCallback((connId?: string, config?: SshConfigParams, initialPath = '.', forceNew?: boolean) => {
    let targetConn = connId ? connections.find(c => c.id === connId) : undefined;
    if (!targetConn && !config) {
      if (activeConnection && (activeConnection.connection_mode === 'ssh' || activeConnection.driver === 'ssh' || activeConnection.ssh_enabled)) {
        targetConn = activeConnection;
      } else if (selectedConnectionId) {
        targetConn = connections.find(c => c.id === selectedConnectionId && (c.connection_mode === 'ssh' || c.driver === 'ssh' || c.ssh_enabled));
      }
    }

    if (!targetConn && !config) {
      const existingTab = tabs.find(t => t.type === 'sftp_explorer');
      if (existingTab) {
        setWorkspaceMode('ssh');
        setActiveTabId(existingTab.id);
        return;
      }

      setWorkspaceMode('ssh');
      setRailView('connections');
      const newTabId = `tab-conn-new-${Date.now()}`;
      const newTab: WorkspaceTab = {
        id: newTabId,
        type: 'connection_form',
        title: 'New SSH Server',
        initialMode: 'ssh'
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTabId);
      info('Select SSH Server', 'Please configure or select an SSH server connection to open SFTP Explorer.');
      return;
    }

    const effectiveConnId = connId || targetConn?.id;

    // Reuse existing SFTP tab if forceNew is not requested
    if (!forceNew) {
      const existingTab = tabs.find(t =>
        t.type === 'sftp_explorer' &&
        (
          (effectiveConnId && t.connectionId === effectiveConnId) ||
          (config?.host && t.sshConfig?.host === config.host)
        )
      );
      if (existingTab) {
        setWorkspaceMode('ssh');
        setActiveTabId(existingTab.id);
        return;
      }
    }

    const title = config?.host
      ? `SFTP: ${config.host}`
      : targetConn
      ? `SFTP: ${targetConn.name}`
      : 'SFTP Explorer';

    const newTabId = `tab-sftp-${Date.now()}`;
    const newTab: WorkspaceTab = {
      id: newTabId,
      type: 'sftp_explorer',
      title,
      connectionId: effectiveConnId,
      sshConfig: config,
      initialPath,
    };

    setWorkspaceMode('ssh');
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [connections, activeConnection, selectedConnectionId, tabs, info]);

  const handleNewTerminalTab = useCallback(() => {
    const currentTab = tabs.find(t => t.id === activeTabIdRef.current);
    const connId = currentTab?.connectionId;
    const sshConfig = currentTab?.sshConfig;
    handleOpenSshTab(connId, sshConfig, true);
  }, [tabs, handleOpenSshTab]);

  const handleDisconnectSsh = useCallback(() => {
    const currentTab = tabs.find(t => t.id === activeTabIdRef.current);
    const targetConnId = currentTab?.connectionId;
    setTabs(prev => {
      const remaining = prev.filter(t => {
        if (targetConnId) {
          return !(t.connectionId === targetConnId && (t.type === 'ssh_terminal' || t.type === 'sftp_explorer'));
        }
        return !(t.type === 'ssh_terminal' || t.type === 'sftp_explorer');
      });

      const remainingSshTabs = remaining.filter(t =>
        t.type === 'ssh_terminal' ||
        t.type === 'sftp_explorer' ||
        (t.type === 'connection_form' && t.initialMode === 'ssh')
      );

      if (remainingSshTabs.length > 0) {
        setActiveTabId(remainingSshTabs[remainingSshTabs.length - 1].id);
        return remaining;
      }

      const newTabId = `tab-conn-new-${Date.now()}`;
      const newSshTab: WorkspaceTab = {
        id: newTabId,
        type: 'connection_form',
        title: 'New SSH Server',
        initialMode: 'ssh'
      };
      setActiveTabId(newTabId);
      return [...remaining, newSshTab];
    });
    setWorkspaceMode('ssh');
    setRailView('connections');
    setSidebarOpenState(true);
    success('SSH Disconnected', 'Closed SSH session.');
  }, [tabs, success, setSidebarOpenState]);

  // Find active tab object
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const activeSelectedConnection = connections.find(c => c.id === selectedConnectionId);

  const activeSshConnection = useMemo(() => {
    // Only consider active if the current active tab is an active SSH terminal or SFTP explorer
    if (activeTab.type !== 'ssh_terminal' && activeTab.type !== 'sftp_explorer') {
      return null;
    }
    if (activeTab.connectionId) {
      const conn = connections.find(c => c.id === activeTab.connectionId);
      if (conn && (conn.connection_mode === 'ssh' || conn.driver === 'ssh' || conn.ssh_enabled)) {
        return conn;
      }
    }
    if (activeConnection && (activeConnection.connection_mode === 'ssh' || activeConnection.driver === 'ssh' || activeConnection.ssh_enabled)) {
      return activeConnection;
    }
    if (selectedConnectionId) {
      const conn = connections.find(c => c.id === selectedConnectionId);
      if (conn && (conn.connection_mode === 'ssh' || conn.driver === 'ssh' || conn.ssh_enabled)) {
        return conn;
      }
    }
    return null;
  }, [activeTab, activeConnection, selectedConnectionId, connections]);

  const parseSnippetVariables = (cmd: string): SnippetVariable[] => {
    const regex = /\{\{([a-zA-Z0-9_-]+(?::[^}]+)?)\}\}/g;
    const matches: SnippetVariable[] = [];
    const seen = new Set<string>();
    let m;
    while ((m = regex.exec(cmd)) !== null) {
      const raw = m[1];
      if (!seen.has(raw)) {
        seen.add(raw);
        if (raw.includes(':')) {
          const [key, ...rest] = raw.split(':');
          matches.push({ raw, key: key.trim(), defaultValue: rest.join(':').trim() });
        } else {
          matches.push({ raw, key: raw.trim(), defaultValue: '' });
        }
      }
    }
    return matches;
  };

  const dispatchSnippetToTerminal = useCallback((command: string, autoExecute: boolean) => {
    const currentActiveTab = tabs.find(t => t.id === activeTabIdRef.current);
    // 1. If active tab is already an SSH terminal, send to it directly
    if (currentActiveTab?.type === 'ssh_terminal') {
      window.dispatchEvent(
        new CustomEvent('bbdb:run-snippet', {
          detail: { tabId: currentActiveTab.id, command, autoExecute }
        })
      );
      return;
    }

    // 2. If another SSH terminal tab is open, activate it and send
    const existingTerminalTab = tabs.find(t => t.type === 'ssh_terminal');
    if (existingTerminalTab) {
      setWorkspaceMode('ssh');
      setActiveTabId(existingTerminalTab.id);
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('bbdb:run-snippet', {
            detail: { tabId: existingTerminalTab.id, command, autoExecute }
          })
        );
      }, 100);
      return;
    }

    // 3. Otherwise, check for active or saved SSH host to open terminal
    const sshTarget = activeSshConnection || connections.find(c => c.connection_mode === 'ssh' || c.driver === 'ssh' || c.ssh_enabled);
    if (sshTarget) {
      handleOpenSshTab(sshTarget.id);
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('bbdb:run-snippet', {
            detail: { command, autoExecute }
          })
        );
      }, 1200);
    } else {
      info('No SSH Connection', 'Please configure or connect to an SSH server to run terminal snippets.');
    }
  }, [tabs, activeSshConnection, connections, handleOpenSshTab, info]);

  const handleRunSnippet = useCallback((command: string, autoExecute: boolean) => {
    const vars = parseSnippetVariables(command);
    if (vars.length > 0) {
      setSnippetModal({
        isOpen: true,
        rawCommand: command,
        variables: vars,
        autoExecute
      });
    } else {
      dispatchSnippetToTerminal(command, autoExecute);
    }
  }, [dispatchSnippetToTerminal]);

  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const handleCloseTab = useCallback((id: string) => {
    setTabs(prevTabs => {
      if (prevTabs.length <= 1) return prevTabs;
      const nextTabs = prevTabs.filter(t => t.id !== id);

      if (workspaceMode === 'ssh') {
        const remainingSshTabs = nextTabs.filter(t =>
          t.type === 'ssh_terminal' ||
          t.type === 'sftp_explorer' ||
          (t.type === 'connection_form' && t.initialMode === 'ssh')
        );

        if (remainingSshTabs.length === 0) {
          // If no SSH tabs left in SSH mode, create a New SSH Server tab
          const newTabId = `tab-conn-new-${Date.now()}`;
          const newSshTab: WorkspaceTab = {
            id: newTabId,
            type: 'connection_form',
            title: 'New SSH Server',
            initialMode: 'ssh'
          };
          setActiveTabId(newTabId);
          setRailView('connections');
          setSidebarOpenState(true);
          return [...nextTabs, newSshTab];
        }

        if (activeTabIdRef.current === id) {
          const nextActiveTab = remainingSshTabs[remainingSshTabs.length - 1];
          setActiveTabId(nextActiveTab.id);
          if (nextActiveTab.type === 'connection_form') {
            setRailView('connections');
            setSidebarOpenState(true);
          }
        }
        return nextTabs;
      }

      // Database mode logic:
      const remainingDbTabs = nextTabs.filter(t =>
        t.type === 'table_data' ||
        t.type === 'query_editor' ||
        (t.type === 'connection_form' && t.initialMode !== 'ssh')
      );

      if (remainingDbTabs.length === 0) {
        // If no DB tabs left in DB mode, create a New Connection tab
        const newTabId = `tab-conn-new-${Date.now()}`;
        const newDbTab: WorkspaceTab = {
          id: newTabId,
          type: 'connection_form',
          title: 'New Connection',
          initialMode: 'database'
        };
        setActiveTabId(newTabId);
        setRailView('connections');
        setSidebarOpenState(true);
        return [...nextTabs, newDbTab];
      }

      if (activeTabIdRef.current === id) {
        const nextActiveTab = remainingDbTabs[remainingDbTabs.length - 1];
        setActiveTabId(nextActiveTab.id);
        if (nextActiveTab?.type === 'table_data' && activeConnection) {
          setRailView('entities');
          setSidebarOpenState(true);
        } else if (nextActiveTab?.type === 'connection_form') {
          setRailView('connections');
          setSidebarOpenState(true);
        }
      }

      return nextTabs;
    });
  }, [activeConnection, workspaceMode, setSidebarOpenState]);

  // Tab Selection with automatic entities redirection when selecting a table tab
  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    const target = tabs.find(t => t.id === tabId);
    if (target?.type === 'table_data' && activeConnection) {
      setRailView('entities');
      setSidebarOpenState(true);
    } else if (target?.type === 'ssh_terminal' || target?.type === 'sftp_explorer') {
      setWorkspaceMode('ssh');
    } else if (target?.type === 'connection_form' && target.initialMode === 'ssh') {
      setWorkspaceMode('ssh');
      setRailView('connections');
      setSidebarOpenState(true);
    }
  }, [tabs, activeConnection, setSidebarOpenState]);

  // Sidebar drag resizer mouse handlers
  const handleMouseDownResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const minWidth = 180;
      const maxWidth = Math.min(800, window.innerWidth * 0.6);
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + deltaX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      const deltaX = upEvent.clientX - startX;
      const minWidth = 180;
      const maxWidth = Math.min(800, window.innerWidth * 0.6);
      const finalWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + deltaX));
      try {
        localStorage.setItem('bbdb_sidebar_width', String(finalWidth));
      } catch {
        // ignore
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  const handleResetSidebarWidth = useCallback(() => {
    setSidebarWidth(260);
    try {
      localStorage.setItem('bbdb_sidebar_width', '260');
    } catch {
      // ignore
    }
  }, []);

  // Manual Commit / Autocommit Controls
  const handleToggleAutocommit = useCallback(() => {
    if (activeConnection?.environment === 'production' && !autocommit) {
      const confirmed = window.confirm(
        '⚠️ PRODUCTION WARNING:\n\nThis connection is marked as PRODUCTION. Enabling Autocommit means all SQL mutations (UPDATE/DELETE/INSERT) will be immediately written to the database without the ability to rollback.\n\nAre you sure you want to enable Autocommit?'
      );
      if (!confirmed) return;
    }
    const next = !autocommit;
    setAutocommit(next);
    info(
      next ? 'Autocommit Enabled' : 'Manual Commit Enabled',
      next ? 'Mutations will commit immediately' : 'Transactions must be committed manually with the Commit button'
    );
  }, [activeConnection, autocommit, info]);

  // Global Keyboard Shortcuts (Configurable via Studio Settings)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Guard 1: Do not intercept shortcuts when a modal is active
      if (isSettingsOpen || snippetModal.isOpen || isTransactionLogOpen) {
        return;
      }

      // Guard 2: Do not intercept keystrokes when interactive terminal (xterm) has focus
      const target = e.target as HTMLElement | null;
      if (target?.closest('.xterm')) {
        return;
      }

      // 1. Toggle Sidebar (default Ctrl+B)
      if (isShortcutMatch(e, shortcuts.toggle_sidebar || 'Ctrl+B')) {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      // 2. Open Settings (default Ctrl+,)
      if (isShortcutMatch(e, shortcuts.open_settings || 'Ctrl+,')) {
        e.preventDefault();
        setIsSettingsOpen(prev => !prev);
        return;
      }
      // 3. Disconnect Active Session (default Ctrl+Shift+Q)
      if (isShortcutMatch(e, shortcuts.disconnect || 'Ctrl+Shift+Q')) {
        e.preventDefault();
        handleDisconnect();
        return;
      }
      // 4. New Query Tab (default Alt+T)
      if (isShortcutMatch(e, shortcuts.new_query || 'Alt+T')) {
        e.preventDefault();
        handleNewQueryTab();
        return;
      }
      // 5. New Terminal Tab (default Alt+S)
      if (isShortcutMatch(e, shortcuts.new_terminal || 'Alt+S')) {
        e.preventDefault();
        handleNewTerminalTab();
        return;
      }
      // 6. Close Active Tab (default Ctrl+W)
      if (isShortcutMatch(e, shortcuts.close_tab || 'Ctrl+W')) {
        e.preventDefault();
        if (activeTabIdRef.current) {
          handleCloseTab(activeTabIdRef.current);
        }
        return;
      }
      // 7. Toggle Autocommit (default Ctrl+Shift+A)
      if (isShortcutMatch(e, shortcuts.toggle_autocommit || 'Ctrl+Shift+A')) {
        e.preventDefault();
        handleToggleAutocommit();
        return;
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    shortcuts,
    isSettingsOpen,
    snippetModal.isOpen,
    isTransactionLogOpen,
    handleDisconnect, 
    handleNewQueryTab, 
    handleNewTerminalTab, 
    handleCloseTab, 
    toggleSidebar, 
    handleToggleAutocommit
  ]);

  const handleCommit = async () => {
    if (!activeConnection) return;
    try {
      const res = await fetch('/api/transaction/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeConnection.id,
          connectionId: activeConnection.id,
          database: activeDatabase
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setInTransaction(false);
        success('Transaction Committed', data.message);
        loadHistory();
      } else {
        error('Commit Error', data.error || 'Failed to commit transaction.');
      }
    } catch {
      error('Commit Error', 'Failed to commit transaction.');
    }
  };

  const handleRollback = async () => {
    if (!activeConnection) return;
    try {
      const res = await fetch('/api/transaction/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeConnection.id,
          connectionId: activeConnection.id,
          database: activeDatabase
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setInTransaction(false);
        info('Transaction Rolled Back', data.message);
        loadHistory();
      } else {
        error('Rollback Error', data.error || 'Failed to rollback transaction.');
      }
    } catch {
      error('Rollback Error', 'Failed to rollback transaction.');
    }
  };

  const handleClearHistory = async () => {
    try {
      const res = await fetch('/api/history', { method: 'DELETE' });
      if (res.ok) {
        setHistory([]);
        success('History Cleared', 'Query history table emptied in SQLite.');
      }
    } catch {
      error('Error', 'Failed to clear query history.');
    }
  };

  return (
    <div
      className={cn(
        'w-screen h-screen flex flex-row overflow-hidden',
        isResizing && 'cursor-col-resize select-none',
        theme === 'dark' ? 'dark bg-zinc-950 text-zinc-100' : 'bg-zinc-100 text-zinc-900'
      )}
    >
      {/* 1. Left Navigation Rail (Image #3 & #5 far left) */}
      <NavigationRail
        currentView={railView}
        isSidebarOpen={isSidebarOpen}
        onViewChange={handleRailViewChange}
        onNewQuery={() => handleNewQueryTab()}
        onOpenSsh={() => handleOpenSshTab()}
        onOpenSftp={() => handleOpenSftpTab()}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setIsSettingsOpen(true)}
        activeConnectionName={activeConnection?.name}
        activeConnectionColor={activeConnection?.color}
        hasActiveConnection={Boolean(activeConnection)}
        onDisconnect={handleDisconnect}
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={handleWorkspaceModeChange}
        activeTabType={activeTab.type}
      />

      {/* 2. Sidebar Drawer (Connections list, Entities tree, or History) */}
      {isSidebarOpen && (
        <>
          <SidebarDrawer
            width={sidebarWidth}
            currentView={railView}
            workspaceMode={workspaceMode}
            onWorkspaceModeChange={handleWorkspaceModeChange}
            activeTabType={activeTab.type}
            activeSshConnection={activeSshConnection}
            onDisconnectSsh={handleDisconnectSsh}
            connections={connections}
            activeConnectionId={activeConnection?.id}
            selectedConnectionId={selectedConnectionId}
            onSelectConnection={(id) => {
              setSelectedConnectionId(id);
              const connToEdit = connections.find(c => c.id === id);
              const isSsh = connToEdit?.connection_mode === 'ssh' || connToEdit?.driver === 'ssh';
              const editTabId = `tab-conn-edit-${id}`;
              const existingEditTab = tabs.find(t => t.id === editTabId || (t.type === 'connection_form' && t.connectionId === id));
              if (existingEditTab) {
                setActiveTabId(existingEditTab.id);
              } else {
                const editTab: WorkspaceTab = {
                  id: editTabId,
                  type: 'connection_form',
                  title: connToEdit ? `Edit: ${connToEdit.name}` : 'Edit Connection',
                  connectionId: id,
                  initialMode: isSsh ? 'ssh' : 'database'
                };
                setTabs(prev => [...prev, editTab]);
                setActiveTabId(editTabId);
              }
              setRailView('connections');
            }}
            onConnectConnection={handleConnect}
            onNewConnectionClick={(mode = 'database') => {
              setSelectedConnectionId(undefined);
              const isSsh = mode === 'ssh';
              const newTabId = `tab-conn-new-${Date.now()}`;
              const newTab: WorkspaceTab = {
                id: newTabId,
                type: 'connection_form',
                title: isSsh ? 'New SSH Server' : 'New Connection',
                initialMode: isSsh ? 'ssh' : 'database'
              };
              setTabs(prev => [...prev, newTab]);
              setActiveTabId(newTabId);
              setRailView('connections');
            }}
            onDeleteConnection={handleDeleteConnection}
            onDuplicateConnection={handleDuplicateConnection}
            onDisconnect={handleDisconnect}
            onOpenSsh={handleOpenSshTab}
            onOpenSftp={handleOpenSftpTab}
            activeDatabase={activeDatabase}
            databasesList={databasesList}
            onChangeDatabase={handleChangeDatabase}
            schemas={schemas}
            totalEntities={totalEntities}
            onRefreshSchemas={() => activeConnection && fetchSchemas(activeConnection.id, activeDatabase)}
            onOpenTable={handleOpenTable}
            activeTableName={activeTab.tableName}
            history={history}
            onRefreshHistory={loadHistory}
            onClearHistory={handleClearHistory}
            onSelectHistoryItem={(q) => handleNewQueryTab(q)}
            onOpenQueryTab={(q) => handleNewQueryTab(q)}
            onViewChange={handleRailViewChange}
          />

          {/* Resizer Splitter Handle */}
          <div
            onMouseDown={handleMouseDownResize}
            onDoubleClick={handleResetSidebarWidth}
            title="Drag to resize sidebar • Double-click to reset"
            className={cn(
              "relative w-1 hover:w-1 active:w-1 h-full cursor-col-resize select-none shrink-0 transition-all z-20 group",
              isResizing ? "bg-yellow-400 w-0.5" : "bg-transparent hover:bg-yellow-400/80"
            )}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        </>
      )}

      {/* 3. Main Workspace Area */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-zinc-950 overflow-hidden">
        {/* Multi-Tab Bar & Transaction Controls */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewQueryTab={() => handleNewQueryTab()}
          onNewTerminalTab={handleNewTerminalTab}
          workspaceMode={workspaceMode}
          activeTabType={activeTab.type}
          autocommit={autocommit}
          onToggleAutocommit={handleToggleAutocommit}
          inTransaction={inTransaction}
          onCommit={handleCommit}
          onRollback={handleRollback}
          onOpenTransactionLog={() => setIsTransactionLogOpen(true)}
          activeConnectionName={activeConnection?.name}
          activeConnectionColor={activeConnection?.color}
          activeConnectionEnvironment={activeConnection?.environment}
          onDisconnect={handleDisconnect}
        />

        {/* Tab Content Rendering - Keep-alive mounted containers to prevent reconnecting on tab switch */}
        <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden relative">
          {tabs.map((tab) => {
            const isTabActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={cn(
                  "w-full h-full flex-1 flex flex-col min-h-0",
                  isTabActive ? "flex" : "hidden"
                )}
              >
                {tab.type === 'connection_form' && (
                  <ConnectionView
                    initialConnection={tab.connectionId ? connections.find(c => c.id === tab.connectionId) || null : null}
                    initialMode={tab.initialMode || (workspaceMode === 'ssh' ? 'ssh' : 'database')}
                    onConnect={handleConnect}
                    onSave={handleSaveConnection}
                    onOpenSsh={(cfg) => handleOpenSshTab(undefined, cfg)}
                    onOpenSftp={(cfg) => handleOpenSftpTab(undefined, cfg)}
                  />
                )}

                {tab.type === 'table_data' && activeConnection && (
                  <DataTableView
                    connection={activeConnection}
                    connectionId={activeConnection.id}
                    database={activeDatabase}
                    schemaName={tab.schemaName || 'public'}
                    tableName={tab.tableName || ''}
                    autocommit={autocommit}
                    inTransaction={inTransaction}
                    fontSize={appFontSize}
                    defaultQueryLimit={defaultQueryLimit}
                    onTransactionChange={setInTransaction}
                    onRefreshHistory={loadHistory}
                    onDisconnect={handleDisconnect}
                    onOpenQueryTab={(q) => handleNewQueryTab(q)}
                  />
                )}

                {tab.type === 'query_editor' && activeConnection && (
                  <SqlEditorView
                    connection={activeConnection}
                    initialQuery={tab.queryText}
                    connectionId={activeConnection.id}
                    database={activeDatabase}
                    schemas={schemas}
                    autocommit={autocommit}
                    inTransaction={inTransaction}
                    fontSize={appFontSize}
                    confirmDestructive={confirmDestructiveQueries}
                    runQueryShortcut={shortcuts.run_query || 'Ctrl+Enter'}
                    onCommit={handleCommit}
                    onRollback={handleRollback}
                    onRefreshHistory={loadHistory}
                    onTransactionChange={setInTransaction}
                    onDisconnect={handleDisconnect}
                  />
                )}

                {tab.type === 'ssh_terminal' && (
                  <SshTerminalView
                    tabId={tab.id}
                    isActive={isTabActive}
                    connectionId={tab.connectionId}
                    connection={tab.connectionId ? connections.find(c => c.id === tab.connectionId) || activeConnection : activeConnection}
                    sshConfig={tab.sshConfig}
                    theme={theme}
                    terminalFontSize={terminalFontSize}
                    terminalCursorStyle={terminalCursorStyle}
                    onOpenSftpTab={handleOpenSftpTab}
                    onRunSnippet={handleRunSnippet}
                  />
                )}

                {tab.type === 'sftp_explorer' && (
                  <SftpExplorerView
                    tabId={tab.id}
                    isActive={isTabActive}
                    connectionId={tab.connectionId}
                    connection={tab.connectionId ? connections.find(c => c.id === tab.connectionId) || activeConnection : activeConnection}
                    sshConfig={tab.sshConfig}
                    initialPath={tab.initialPath || '.'}
                    defaultShowHidden={sftpShowHidden}
                    onOpenSshTab={handleOpenSshTab}
                  />
                )}

                {tab.type !== 'connection_form' && tab.type !== 'ssh_terminal' && tab.type !== 'sftp_explorer' && !activeConnection && (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500">
                    <p className="text-sm font-medium text-zinc-300 mb-2">No Active Database Connection</p>
                    <p className="text-xs max-w-sm mb-4">Select a saved connection from the left panel or configure a new connection to open this workspace.</p>
                    <button
                      onClick={() => {
                        const existingNewTab = tabs.find(t => t.type === 'connection_form' && !t.connectionId);
                        if (existingNewTab) {
                          setActiveTabId(existingNewTab.id);
                        } else {
                          const newTabId = `tab-conn-new-${Date.now()}`;
                          const isSsh = workspaceMode === 'ssh';
                          const newTab: WorkspaceTab = {
                            id: newTabId,
                            type: 'connection_form',
                            title: isSsh ? 'New SSH Server' : 'New Connection',
                            initialMode: isSsh ? 'ssh' : 'database'
                          };
                          setTabs(prev => [...prev, newTab]);
                          setActiveTabId(newTabId);
                        }
                        setRailView('connections');
                      }}
                      className="px-4 py-2 bg-yellow-400 text-slate-950 font-bold text-xs rounded hover:bg-yellow-300 transition-colors cursor-pointer"
                    >
                      Go to Connection Settings
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Transaction Log & History Inspection Modal */}
      <TransactionLogModal
        isOpen={isTransactionLogOpen}
        onClose={() => setIsTransactionLogOpen(false)}
        connectionId={activeConnection?.id}
        database={activeDatabase}
        inTransaction={inTransaction}
        onCommit={handleCommit}
        onRollback={handleRollback}
        isProduction={activeConnection?.environment === 'production'}
      />

      {/* Snippet Template Variable Input Modal */}
      <SnippetVariableModal
        isOpen={snippetModal.isOpen}
        rawCommand={snippetModal.rawCommand}
        variables={snippetModal.variables}
        autoExecute={snippetModal.autoExecute}
        onClose={() => setSnippetModal(prev => ({ ...prev, isOpen: false }))}
        onSubmit={(resolvedCommand, autoExecute) => {
          dispatchSnippetToTerminal(resolvedCommand, autoExecute);
        }}
      />

      {/* Studio Settings & Preferences Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentTheme={theme}
        onThemeChange={(newTheme) => {
          setTheme(newTheme);
          if (newTheme === 'dark') {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }}
        currentAutocommit={autocommitDefault}
        onAutocommitChange={(val) => {
          setAutocommitDefault(val);
          if (activeConnectionRef.current?.environment !== 'production') {
            setAutocommit(val);
          }
        }}
        onSettingsUpdated={async () => {
          await loadTheme();
        }}
        onClearHistory={loadHistory}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
