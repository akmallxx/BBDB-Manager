import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Folder,
  File,
  FileText,
  FileCode,
  FileArchive,
  Image,
  ArrowUp,
  RefreshCw,
  Upload,
  FolderPlus,
  FilePlus,
  Download,
  Trash2,
  Edit2,
  Terminal,
  ChevronRight,
  Eye,
  Save,
  X,
  AlertCircle,
  CheckCircle2,
  Sliders,
  Home,
  Search,
} from 'lucide-react';
import { Button } from '../ui/button';
import { DatabaseConnection, SshConfigParams } from '../../types/database';
import { cn } from '../../lib/utils';

interface SftpFileItem {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'directory' | 'symlink' | 'other';
  permissions: string;
  mode: number;
  mtime: number;
}

interface SftpExplorerViewProps {
  tabId: string;
  isActive?: boolean;
  connectionId?: string;
  connection?: DatabaseConnection | null;
  sshConfig?: SshConfigParams;
  initialPath?: string;
  defaultShowHidden?: boolean;
  onOpenSshTab?: (connectionId?: string, config?: SshConfigParams) => void;
}

function formatBytes(bytes: number, decimals = 1) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDate(ms: number) {
  if (!ms) return '-';
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getFileIcon(item: SftpFileItem) {
  if (item.type === 'directory') {
    return <Folder className="w-4 h-4 text-amber-400 shrink-0" />;
  }
  const ext = item.name.split('.').pop()?.toLowerCase();
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'sql', 'py', 'go', 'rs', 'php', 'html', 'css', 'yml', 'yaml', 'toml', 'env'].includes(ext || '')) {
    return <FileCode className="w-4 h-4 text-purple-400 shrink-0" />;
  }
  if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar'].includes(ext || '')) {
    return <FileArchive className="w-4 h-4 text-rose-400 shrink-0" />;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext || '')) {
    return <Image className="w-4 h-4 text-emerald-400 shrink-0" />;
  }
  if (['log', 'txt', 'md', 'conf', 'cfg', 'ini'].includes(ext || '')) {
    return <FileText className="w-4 h-4 text-sky-400 shrink-0" />;
  }
  return <File className="w-4 h-4 text-zinc-400 shrink-0" />;
}

