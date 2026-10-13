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

function AppContent() {
  const { success, error, info } = useToast();

  // Navigation rail view
  const [railView, setRailView] = useState<RailView>('connections');

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
  const [activeDatabase, setActiveDatabase] = useState('database');
  const [databasesList, setDatabasesList] = useState<string[]>(['database']);
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
    setDatabasesList(['database']);
    setActiveDatabase('database');
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
    const targetDb = conn.default_database || 'tm_rs_sisma_medika';
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

      await fetchSchemas(conn.id, targetDb);

      // Open Table Tab for mst_pasien or first table
      const initialTab: WorkspaceTab = {
        id: `tab-tbl-${Date.now()}`,
        type: 'table_data',
        title: 'mst_pasien',
        connectionId: conn.id,
        tableName: 'mst_pasien',
        schemaName: 'public'
      };

      setTabs(prev => {
        // Replace connection tabs with the connected database table tab
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

  // Open Table Tab
  const handleOpenTable = (tableName: string, schemaName: string) => {
    const existing = tabs.find(t => t.type === 'table_data' && t.tableName === tableName);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

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
  };

  // Open New Query Tab
  const handleNewQueryTab = (customQuery?: string) => {
    const nextCount = queryCounter + 1;
    setQueryCounter(nextCount);

    const newTab: WorkspaceTab = {
      id: `tab-query-${Date.now()}`,
      type: 'query_editor',
      title: `Query #${nextCount}`,
      connectionId: activeConnection?.id,
      queryText: customQuery || `SELECT * FROM ${schemas[0]?.tables[0]?.name || 'mst_pasien'} LIMIT 50;`
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
          return nextTabs[nextTabs.length - 1].id;
        }
        return prevActiveId;
      });
      return nextTabs;
    });
  }, []);

  // Global Keyboard Shortcuts:
  // 1. Ctrl + Shift + Q: Disconnect
  // 2. Alt + T / Ctrl + Alt + T / Ctrl + Shift + N: New Query Tab (no browser clash)
  // 3. Ctrl + W / Cmd + W / Alt + W / Ctrl + Shift + W: Close Active Tab
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
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
  }, [handleDisconnect, handleNewQueryTab, handleCloseTab]);

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
    <div className={`w-screen h-screen flex flex-row overflow-hidden ${theme === 'dark' ? 'dark bg-zinc-950 text-zinc-100' : 'bg-zinc-100 text-zinc-900'}`}>
      {/* 1. Left Navigation Rail (Image #3 & #5 far left) */}
      <NavigationRail
        currentView={railView}
        onViewChange={setRailView}
        onNewQuery={() => handleNewQueryTab()}
        theme={theme}
        onToggleTheme={toggleTheme}
        activeConnectionName={activeConnection?.name}
        activeConnectionColor={activeConnection?.color}
        hasActiveConnection={Boolean(activeConnection)}
        onDisconnect={handleDisconnect}
      />

      {/* 2. Sidebar Drawer (Connections list, Entities tree, or History) */}
      <SidebarDrawer
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

      {/* 3. Main Workspace Area */}
      <div className="flex-1 flex flex-col h-full min-w-0 bg-zinc-950 overflow-hidden">
        {/* Multi-Tab Bar & Transaction Controls */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
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
              tableName={activeTab.tableName || 'mst_pasien'}
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
