import { useState, useEffect, useCallback, useRef } from 'react';
import { DatabaseConnection, SchemaGroup, WorkspaceTab, QueryHistoryItem, ThemeConfig } from './types/database';
import { NavigationRail, RailView } from './components/NavigationRail';
import { SidebarDrawer } from './components/SidebarDrawer';
import { TabBar } from './components/TabBar';
import { ConnectionView } from './components/ConnectionView';
import { DataTableView } from './components/DataTableView';
import { SqlEditorView } from './components/SqlEditorView';
import { TransactionLogModal } from './components/TransactionLogModal';
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

  // Theme settings (persisted via JSON)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [autocommit, setAutocommit] = useState(true);
  const [inTransaction, setInTransaction] = useState(false);
  const [isTransactionLogOpen, setIsTransactionLogOpen] = useState(false);

  // Connections (persisted via SQLite)
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>(undefined);
  const [activeConnection, setActiveConnection] = useState<DatabaseConnection | null>(null);

  // Entities & Database Schemas
  const [activeDatabase, setActiveDatabase] = useState('');
  const [databasesList, setDatabasesList] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<SchemaGroup[]>([]);
  const [totalEntities, setTotalEntities] = useState(0);

  // Query History (persisted via SQLite)
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);

  // Workspace Tabs
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    {
      id: 'tab-conn-main',
      type: 'connection_form',
      title: 'New Connection'
    }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-conn-main');
  const [queryCounter, setQueryCounter] = useState(1);

  // 1. Load Theme Config from JSON endpoint
  const loadTheme = useCallback(async () => {
    try {
      const res = await fetch('/api/theme');
      if (res.ok) {
        const config: ThemeConfig = await res.json();
        setTheme(config.theme || 'dark');
        if (config.theme === 'light') {
          document.documentElement.classList.remove('dark');
        } else {
          document.documentElement.classList.add('dark');
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
      console.warn('Failed to save theme to JSON server');
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
      title: 'New Connection'
    };
    setTabs([newTab]);
    setActiveTabId(newTab.id);
    setRailView('connections');
    success('Disconnected', `Disconnected from ${name}. (Shortcut: Ctrl+Shift+Q)`);
  }, [activeConnection, info, success]);



  // 6. Connect to a database
  const handleConnect = async (conn: DatabaseConnection) => {
    setActiveConnection(conn);
    setSelectedConnectionId(conn.id);
    const targetDb = conn.default_database || 'postgres';
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
      setAutocommit(true);
    }

    try {
      // Get databases list
      const dbRes = await fetch(`/api/connections/${conn.id}/databases`);
      if (dbRes.ok) {
        const dbData = await dbRes.json();
        setDatabasesList(dbData.databases || [targetDb]);
      }

      // Fetch schemas for active database
      const schemaRes = await fetch(`/api/connections/${conn.id}/schemas?database=${encodeURIComponent(targetDb)}`);
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
          schemaName: firstSchemaWithTables.name || 'public'
        };
      } else {
        initialTab = {
          id: `tab-query-${Date.now()}`,
          type: 'query_editor',
          title: 'Query #1',
          connectionId: conn.id,
          queryText: `SELECT current_database(), current_user, version();`
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

  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const handleCloseTab = useCallback((id: string) => {
    setTabs(prevTabs => {
      if (prevTabs.length <= 1) return prevTabs;
      const nextTabs = prevTabs.filter(t => t.id !== id);
      setActiveTabId(prevActiveId => {
        if (prevActiveId === id) {
          const nextActiveTab = nextTabs[nextTabs.length - 1];
          if (nextActiveTab?.type === 'table_data' && activeConnection) {
            setRailView('entities');
          }
          return nextActiveTab.id;
        }
        return prevActiveId;
      });
      return nextTabs;
    });
  }, [activeConnection]);

  // Tab Selection with automatic entities redirection when selecting a table tab
  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    const target = tabs.find(t => t.id === tabId);
    if (target?.type === 'table_data' && activeConnection) {
      setRailView('entities');
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

  // Global Keyboard Shortcuts:
  // 1. Ctrl + Shift + Q: Disconnect
  // 2. Alt + T / Ctrl + Alt + T / Ctrl + Shift + N: New Query Tab (no browser clash)
  // 3. Ctrl + W / Cmd + W / Alt + W / Ctrl + Shift + W: Close Active Tab
  // 4. Ctrl + B / Cmd + B: Toggle Sidebar Visibility
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'b' || e.code === 'KeyB')) {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key.toLowerCase() === 'q' || e.code === 'KeyQ')) {
        e.preventDefault();
        handleDisconnect();
        return;
      }
      if (
        ((e.ctrlKey || e.metaKey) && e.altKey && (e.key.toLowerCase() === 't' || e.code === 'KeyT')) ||
        (e.altKey && (e.key.toLowerCase() === 't' || e.code === 'KeyT')) ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key.toLowerCase() === 'n' || e.code === 'KeyN'))
      ) {
        e.preventDefault();
        handleNewQueryTab();
        return;
      }
      if (
        ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'w' || e.code === 'KeyW')) ||
        (e.altKey && (e.key.toLowerCase() === 'w' || e.code === 'KeyW')) ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key.toLowerCase() === 'w' || e.code === 'KeyW'))
      ) {
        e.preventDefault();
        if (activeTabIdRef.current) {
          handleCloseTab(activeTabIdRef.current);
        }
        return;
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleDisconnect, handleNewQueryTab, handleCloseTab, toggleSidebar]);

  // Manual Commit / Autocommit Controls
  const handleToggleAutocommit = () => {
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
  };

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

  // Find active tab object
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const activeSelectedConnection = connections.find(c => c.id === selectedConnectionId);

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
        theme={theme}
        onToggleTheme={toggleTheme}
        activeConnectionName={activeConnection?.name}
        activeConnectionColor={activeConnection?.color}
        hasActiveConnection={Boolean(activeConnection)}
        onDisconnect={handleDisconnect}
      />

      {/* 2. Sidebar Drawer (Connections list, Entities tree, or History) */}
      {isSidebarOpen && (
        <>
          <SidebarDrawer
            width={sidebarWidth}
            currentView={railView}
            connections={connections}
            activeConnectionId={activeConnection?.id}
            selectedConnectionId={selectedConnectionId}
            onSelectConnection={(id) => {
              setSelectedConnectionId(id);
              const connToEdit = connections.find(c => c.id === id);
              const editTabId = `tab-conn-edit-${id}`;
              const existingEditTab = tabs.find(t => t.id === editTabId || (t.type === 'connection_form' && t.connectionId === id));
              if (existingEditTab) {
                setActiveTabId(existingEditTab.id);
              } else {
                const editTab: WorkspaceTab = {
                  id: editTabId,
                  type: 'connection_form',
                  title: connToEdit ? `Edit: ${connToEdit.name}` : 'Edit Connection',
                  connectionId: id
                };
                setTabs(prev => [...prev, editTab]);
                setActiveTabId(editTabId);
              }
              setRailView('connections');
            }}
            onConnectConnection={handleConnect}
            onNewConnectionClick={() => {
              setSelectedConnectionId(undefined);
              const existingNewTab = tabs.find(t => t.type === 'connection_form' && !t.connectionId);
              if (existingNewTab) {
                setActiveTabId(existingNewTab.id);
              } else {
                const newTabId = `tab-conn-new-${Date.now()}`;
                const newTab: WorkspaceTab = {
                  id: newTabId,
                  type: 'connection_form',
                  title: 'New Connection'
                };
                setTabs(prev => [...prev, newTab]);
                setActiveTabId(newTabId);
              }
              setRailView('connections');
            }}
            onDeleteConnection={handleDeleteConnection}
            onDuplicateConnection={handleDuplicateConnection}
            onDisconnect={handleDisconnect}
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

        {/* Tab Content Rendering */}
        <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
          {activeTab.type === 'connection_form' && (
            <ConnectionView
              key={activeTab.id + (activeTab.connectionId ? `_${activeTab.connectionId}` : '_new')}
              initialConnection={activeTab.connectionId ? connections.find(c => c.id === activeTab.connectionId) || null : null}
              onConnect={handleConnect}
              onSave={handleSaveConnection}
            />
          )}

          {activeTab.type === 'table_data' && activeConnection && (
            <DataTableView
              connection={activeConnection}
              connectionId={activeConnection.id}
              database={activeDatabase}
              schemaName={activeTab.schemaName || 'public'}
              tableName={activeTab.tableName || ''}
              autocommit={autocommit}
              inTransaction={inTransaction}
              onTransactionChange={setInTransaction}
              onRefreshHistory={loadHistory}
              onDisconnect={handleDisconnect}
              onOpenQueryTab={(q) => handleNewQueryTab(q)}
            />
          )}

          {activeTab.type === 'query_editor' && activeConnection && (
            <SqlEditorView
              connection={activeConnection}
              initialQuery={activeTab.queryText}
              connectionId={activeConnection.id}
              database={activeDatabase}
              schemas={schemas}
              autocommit={autocommit}
              inTransaction={inTransaction}
              onCommit={handleCommit}
              onRollback={handleRollback}
              onRefreshHistory={loadHistory}
              onTransactionChange={setInTransaction}
              onDisconnect={handleDisconnect}
            />
          )}

          {activeTab.type !== 'connection_form' && !activeConnection && (
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
                    const newTab: WorkspaceTab = {
                      id: newTabId,
                      type: 'connection_form',
                      title: 'New Connection'
                    };
                    setTabs(prev => [...prev, newTab]);
                    setActiveTabId(newTabId);
                  }
                  setRailView('connections');
                }}
                className="px-4 py-2 bg-yellow-400 text-zinc-950 text-xs font-semibold rounded hover:bg-yellow-300 transition-colors cursor-pointer"
              >
                Go to Connection Settings
              </button>
            </div>
          )}
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