export const SftpExplorerView: React.FC<SftpExplorerViewProps> = ({
  tabId,
  connectionId,
  connection,
  sshConfig,
  initialPath = '.',
  defaultShowHidden = false,
  onOpenSshTab,
}) => {
  const [currentPath, setCurrentPath] = useState<string>(initialPath);
  const [pathInput, setPathInput] = useState<string>(initialPath);
  const [items, setItems] = useState<SftpFileItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [showHidden, setShowHidden] = useState<boolean>(defaultShowHidden);

  // Sync defaultShowHidden prop when changed externally in Settings
  useEffect(() => {
    setShowHidden(defaultShowHidden);
  }, [defaultShowHidden]);

  // Modals state
  const [editorFile, setEditorFile] = useState<{ path: string; name: string; content: string } | null>(null);
  const [editorLoading, setEditorLoading] = useState<boolean>(false);
  const [editorSaving, setEditorSaving] = useState<boolean>(false);

  const [promptModal, setPromptModal] = useState<{
    type: 'mkdir' | 'touch' | 'rename' | 'chmod';
    title: string;
    value: string;
    targetItem?: SftpFileItem;
  } | null>(null);

  const [transferToast, setTransferToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Compute active SSH configuration
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

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setTransferToast({ message, type });
    setTimeout(() => setTransferToast(null), 4000);
  };

  const loadDirectory = useCallback(async (targetPath: string) => {
    if (!connectionId && !resolvedConfig) {
      setLoading(false);
      setErrorMsg('No SSH server selected. Please select a saved SSH server from the left sidebar.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/sftp/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          config: resolvedConfig,
          path: targetPath,
        }),
      });

      const data = await res.json();
      if (res.ok && data.items) {
        setItems(data.items);
        setCurrentPath(data.currentPath);
        setPathInput(data.currentPath);
      } else {
        setErrorMsg(data.error || 'Failed to list directory');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Connection failed');
    } finally {
      setLoading(false);
    }
  }, [connectionId, resolvedConfig]);

  useEffect(() => {
    loadDirectory(initialPath);
  }, [loadDirectory, initialPath]);

  const handleNavigate = (path: string) => {
    loadDirectory(path);
  };

  const handleGoUp = () => {
    if (currentPath === '/' || currentPath === '') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parent = '/' + parts.join('/');
    loadDirectory(parent);
  };

  const handleOpenFile = async (item: SftpFileItem) => {
    if (item.type === 'directory') {
      handleNavigate(item.path);
      return;
    }

    // Open file editor for text files
    setEditorLoading(true);
    setEditorFile({ path: item.path, name: item.name, content: '' });
    try {
      const res = await fetch('/api/sftp/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          config: resolvedConfig,
          path: item.path,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditorFile({ path: item.path, name: item.name, content: data.content });
      } else {
        showToast(data.error || 'Failed to open file for editing', 'error');
        setEditorFile(null);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to read file', 'error');
      setEditorFile(null);
    } finally {
      setEditorLoading(false);
    }
  };

  const handleSaveEditor = async () => {
    if (!editorFile) return;
    setEditorSaving(true);
    try {
      const res = await fetch('/api/sftp/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          config: resolvedConfig,
          path: editorFile.path,
          content: editorFile.content,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Saved ${editorFile.name}`, 'success');
        setEditorFile(null);
        loadDirectory(currentPath);
      } else {
        showToast(data.error || 'Failed to save file', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to save file', 'error');
    } finally {
      setEditorSaving(false);
    }
  };

  const handleDownload = (item: SftpFileItem) => {
    showToast(`Downloading ${item.name}...`, 'info');
    const url = `/api/sftp/download?connectionId=${encodeURIComponent(connectionId || '')}&path=${encodeURIComponent(item.path)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDelete = async (item: SftpFileItem) => {
    if (!window.confirm(`Are you sure you want to permanently delete "${item.name}"?`)) return;
    try {
      const res = await fetch('/api/sftp/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          config: resolvedConfig,
          path: item.path,
          isDir: item.type === 'directory',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Deleted ${item.name}`, 'success');
        loadDirectory(currentPath);
      } else {
        showToast(data.error || 'Failed to delete item', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to delete item', 'error');
    }
  };

  const handlePromptSubmit = async () => {
    if (!promptModal || !promptModal.value.trim()) return;
    const { type, value, targetItem } = promptModal;
    setPromptModal(null);

    try {
      if (type === 'mkdir') {
        const dest = currentPath.endsWith('/') ? `${currentPath}${value}` : `${currentPath}/${value}`;
        const res = await fetch('/api/sftp/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, config: resolvedConfig, path: dest }),
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`Created folder "${value}"`, 'success');
          loadDirectory(currentPath);
        } else showToast(data.error || 'Failed to create folder', 'error');
      } else if (type === 'touch') {
        const dest = currentPath.endsWith('/') ? `${currentPath}${value}` : `${currentPath}/${value}`;
        const res = await fetch('/api/sftp/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, config: resolvedConfig, path: dest, content: '' }),
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`Created file "${value}"`, 'success');
          loadDirectory(currentPath);
        } else showToast(data.error || 'Failed to create file', 'error');
      } else if (type === 'rename' && targetItem) {
        const parts = targetItem.path.split('/');
        parts.pop();
        const newPath = [...parts, value].join('/');
        const res = await fetch('/api/sftp/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, config: resolvedConfig, oldPath: targetItem.path, newPath }),
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`Renamed to "${value}"`, 'success');
          loadDirectory(currentPath);
        } else showToast(data.error || 'Failed to rename item', 'error');
      } else if (type === 'chmod' && targetItem) {
        const res = await fetch('/api/sftp/chmod', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, config: resolvedConfig, path: targetItem.path, mode: value }),
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`Updated permissions for "${targetItem.name}"`, 'success');
          loadDirectory(currentPath);
        } else showToast(data.error || 'Failed to update permissions', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Operation failed', 'error');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const destPath = currentPath.endsWith('/') ? `${currentPath}${file.name}` : `${currentPath}/${file.name}`;
      showToast(`Uploading ${file.name} (${formatBytes(file.size)})...`, 'info');

      try {
        const arrayBuf = await file.arrayBuffer();
        const res = await fetch('/api/sftp/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-connection-id': connectionId || '',
            'x-dest-path': encodeURIComponent(destPath),
          },
          body: arrayBuf,
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`Uploaded ${file.name} successfully`, 'success');
        } else {
          showToast(data.error || `Failed to upload ${file.name}`, 'error');
        }
      } catch (err: any) {
        showToast(err.message || `Upload failed for ${file.name}`, 'error');
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
    loadDirectory(currentPath);
  };

  // Filter items
  const filteredItems = items.filter((item) => {
    if (!showHidden && item.name.startsWith('.')) return false;
    if (searchFilter && !item.name.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden select-none">
      {/* Top Toolbar */}
      <div className="h-10 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between px-3 select-none shrink-0 gap-2">
        {/* Left: Host Info & Breadcrumb Bar */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Folder className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="text-xs font-semibold text-zinc-300 shrink-0">{hostDisplay}</span>

          <div className="h-4 w-px bg-zinc-800 mx-1 shrink-0" />

          {/* Nav Controls */}
          <button
            onClick={handleGoUp}
            disabled={currentPath === '/' || currentPath === ''}
            title="Go to Parent Directory"
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 transition-colors shrink-0"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleNavigate('.')}
            title="Go to Home Directory (~)"
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors shrink-0"
          >
            <Home className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => loadDirectory(currentPath)}
            disabled={loading}
            title="Refresh Directory"
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 transition-colors shrink-0"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>

          {/* Breadcrumb / Path Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleNavigate(pathInput);
            }}
            className="flex-1 flex items-center bg-zinc-950/80 border border-zinc-800 rounded px-2 py-0.5 min-w-[200px] max-w-xl text-xs"
          >
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="/remote/path"
              className="w-full bg-transparent border-none text-zinc-200 outline-none font-mono text-[11px]"
            />
          </form>
        </div>

        {/* Right: Actions (Upload, New Folder, New File, SSH Switch) */}
        <div className="flex items-center gap-1 shrink-0">
          {/* New Folder */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPromptModal({ type: 'mkdir', title: 'New Folder Name', value: 'new-folder' })}
            className="h-7 text-xs gap-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
            title="Create Directory"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Folder</span>
          </Button>

          {/* New File */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPromptModal({ type: 'touch', title: 'New File Name', value: 'untitled.txt' })}
            className="h-7 text-xs gap-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
            title="Create Empty File"
          >
            <FilePlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">File</span>
          </Button>

          {/* Upload File */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="h-7 text-xs gap-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
            title="Upload Files to Remote Folder"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Upload</span>
          </Button>

          {/* Toggle Hidden Files */}
          <button
            onClick={() => setShowHidden(!showHidden)}
            title={showHidden ? 'Hide dotfiles' : 'Show hidden dotfiles'}
            className={cn(
              'p-1.5 rounded text-xs transition-colors',
              showHidden ? 'bg-zinc-800 text-yellow-400 font-bold' : 'text-zinc-400 hover:text-zinc-200'
            )}
          >
            .*
          </button>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="h-8 bg-zinc-950/70 border-b border-zinc-800/80 flex items-center justify-between px-3 text-xs shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter files..."
            className="bg-transparent border-none text-zinc-300 outline-none text-xs w-64 placeholder:text-zinc-600"
          />
        </div>
        <div className="text-[11px] text-zinc-500">
          {filteredItems.length} items {searchFilter ? `(filtered from ${items.length})` : ''}
        </div>
      </div>

      {/* Main File Table Area */}
      <div className="flex-1 w-full overflow-y-auto overflow-x-auto select-text relative">
        {loading && (
          <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center z-10">
            <div className="flex items-center gap-2 px-4 py-2 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
              <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
              <span>Loading remote files...</span>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="m-4 p-4 rounded-lg bg-rose-950/30 border border-rose-800/60 text-rose-300 text-xs flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold mb-1">Failed to list directory</div>
              <div className="font-mono text-zinc-400">{errorMsg}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadDirectory(currentPath)}
                className="mt-3 h-7 text-xs border-rose-800 text-rose-200 hover:bg-rose-950"
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-zinc-800/80 bg-zinc-900/40 text-zinc-400 text-[11px] font-medium sticky top-0 select-none">
              <th className="py-2 px-3">Name</th>
              <th className="py-2 px-3 w-28">Size</th>
              <th className="py-2 px-3 w-32 font-mono">Permissions</th>
              <th className="py-2 px-3 w-40">Modified</th>
              <th className="py-2 px-3 w-28 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {currentPath !== '/' && currentPath !== '' && (
              <tr
                onClick={handleGoUp}
                className="hover:bg-zinc-900/60 cursor-pointer text-zinc-400 group"
              >
                <td className="py-1.5 px-3 flex items-center gap-2">
                  <Folder className="w-4 h-4 text-amber-500/80 shrink-0" />
                  <span className="font-medium text-zinc-400 group-hover:text-zinc-200 font-mono">..</span>
                </td>
                <td className="py-1.5 px-3 text-zinc-600 font-mono">--</td>
                <td className="py-1.5 px-3 text-zinc-600 font-mono">drwxr-xr-x</td>
                <td className="py-1.5 px-3 text-zinc-600">--</td>
                <td className="py-1.5 px-3 text-right"></td>
              </tr>
            )}

            {filteredItems.map((item) => (
              <tr
                key={item.path}
                onDoubleClick={() => handleOpenFile(item)}
                className="hover:bg-zinc-900/70 transition-colors group cursor-pointer text-zinc-300"
              >
                <td className="py-1.5 px-3 flex items-center gap-2 truncate">
                  {getFileIcon(item)}
                  <span
                    onClick={() => handleOpenFile(item)}
                    className={cn(
                      'truncate hover:underline',
                      item.type === 'directory' ? 'text-zinc-100 font-medium' : 'text-zinc-300'
                    )}
                  >
                    {item.name}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-zinc-400 font-mono text-[11px]">
                  {item.type === 'directory' ? '--' : formatBytes(item.size)}
                </td>
                <td
                  onClick={(e) => {
                    e.stopPropagation();
                    setPromptModal({
                      type: 'chmod',
                      title: `Change Permissions: ${item.name}`,
                      value: (item.mode & 0o777).toString(8),
                      targetItem: item,
                    });
                  }}
                  title="Click to modify chmod permissions"
                  className="py-1.5 px-3 font-mono text-zinc-400 hover:text-yellow-400 hover:underline cursor-pointer text-[11px]"
                >
                  {item.permissions}
                </td>
                <td className="py-1.5 px-3 text-zinc-400 text-[11px] truncate">
                  {formatDate(item.mtime)}
                </td>
                <td className="py-1.5 px-3 text-right shrink-0">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {item.type === 'file' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFile(item);
                        }}
                        title="Edit / View File"
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {item.type === 'file' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(item);
                        }}
                        title="Download File"
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPromptModal({
                          type: 'rename',
                          title: `Rename "${item.name}"`,
                          value: item.name,
                          targetItem: item,
                        });
                      }}
                      title="Rename"
                      className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                      title="Delete"
                      className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && filteredItems.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-zinc-500">
                  This directory is empty
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Toast Notification */}
      {transferToast && (
        <div className="absolute bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg border text-xs bg-zinc-900 border-zinc-700 text-zinc-100 animate-in fade-in slide-in-from-bottom-2">
          {transferToast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          {transferToast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
          {transferToast.type === 'info' && <RefreshCw className="w-4 h-4 text-sky-400 animate-spin" />}
          <span>{transferToast.message}</span>
        </div>
      )}

      {/* Simple Prompt Modal (New Folder / New File / Rename / Chmod) */}
      {promptModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm font-semibold text-zinc-100">
              <span>{promptModal.title}</span>
              <button
                onClick={() => setPromptModal(null)}
                className="p-1 rounded text-zinc-400 hover:text-zinc-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={promptModal.value}
              onChange={(e) => setPromptModal({ ...promptModal, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePromptSubmit();
                if (e.key === 'Escape') setPromptModal(null);
              }}
              className="w-full px-3 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs font-mono outline-none focus:border-yellow-400"
            />
            {promptModal.type === 'chmod' && (
              <span className="text-[10px] text-zinc-500">
                Octal format, e.g. 755 (rwxr-xr-x) or 644 (rw-r--r--)
              </span>
            )}
            <div className="flex justify-end gap-2 mt-1">
              <Button variant="ghost" size="sm" onClick={() => setPromptModal(null)} className="h-7 text-xs">
                Cancel
              </Button>
              <Button size="sm" onClick={handlePromptSubmit} className="h-7 text-xs bg-yellow-400 hover:bg-yellow-500 text-black font-semibold">
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Remote File Editor Modal */}
      {editorFile && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[85vh] rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl flex flex-col overflow-hidden">
            {/* Editor Header */}
            <div className="h-10 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between px-4 select-none shrink-0">
              <div className="flex items-center gap-2 truncate">
                <FileCode className="w-4 h-4 text-purple-400 shrink-0" />
                <span className="text-xs font-semibold text-zinc-200 truncate">{editorFile.name}</span>
                <span className="text-[10px] text-zinc-500 font-mono truncate">({editorFile.path})</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  disabled={editorSaving || editorLoading}
                  onClick={handleSaveEditor}
                  className="h-7 text-xs gap-1.5 bg-yellow-400 hover:bg-yellow-500 text-black font-semibold"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{editorSaving ? 'Saving...' : 'Save File'}</span>
                </Button>
                <button
                  onClick={() => setEditorFile(null)}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Editor Content Body */}
            <div className="flex-1 w-full p-2 bg-zinc-950 relative overflow-hidden flex flex-col">
              {editorLoading ? (
                <div className="flex-1 flex items-center justify-center text-xs text-zinc-400 gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-yellow-400" />
                  <span>Loading remote file content...</span>
                </div>
              ) : (
                <textarea
                  value={editorFile.content}
                  onChange={(e) => setEditorFile({ ...editorFile, content: e.target.value })}
                  className="flex-1 w-full h-full bg-zinc-950 text-zinc-200 font-mono text-xs p-3 border-none outline-none resize-none leading-relaxed"
                  spellCheck={false}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
