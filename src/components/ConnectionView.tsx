import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, ChevronDown, ChevronRight, HelpCircle, Link as LinkIcon, Database, Shield, Server, ShieldAlert } from 'lucide-react';
import { DatabaseConnection, DriverType, ConnectionEnvironment } from '../types/database';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Select } from './ui/select';
import { Checkbox } from './ui/checkbox';
import { cn } from '../lib/utils';
import { useToast } from './ui/toast';

interface ConnectionViewProps {
  initialConnection?: DatabaseConnection | null;
  onConnect: (connection: DatabaseConnection) => void;
  onSave: (connectionData: Partial<DatabaseConnection>) => void;
  onImportUrl?: (url: string) => void;
}

const COLOR_PALETTE = [
  { name: 'Charcoal', hex: '#52525b' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Magenta', hex: '#ec4899' }
];

export function ConnectionView({
  initialConnection,
  onConnect,
  onSave
}: ConnectionViewProps) {
  const { success, error, info } = useToast();

  const [driver, setDriver] = useState<DriverType>('postgresql');
  const [authMethod, setAuthMethod] = useState<'password' | 'none'>('password');
  const [connectionMode, setConnectionMode] = useState<'host_port' | 'socket'>('host_port');
  const [host, setHost] = useState(initialConnection?.host || 'localhost');
  const [port, setPort] = useState(initialConnection?.port || 5432);
  const [ssl, setSsl] = useState(Boolean(initialConnection?.ssl));
  const [username, setUsername] = useState(initialConnection?.username || '');
  const [password, setPassword] = useState(initialConnection?.password || '');
  const [showPassword, setShowPassword] = useState(false);
  const [defaultDatabase, setDefaultDatabase] = useState(initialConnection?.default_database || '');

  // Environment: development, test, production
  const [environment, setEnvironment] = useState<ConnectionEnvironment>('development');

  // SSH Tunnel
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState('localhost');
  const [sshPort, setSshPort] = useState(22);
  const [sshUser, setSshUser] = useState('');
  const [sshAuthMethod, setSshAuthMethod] = useState<'password' | 'key'>('password');
  const [sshPassword, setSshPassword] = useState('');
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [sshKeyFile, setSshKeyFile] = useState('');
  const [sshKeyPassphrase, setSshKeyPassphrase] = useState('');
  const [showSshKeyPassphrase, setShowSshKeyPassphrase] = useState(false);

  // Read Only
  const [isReadOnly, setIsReadOnly] = useState(false);

  // Save Info
  const [connectionName, setConnectionName] = useState(initialConnection?.name || '');
  const [savePassword, setSavePassword] = useState(true);
  const [selectedColor, setSelectedColor] = useState(initialConnection?.color || '#06b6d4');

  // Testing indicator
  const [isTesting, setIsTesting] = useState(false);

  // Modal for Import from URL
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [importUrlText, setImportUrlText] = useState('');

  // Update default ports when driver changes
  const handleDriverChange = (newDriver: DriverType) => {
    setDriver(newDriver);
    if (newDriver === 'postgresql') {
      setPort(5432);
      if (!initialConnection) {
        setUsername(prev => prev || 'postgres');
        setDefaultDatabase(prev => prev || 'postgres');
      }
    } else if (newDriver === 'mysql') {
      setPort(3306);
      if (!initialConnection) {
        setUsername(prev => prev || 'root');
        setDefaultDatabase(prev => prev || '');
      }
    } else if (newDriver === 'sqlserver') {
      setPort(1433);
      if (!initialConnection) {
        setUsername(prev => prev || 'sa');
        setDefaultDatabase(prev => prev || '');
      }
    } else if (newDriver === 'sqlite') {
      setPort(0);
      if (!initialConnection) {
        setUsername('');
        setPassword('');
        setDefaultDatabase(prev => prev || 'database.db');
      }
    }
  };

  useEffect(() => {
    if (initialConnection) {
      setDriver(initialConnection.driver);
      setHost(initialConnection.host || 'localhost');
      setPort(initialConnection.port || 5432);
      setUsername(initialConnection.username || '');
      setPassword(initialConnection.password || '');
      setDefaultDatabase(initialConnection.default_database || '');
      setSsl(Boolean(initialConnection.ssl));
      setSshEnabled(Boolean(initialConnection.ssh_enabled));
      setSshHost(initialConnection.ssh_host || 'localhost');
      setSshPort(initialConnection.ssh_port || 22);
      setSshUser(initialConnection.ssh_user || '');
      setSshAuthMethod(initialConnection.ssh_auth_method || 'password');
      setSshPassword(initialConnection.ssh_password || '');
      setSshKeyFile(initialConnection.ssh_key_file || '');
      setSshKeyPassphrase(initialConnection.ssh_key_passphrase || '');
      setIsReadOnly(Boolean(initialConnection.is_readonly));
      setEnvironment(initialConnection.environment || 'development');
      setConnectionName(initialConnection.name);
      setSelectedColor(initialConnection.color || (initialConnection.environment === 'production' ? '#ef4444' : '#06b6d4'));
    } else {
      // Clean reset for New Connection
      setDriver('postgresql');
      setHost('localhost');
      setPort(5432);
      setUsername('');
      setPassword('');
      setDefaultDatabase('');
      setSsl(false);
      setSshEnabled(false);
      setSshHost('localhost');
      setSshPort(22);
      setSshUser('');
      setSshAuthMethod('password');
      setSshPassword('');
      setSshKeyFile('');
      setSshKeyPassphrase('');
      setIsReadOnly(false);
      setEnvironment('development');
      setConnectionName('');
      setSelectedColor('#06b6d4');
    }
  }, [initialConnection]);

  const assembleConnection = (): DatabaseConnection => ({
    id: initialConnection?.id || `conn-${Date.now()}`,
    name: connectionName || 'Untitled Connection',
    driver,
    host,
    port,
    username,
    password: savePassword ? password : '',
    default_database: defaultDatabase,
    ssl: ssl ? 1 : 0,
    ssh_enabled: sshEnabled ? 1 : 0,
    ssh_host: sshHost,
    ssh_port: sshPort,
    ssh_user: sshUser,
    ssh_auth_method: sshAuthMethod,
    ssh_password: savePassword ? sshPassword : '',
    ssh_key_file: sshKeyFile,
    ssh_key_passphrase: savePassword ? sshKeyPassphrase : '',
    color: selectedColor,
    is_readonly: isReadOnly ? 1 : 0,
    environment,
    created_at: initialConnection?.created_at || new Date().toISOString()
  });

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const res = await fetch('/api/connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver,
          host,
          port,
          username: authMethod === 'password' ? username : '',
          password: authMethod === 'password' ? password : '',
          default_database: defaultDatabase,
          ssl: ssl ? 1 : 0,
          ssh_enabled: sshEnabled ? 1 : 0,
          ssh_host: sshHost,
          ssh_port: sshPort,
          ssh_user: sshUser,
          ssh_auth_method: sshAuthMethod,
          ssh_password: sshPassword,
          ssh_key_file: sshKeyFile,
          ssh_key_passphrase: sshKeyPassphrase,
          environment
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        success('Connection Successful', `${data.message} (${data.latency_ms}ms latency)`);
      } else {
        error('Connection Failed', data.message || 'Could not establish connection to database server.');
      }
    } catch {
      error('Network Error', 'Failed to reach local test proxy server.');
    } finally {
      setIsTesting(false);
    }
  };

  const handleConnect = () => {
    const conn = assembleConnection();
    onConnect(conn);
  };

  const handleSaveConnection = () => {
    if (!connectionName.trim()) {
      error('Validation Error', 'Please enter a Connection Name.');
      return;
    }
    const conn = assembleConnection();
    onSave(conn);
    success('Connection Saved', `Saved "${connectionName}" to SQLite database.`);
  };

  const handleParseUrl = () => {
    if (!importUrlText.trim()) return;
    try {
      // postgres://user:password@host:port/database
      const parsed = new URL(importUrlText);
      const proto = parsed.protocol.replace(':', '');
      if (proto.includes('postgres')) setDriver('postgresql');
      else if (proto.includes('mysql')) setDriver('mysql');
      else if (proto.includes('sqlserver') || proto.includes('mssql')) setDriver('sqlserver');
      else if (proto.includes('sqlite')) {
        setDriver('sqlite');
        setDefaultDatabase(parsed.pathname || 'database.db');
        setConnectionName('Imported SQLite DB');
        setShowUrlModal(false);
        info('URL Imported', `Configured connection from SQLite string.`);
        return;
      }

      setHost(parsed.hostname || 'localhost');
      if (parsed.port) setPort(parseInt(parsed.port, 10));
      setUsername(parsed.username || '');
      setPassword(parsed.password || '');
      setDefaultDatabase(parsed.pathname.replace(/^\//, '') || '');
      setConnectionName(`Imported ${parsed.hostname}`);
      setShowUrlModal(false);
      info('URL Imported', `Configured connection from ${proto} string.`);
    } catch {
      error('Invalid URL', 'Please provide a valid connection string (e.g. postgresql://user:pass@localhost:5432/mydb, mysql://..., sqlite:///path/db.sqlite)');
    }
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-zinc-950 p-6 flex justify-center">
      <div className="w-full max-w-xl space-y-5">
        {/* Header & Import from URL (Exact Image #1 match) */}
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
          <h2 className="text-base font-semibold text-zinc-100 tracking-tight">
            {initialConnection ? `Edit Connection: ${initialConnection.name}` : 'New Connection'}
          </h2>
          <button
            onClick={() => setShowUrlModal(true)}
            className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-yellow-400 font-medium transition-colors cursor-pointer"
          >
            <LinkIcon className="w-3.5 h-3.5" />
            <span>Import from URL</span>
          </button>
        </div>

        {/* Connection Form Fields */}
        <div className="space-y-4">
          {/* Environment Type (Development, Test, Production) */}
          <div className="space-y-2 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-300 mb-1">Environment Type</label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setEnvironment('development');
                  setSelectedColor('#10b981');
                }}
                className={cn(
                  "flex flex-col items-center justify-center p-2 rounded-md border text-xs cursor-pointer transition-all",
                  environment === 'development'
                    ? "bg-emerald-950/50 border-emerald-500 text-emerald-200 ring-1 ring-emerald-500/50"
                    : "bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                )}
              >
                <span className="font-semibold text-xs">Development</span>
                <span className="text-[10px] text-zinc-500 mt-0.5">Local / Dev</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEnvironment('test');
                  setSelectedColor('#f59e0b');
                }}
                className={cn(
                  "flex flex-col items-center justify-center p-2 rounded-md border text-xs cursor-pointer transition-all",
                  environment === 'test'
                    ? "bg-amber-950/50 border-amber-500 text-amber-200 ring-1 ring-amber-500/50"
                    : "bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                )}
              >
                <span className="font-semibold text-xs">Test / Staging</span>
                <span className="text-[10px] text-zinc-500 mt-0.5">QA & Testing</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEnvironment('production');
                  setSelectedColor('#ef4444');
                }}
                className={cn(
                  "flex flex-col items-center justify-center p-2 rounded-md border text-xs cursor-pointer transition-all",
                  environment === 'production'
                    ? "bg-red-950/60 border-red-500 text-red-200 ring-1 ring-red-500/50"
                    : "bg-zinc-900/40 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                )}
              >
                <div className="flex items-center gap-1 font-semibold text-xs text-red-300">
                  <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                  <span>Production</span>
                </div>
                <span className="text-[10px] text-red-400/80 mt-0.5">Manual Commit</span>
              </button>
            </div>
            {environment === 'production' && (
              <div className="p-2 rounded bg-red-950/30 border border-red-500/30 flex items-start gap-2 text-xs text-red-300 animate-in fade-in-50 mt-1">
                <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-tight">
                  <strong className="text-red-200 font-semibold">Production Safety Mode Active:</strong>
                  <p className="text-red-300/80 mt-0.5">
                    Autocommit will be disabled automatically. All queries and changes require manual Commit and can be Rolled back to prevent accidental data loss.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Database Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Database Driver</label>
            <Select
              value={driver}
              onChange={e => handleDriverChange(e.target.value as DriverType)}
            >
              <option value="postgresql">Postgres (PostgreSQL)</option>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="sqlite">SQLite</option>
              <option value="sqlserver">SQL Server (MSSQL)</option>
            </Select>
          </div>

          {/* Authentication Method */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Authentication Method</label>
            <Select
              value={authMethod}
              onChange={e => setAuthMethod(e.target.value as 'password' | 'none')}
            >
              <option value="password">Username / Password</option>
              <option value="none">No Authentication</option>
            </Select>
          </div>

          {/* Connection Mode */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Connection Mode</label>
            <Select
              value={connectionMode}
              onChange={e => setConnectionMode(e.target.value as 'host_port' | 'socket')}
            >
              <option value="host_port">Host and Port</option>
              <option value="socket">Socket / Local Named Pipe</option>
            </Select>
          </div>

          {/* Host & Port Row */}
          {connectionMode === 'host_port' && driver !== 'sqlite' && (
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-3 space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Host</label>
                <Input
                  value={host}
                  onChange={e => setHost(e.target.value)}
                  placeholder="localhost or remote IP"
                />
              </div>
              <div className="col-span-1 space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Port</label>
                <Input
                  type="number"
                  value={port}
                  onChange={e => setPort(parseInt(e.target.value, 10) || 0)}
                  placeholder="5432"
                />
              </div>
            </div>
          )}

          {/* Enable SSL Toggle Row */}
          <div className="flex items-center justify-between p-3 rounded-md bg-zinc-900/50 border border-zinc-800">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-zinc-400" />
              <span className="text-xs font-medium text-zinc-300">Enable SSL</span>
            </div>
            <Switch checked={ssl} onCheckedChange={setSsl} />
          </div>

          {/* User & Password Row */}
          {driver !== 'sqlite' && authMethod === 'password' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">User</label>
                <Input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="postgres"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-2 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Default Database Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">
              {driver === 'sqlite' ? 'SQLite File Path' : 'Default Database'}
            </label>
            <div className="relative">
              <Database className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500" />
              <Input
                value={defaultDatabase}
                onChange={e => setDefaultDatabase(e.target.value)}
                placeholder={driver === 'sqlite' ? '/path/to/database.db' : 'database'}
                className="pl-8"
              />
            </div>
          </div>

          {/* SSH Tunnel Expandable Accordion (Matches Image #1) */}
          <div className="rounded-md border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <div className="flex items-center justify-between p-3">
              <button
                type="button"
                onClick={() => setSshEnabled(!sshEnabled)}
                className="flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-zinc-100 cursor-pointer"
              >
                {sshEnabled ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />}
                <Server className="w-3.5 h-3.5 text-zinc-400" />
                <span>SSH Tunnel</span>
              </button>
              <Switch checked={sshEnabled} onCheckedChange={setSshEnabled} />
            </div>

            {sshEnabled && (
              <div className="p-3 pt-0 border-t border-zinc-800/60 mt-1 space-y-3 bg-zinc-950/40 animate-in fade-in-50">
                <div className="grid grid-cols-4 gap-2 pt-2">
                  <div className="col-span-3 space-y-1">
                    <label className="text-[11px] text-zinc-400">SSH Host</label>
                    <Input
                      value={sshHost}
                      onChange={e => setSshHost(e.target.value)}
                      placeholder="bastion.example.com"
                    />
                  </div>
                  <div className="col-span-1 space-y-1">
                    <label className="text-[11px] text-zinc-400">SSH Port</label>
                    <Input
                      type="number"
                      value={sshPort}
                      onChange={e => setSshPort(parseInt(e.target.value, 10) || 22)}
                      placeholder="22"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400">SSH User</label>
                    <Input
                      value={sshUser}
                      onChange={e => setSshUser(e.target.value)}
                      placeholder="devops or ubuntu"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400">SSH Auth</label>
                    <Select
                      sizeVariant="sm"
                      value={sshAuthMethod}
                      onChange={e => setSshAuthMethod(e.target.value as 'password' | 'key')}
                    >
                      <option value="password">Password</option>
                      <option value="key">Private Key / Passphrase</option>
                    </Select>
                  </div>
                </div>

                {/* Conditional SSH Auth Input (Responsive to SSH Auth Mode) */}
                {sshAuthMethod === 'password' ? (
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-400">SSH Password</label>
                    <div className="relative">
                      <Input
                        type={showSshPassword ? 'text' : 'password'}
                        value={sshPassword}
                        onChange={e => setSshPassword(e.target.value)}
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSshPassword(!showSshPassword)}
                        className="absolute right-2.5 top-2 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                        title={showSshPassword ? 'Hide SSH password' : 'Show SSH password'}
                      >
                        {showSshPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-400">Private Key File</label>
                      <Input
                        value={sshKeyFile}
                        onChange={e => setSshKeyFile(e.target.value)}
                        placeholder="~/.ssh/id_rsa"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-400">Passphrase (optional)</label>
                      <div className="relative">
                        <Input
                          type={showSshKeyPassphrase ? 'text' : 'password'}
                          value={sshKeyPassphrase}
                          onChange={e => setSshKeyPassphrase(e.target.value)}
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSshKeyPassphrase(!showSshKeyPassphrase)}
                          className="absolute right-2.5 top-2 text-zinc-500 hover:text-zinc-200 cursor-pointer"
                          title={showSshKeyPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                        >
                          {showSshKeyPassphrase ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Read Only Mode Checkbox */}
          <div className="pt-1">
            <Checkbox
              id="readOnlyCheckbox"
              checked={isReadOnly}
              onCheckedChange={setIsReadOnly}
              label="Read Only Mode"
              description="Protect connection against accidental writes and destructive operations"
            />
          </div>

          {/* Action Buttons: Test and Connect */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="px-5 text-xs text-zinc-200"
            >
              {isTesting ? 'Testing...' : 'Test'}
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={handleConnect}
              className="px-6 text-xs font-semibold bg-white text-zinc-950 hover:bg-zinc-200"
            >
              Connect
            </Button>
          </div>
        </div>

        {/* Section: Save Connection (Image #1 bottom panel) */}
        <div className="pt-4 border-t border-zinc-800/80 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Save Connection</h3>

          <div className="space-y-1.5">
            <Input
              value={connectionName}
              onChange={e => setConnectionName(e.target.value)}
              placeholder="Connection Name (e.g. Local or PROD - RSKG)"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            {/* Save Passwords Checkbox */}
            <Checkbox
              id="savePasswordCheckbox"
              checked={savePassword}
              onCheckedChange={setSavePassword}
              label={
                <span className="flex items-center gap-1">
                  <span>Save Passwords</span>
                  <span title="Passwords are encrypted and stored in local SQLite database">
                    <HelpCircle className="w-3.5 h-3.5 text-zinc-500" />
                  </span>
                </span>
              }
            />

            {/* 8 Color Selection Dots */}
            <div className="flex items-center gap-1.5">
              {COLOR_PALETTE.map(c => {
                const isSelected = selectedColor.toLowerCase() === c.hex.toLowerCase();
                return (
                  <button
                    key={c.hex}
                    type="button"
                    title={c.name}
                    onClick={() => setSelectedColor(c.hex)}
                    className={cn(
                      'w-4 h-4 rounded-full transition-transform cursor-pointer',
                      isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950 scale-110' : 'hover:scale-110 opacity-80 hover:opacity-100'
                    )}
                    style={{ backgroundColor: c.hex }}
                  />
                );
              })}
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleSaveConnection}
              className="px-6 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Import from URL Modal */}
      {showUrlModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 w-full max-w-md shadow-2xl space-y-4 animate-in zoom-in-95">
            <h3 className="text-sm font-semibold text-zinc-100">Import Connection URL</h3>
            <p className="text-xs text-zinc-400">
              Paste a database connection string in URI format (e.g. postgresql://user:pass@localhost:5432/dbname).
            </p>
            <Input
              value={importUrlText}
              onChange={e => setImportUrlText(e.target.value)}
              placeholder="postgresql://admin:secret@db.corp.internal:5432/hospital_db"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowUrlModal(false)}>
                Cancel
              </Button>
              <Button variant="yellow" onClick={handleParseUrl}>
                Parse & Import
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
