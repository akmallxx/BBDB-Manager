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
  Eye,
  Save,
  X,
  AlertCircle,
  CheckCircle2,
  Home,
  Search,
  ArrowRight,
  ArrowLeft,
  Monitor,
  Server,
  Columns,
  Square,
  CheckSquare,
  ArrowRightLeft,
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

interface TransferProgressInfo {
  direction: 'to-remote' | 'to-local';
  file: string;
  itemIndex: number;
  totalItems: number;
  transferredBytes: number;
  totalBytes: number;
  percent: number;
  speedBytesPerSec: number;
}

function formatBytes(bytes: number, decimals = 1) {
  if (!bytes || bytes <= 0 || !isFinite(bytes)) return '0 B';
  const k = 1024;
  const dm = Math.max(0, decimals);
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  if (i < 0) return `${bytes.toFixed(dm)} B`;
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec: number) {
  if (bytesPerSec <= 0 || !isFinite(bytesPerSec)) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
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
  // Dual-Pane toggle
  const [isDualPane, setIsDualPane] = useState<boolean>(true);

  // Remote SFTP State
  const [currentPath, setCurrentPath] = useState<string>(initialPath);
  const [pathInput, setPathInput] = useState<string>(initialPath);
  const [items, setItems] = useState<SftpFileItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [selectedRemotePaths, setSelectedRemotePaths] = useState<Set<string>>(new Set());

  // Local Filesystem State
  const [localCurrentPath, setLocalCurrentPath] = useState<string>('');
  const [localPathInput, setLocalPathInput] = useState<string>('');
  const [localItems, setLocalItems] = useState<SftpFileItem[]>([]);
  const [localLoading, setLocalLoading] = useState<boolean>(true);
  const [localErrorMsg, setLocalErrorMsg] = useState<string | null>(null);
  const [localSearchFilter, setLocalSearchFilter] = useState<string>('');
  const [selectedLocalPaths, setSelectedLocalPaths] = useState<Set<string>>(new Set());

  // Transfer & Drag State
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [transferProgress, setTransferProgress] = useState<TransferProgressInfo | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<'local' | 'remote' | null>(null);
  const [showHidden, setShowHidden] = useState<boolean>(defaultShowHidden);

  // Modals state
  const [editorFile, setEditorFile] = useState<{ target: 'local' | 'remote'; path: string; name: string; content: string } | null>(null);
  const [editorLoading, setEditorLoading] = useState<boolean>(false);
  const [editorSaving, setEditorSaving] = useState<boolean>(false);

  const [promptModal, setPromptModal] = useState<{
    target: 'local' | 'remote';
    type: 'mkdir' | 'touch' | 'rename' | 'chmod';
    title: string;
    value: string;
    targetItem?: SftpFileItem;
  } | null>(null);

  const [transferToast, setTransferToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transferAbortControllerRef = useRef<AbortController | null>(null);

  // Abort active transfers on component unmount to prevent leaks
  useEffect(() => {
    return () => {
      if (transferAbortControllerRef.current) {
        transferAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Sync defaultShowHidden prop when changed externally in Settings
  useEffect(() => {
    setShowHidden(defaultShowHidden);
  }, [defaultShowHidden]);

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

  // --- Remote Directory Operations ---
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
        setSelectedRemotePaths(new Set());
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

  // --- Local Directory Operations ---
  const loadLocalDirectory = useCallback(async (targetPath?: string) => {
    setLocalLoading(true);
    setLocalErrorMsg(null);
    try {
      const res = await fetch('/api/local/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      });

      const data = await res.json();
      if (res.ok && data.items) {
        setLocalItems(data.items);
        setLocalCurrentPath(data.currentPath);
        setLocalPathInput(data.currentPath);
        setSelectedLocalPaths(new Set());
      } else {
        setLocalErrorMsg(data.error || 'Failed to list local directory');
      }
    } catch (err: any) {
      setLocalErrorMsg(err.message || 'Failed to load local directory');
    } finally {
      setLocalLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLocalDirectory();
  }, [loadLocalDirectory]);

  // --- Navigations ---
  const handleRemoteNavigate = (path: string) => {
    loadDirectory(path);
  };

  const handleRemoteGoUp = () => {
    if (currentPath === '/' || currentPath === '') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parent = '/' + parts.join('/');
    loadDirectory(parent);
  };

  const handleLocalNavigate = (path: string) => {
    loadLocalDirectory(path);
  };

  const handleLocalGoUp = () => {
    if (localCurrentPath === '/' || localCurrentPath === '') return;
    const parts = localCurrentPath.split('/').filter(Boolean);
    parts.pop();
    const parent = '/' + parts.join('/');
    loadLocalDirectory(parent || '/');
  };

  // --- Direct Streaming Transfers (Local <-> Remote) with Real-Time Progress ---
  const executeTransfer = async (direction: 'to-remote' | 'to-local', paths?: string[]) => {
    const toTransfer = paths || Array.from(direction === 'to-remote' ? selectedLocalPaths : selectedRemotePaths);
    if (toTransfer.length === 0) {
      showToast(`Select ${direction === 'to-remote' ? 'local' : 'remote'} file(s) or folder(s) to transfer`, 'info');
      return;
    }

    const firstItemName = toTransfer[0]?.split('/').filter(Boolean).pop() || 'item';
    const targetDir = direction === 'to-remote' ? currentPath : localCurrentPath;

    // Set up abort controller for this transfer session
    if (transferAbortControllerRef.current) {
      transferAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    transferAbortControllerRef.current = controller;

    setIsTransferring(true);
    setTransferProgress({
      direction,
      file: firstItemName,
      itemIndex: 1,
      totalItems: toTransfer.length,
      transferredBytes: 0,
      totalBytes: 0,
      percent: 0,
      speedBytesPerSec: 0,
    });

    try {
      const res = await fetch('/api/sftp/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          direction,
          sourcePaths: toTransfer,
          targetDir,
          connectionId,
          config: resolvedConfig,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errMsg = 'Transfer request failed';
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        // Fallback for non-streaming responses
        const data = await res.json();
        if (data.success) {
          showToast(data.message || `Transferred ${toTransfer.length} item(s)`, 'success');
        } else {
          showToast(data.error || (data.errors ? data.errors.join(', ') : 'Transfer failed'), 'error');
        }
      } else {
        const decoder = new TextDecoder();
        let buffer = '';
        let lastTransferred = 0;
        let lastTime = Date.now();
        let currentSpeed = 0;
        let lastFileName = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() || '';

            for (const block of blocks) {
              const trimmed = block.trim();
              if (!trimmed.startsWith('data:')) continue;
              const jsonStr = trimmed.slice(5).trim();
              if (!jsonStr) continue;

              let ev: any;
              try {
                ev = JSON.parse(jsonStr);
              } catch (pErr) {
                console.warn('[SFTP Progress Stream Parse Warning]', pErr);
                continue;
              }

              if (ev.type === 'item_start') {
                lastTransferred = 0;
                lastTime = Date.now();
                currentSpeed = 0;
                lastFileName = ev.file;
                setTransferProgress({
                  direction,
                  file: ev.file,
                  itemIndex: ev.itemIndex,
                  totalItems: ev.totalItems,
                  transferredBytes: 0,
                  totalBytes: 0,
                  percent: 0,
                  speedBytesPerSec: 0,
                });
              } else if (ev.type === 'progress') {
                // If child file changed in a directory transfer, reset speed baseline
                if (ev.file && ev.file !== lastFileName) {
                  lastTransferred = 0;
                  lastTime = Date.now();
                  currentSpeed = 0;
                  lastFileName = ev.file;
                }

                const now = Date.now();
                const timeDiff = (now - lastTime) / 1000;
                if (timeDiff >= 0.3) {
                  const bytesDiff = ev.transferred - lastTransferred;
                  if (bytesDiff >= 0) {
                    currentSpeed = bytesDiff / timeDiff;
                  }
                  lastTransferred = ev.transferred;
                  lastTime = now;
                }

                setTransferProgress({
                  direction,
                  file: ev.file,
                  itemIndex: ev.itemIndex,
                  totalItems: ev.totalItems,
                  transferredBytes: ev.transferred,
                  totalBytes: ev.total,
                  percent: ev.percent,
                  speedBytesPerSec: currentSpeed,
                });
              } else if (ev.type === 'item_error') {
                showToast(`Failed transferring "${ev.file}": ${ev.error}`, 'error');
              } else if (ev.type === 'done') {
                if (ev.success) {
                  showToast(ev.message || `Transferred ${toTransfer.length} item(s)`, 'success');
                } else {
                  showToast(ev.error || (ev.errors ? ev.errors.join(', ') : 'Transfer completed with errors'), 'error');
                }
              } else if (ev.type === 'error') {
                throw new Error(ev.error);
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      }

      // Clear selections and refresh views
      if (direction === 'to-remote') {
        setSelectedLocalPaths(new Set());
        loadDirectory(currentPath);
      } else {
        setSelectedRemotePaths(new Set());
        loadLocalDirectory(localCurrentPath);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Abort handling is either managed by handleCancelTransfer or component unmount.
        return;
      }
      showToast(err.message || 'Transfer failed', 'error');
      if (direction === 'to-remote') loadDirectory(currentPath);
      else loadLocalDirectory(localCurrentPath);
    } finally {
      if (transferAbortControllerRef.current === controller) {
        transferAbortControllerRef.current = null;
      }
      setIsTransferring(false);
      setTransferProgress(null);
    }
  };

  const handleTransferToRemote = (paths?: string[]) => executeTransfer('to-remote', paths);
  const handleTransferToLocal = (paths?: string[]) => executeTransfer('to-local', paths);

  const handleCancelTransfer = useCallback(() => {
    if (transferAbortControllerRef.current) {
      transferAbortControllerRef.current.abort();
      transferAbortControllerRef.current = null;
    }
    setIsTransferring(false);
    setTransferProgress(null);
    showToast('Transfer cancelled by user', 'info');
    loadDirectory(currentPath);
    if (isDualPane) loadLocalDirectory(localCurrentPath);
  }, [currentPath, isDualPane, localCurrentPath, loadDirectory, loadLocalDirectory]);

  // Escape key cancels active transfer when no modal or text input is focused
  useEffect(() => {
    if (!isTransferring) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInputFocused =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement;
      if (e.key === 'Escape' && !promptModal && !editorFile && !isInputFocused) {
        e.preventDefault();
        handleCancelTransfer();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTransferring, promptModal, editorFile, handleCancelTransfer]);

  // --- File Editor ---
  const handleOpenFile = async (item: SftpFileItem, target: 'local' | 'remote') => {
    if (item.type === 'directory') {
      if (target === 'remote') handleRemoteNavigate(item.path);
      else handleLocalNavigate(item.path);
      return;
    }

    if (target === 'remote') {
      setEditorLoading(true);
      setEditorFile({ target: 'remote', path: item.path, name: item.name, content: '' });
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
          setEditorFile({ target: 'remote', path: item.path, name: item.name, content: data.content });
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
    } else {
      // Local file preview - simple notification or prompt
      showToast(`Selected local file: ${item.name}`, 'info');
    }
  };

  const handleSaveEditor = async () => {
    if (!editorFile || editorFile.target !== 'remote') return;
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

  // --- Deletion & Management ---
  const handleDeleteRemote = async (item: SftpFileItem) => {
    if (!window.confirm(`Are you sure you want to permanently delete remote "${item.name}"?`)) return;
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

  const handleDeleteLocal = async (item: SftpFileItem) => {
    if (!window.confirm(`Are you sure you want to delete local "${item.name}"?`)) return;
    try {
      const res = await fetch('/api/local/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: item.path }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Deleted ${item.name}`, 'success');
        loadLocalDirectory(localCurrentPath);
      } else {
        showToast(data.error || 'Failed to delete local item', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to delete local item', 'error');
    }
  };

  // --- Prompt Modal (mkdir, rename, chmod, touch) ---
  const handlePromptSubmit = async () => {
    if (!promptModal || !promptModal.value.trim()) return;
    const { target, type, value, targetItem } = promptModal;
    setPromptModal(null);

    try {
      if (target === 'remote') {
        if (type === 'mkdir') {
          const dest = currentPath.endsWith('/') ? `${currentPath}${value}` : `${currentPath}/${value}`;
          const res = await fetch('/api/sftp/mkdir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectionId, config: resolvedConfig, path: dest }),
          });
          const data = await res.json();
          if (res.ok) {
            showToast(`Created remote folder "${value}"`, 'success');
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
            showToast(`Created remote file "${value}"`, 'success');
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
      } else {
        // Target: local
        if (type === 'mkdir') {
          const dest = `${localCurrentPath}/${value}`;
          const res = await fetch('/api/local/mkdir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dest }),
          });
          const data = await res.json();
          if (res.ok) {
            showToast(`Created local folder "${value}"`, 'success');
            loadLocalDirectory(localCurrentPath);
          } else showToast(data.error || 'Failed to create local folder', 'error');
        } else if (type === 'rename' && targetItem) {
          const parts = targetItem.path.split('/');
          parts.pop();
          const newPath = [...parts, value].join('/');
          const res = await fetch('/api/local/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPath: targetItem.path, newPath }),
          });
          const data = await res.json();
          if (res.ok) {
            showToast(`Renamed local item to "${value}"`, 'success');
            loadLocalDirectory(localCurrentPath);
          } else showToast(data.error || 'Failed to rename local item', 'error');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Operation failed', 'error');
    }
  };

  // --- Browser Upload Fallback (from browser file dialog) ---
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

  // --- Filtering ---
  const filteredRemoteItems = useMemo(() => {
    return items.filter((item) => {
      if (!showHidden && item.name.startsWith('.')) return false;
      if (searchFilter && !item.name.toLowerCase().includes(searchFilter.toLowerCase())) return false;
      return true;
    });
  }, [items, showHidden, searchFilter]);

  const filteredLocalItems = useMemo(() => {
    return localItems.filter((item) => {
      if (!showHidden && item.name.startsWith('.')) return false;
      if (localSearchFilter && !item.name.toLowerCase().includes(localSearchFilter.toLowerCase())) return false;
      return true;
    });
  }, [localItems, showHidden, localSearchFilter]);

  // Selection helpers
  const toggleSelectLocal = (path: string) => {
    setSelectedLocalPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleSelectAllLocal = () => {
    if (selectedLocalPaths.size === filteredLocalItems.length && filteredLocalItems.length > 0) {
      setSelectedLocalPaths(new Set());
    } else {
      setSelectedLocalPaths(new Set(filteredLocalItems.map(i => i.path)));
    }
  };

  const toggleSelectRemote = (path: string) => {
    setSelectedRemotePaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleSelectAllRemote = () => {
    if (selectedRemotePaths.size === filteredRemoteItems.length && filteredRemoteItems.length > 0) {
      setSelectedRemotePaths(new Set());
    } else {
      setSelectedRemotePaths(new Set(filteredRemoteItems.map(i => i.path)));
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 overflow-hidden select-none relative">
      {/* Top Main Toolbar */}
      <div className="h-10 bg-zinc-900/90 border-b border-zinc-800 flex items-center justify-between px-3 select-none shrink-0 gap-2">
        {/* Left: View Mode Toggle & Server Info */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded p-0.5 shrink-0">
            <button
              onClick={() => setIsDualPane(true)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                isDualPane ? 'bg-zinc-800 text-yellow-400 font-semibold shadow-xs' : 'text-zinc-400 hover:text-zinc-200'
              )}
              title="Dual-Pane View: Local Machine & Remote Server Side-by-Side"
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Side-by-Side</span>
            </button>
            <button
              onClick={() => setIsDualPane(false)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
                !isDualPane ? 'bg-zinc-800 text-yellow-400 font-semibold shadow-xs' : 'text-zinc-400 hover:text-zinc-200'
              )}
              title="Single-Pane View: Remote Server Only"
            >
              <Server className="w-3.5 h-3.5" />
              <span>Remote Only</span>
            </button>
          </div>

          <div className="h-4 w-px bg-zinc-800 mx-1 shrink-0" />

          {/* Connected Host Indicator */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-300 truncate">
            <Server className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="font-semibold truncate">{hostDisplay}</span>
          </div>
        </div>

        {/* Right: Quick Global Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Refresh Both */}
          <button
            onClick={() => {
              loadDirectory(currentPath);
              if (isDualPane) loadLocalDirectory(localCurrentPath);
            }}
            disabled={loading || localLoading}
            title="Refresh All Panes"
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', (loading || localLoading) && 'animate-spin')} />
          </button>

          {/* Toggle Hidden Files */}
          <button
            onClick={() => setShowHidden(!showHidden)}
            title={showHidden ? 'Hide hidden dotfiles' : 'Show hidden dotfiles (.*)'}
            className={cn(
              'px-2 py-1 rounded text-xs transition-colors border',
              showHidden
                ? 'bg-zinc-800 border-zinc-700 text-yellow-400 font-bold'
                : 'bg-transparent border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            )}
          >
            .*
          </button>

          {/* Open SSH Terminal if callback provided */}
          {onOpenSshTab && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenSshTab(connectionId, resolvedConfig || undefined)}
              className="h-7 text-xs gap-1 border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
              title="Open SSH Terminal for this server"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Terminal</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Panes Container */}
      <div className="flex-1 flex flex-row w-full overflow-hidden relative">
        {/* ================= LEFT PANE: LOCAL MACHINE ================= */}
        {isDualPane && (
          <div
            className={cn(
              'flex-1 flex flex-col h-full border-r border-zinc-800 bg-zinc-950/60 min-w-[280px] relative transition-colors',
              dragOverTarget === 'local' && 'ring-2 ring-inset ring-sky-500/60 bg-sky-950/10'
            )}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              if (dragOverTarget !== 'local') setDragOverTarget('local');
            }}
            onDragLeave={() => setDragOverTarget(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverTarget(null);
              try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                if (data.source === 'remote' && Array.isArray(data.paths)) {
                  handleTransferToLocal(data.paths);
                }
              } catch {
                // Ignore invalid drag payload
              }
            }}
          >
            {/* Local Pane Header / Nav */}
            <div className="h-9 bg-zinc-900/70 border-b border-zinc-800/90 flex items-center justify-between px-2.5 gap-2 shrink-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <Monitor className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-[11px] font-semibold text-zinc-200 shrink-0">Local Machine</span>

                <div className="h-3.5 w-px bg-zinc-800 mx-1 shrink-0" />

                <button
                  onClick={handleLocalGoUp}
                  disabled={localCurrentPath === '/' || localCurrentPath === ''}
                  title="Up Directory"
                  className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 transition-colors shrink-0"
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => loadLocalDirectory()}
                  title="User Home Directory"
                  className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors shrink-0"
                >
                  <Home className="w-3 h-3" />
                </button>
                <button
                  onClick={() => loadLocalDirectory(localCurrentPath)}
                  disabled={localLoading}
                  title="Refresh Local Files"
                  className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 transition-colors shrink-0"
                >
                  <RefreshCw className={cn('w-3 h-3', localLoading && 'animate-spin')} />
                </button>

                {/* Local Path Input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleLocalNavigate(localPathInput);
                  }}
                  className="flex-1 flex items-center bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-xs min-w-[80px]"
                >
                  <input
                    type="text"
                    value={localPathInput}
                    onChange={(e) => setLocalPathInput(e.target.value)}
                    placeholder="/local/path"
                    className="w-full bg-transparent border-none text-zinc-200 outline-none font-mono text-[10px]"
                  />
                </form>
              </div>

              {/* Local Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPromptModal({ target: 'local', type: 'mkdir', title: 'New Local Folder', value: 'new-folder' })}
                  className="h-6 px-1.5 text-[11px] gap-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
                  title="Create Local Folder"
                >
                  <FolderPlus className="w-3 h-3 text-amber-400" />
                </Button>
              </div>
            </div>

            {/* Local Search & Counter Bar */}
            <div className="h-7 bg-zinc-950/80 border-b border-zinc-800/60 flex items-center justify-between px-2.5 text-xs shrink-0">
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <Search className="w-3 h-3 text-zinc-500 shrink-0" />
                <input
                  type="text"
                  value={localSearchFilter}
                  onChange={(e) => setLocalSearchFilter(e.target.value)}
                  placeholder="Filter local files..."
                  className="bg-transparent border-none text-zinc-300 outline-none text-[11px] w-full placeholder:text-zinc-600"
                />
              </div>
              <div className="text-[10px] text-zinc-500 shrink-0">
                {selectedLocalPaths.size > 0 ? (
                  <span className="text-yellow-400 font-semibold">{selectedLocalPaths.size} selected</span>
                ) : (
                  `${filteredLocalItems.length} items`
                )}
              </div>
            </div>

            {/* Local File Table */}
            <div className="flex-1 w-full overflow-y-auto overflow-x-auto select-text relative">
              {localLoading && (
                <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center z-10">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    <span>Loading local files...</span>
                  </div>
                </div>
              )}

              {localErrorMsg && (
                <div className="m-3 p-3 rounded bg-rose-950/30 border border-rose-800/60 text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Local access error</div>
                    <div className="font-mono text-[10px] text-zinc-400">{localErrorMsg}</div>
                  </div>
                </div>
              )}

              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800/80 bg-zinc-900/40 text-zinc-400 text-[10px] font-medium sticky top-0 select-none">
                    <th className="py-1.5 px-2 w-6 text-center">
                      <button
                        onClick={toggleSelectAllLocal}
                        className="text-zinc-400 hover:text-zinc-100"
                        title="Select All Local Files"
                      >
                        {selectedLocalPaths.size === filteredLocalItems.length && filteredLocalItems.length > 0 ? (
                          <CheckSquare className="w-3.5 h-3.5 text-yellow-400" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </th>
                    <th className="py-1.5 px-2">Name</th>
                    <th className="py-1.5 px-2 w-20 text-right">Size</th>
                    <th className="py-1.5 px-2 w-24 text-right">Modified</th>
                    <th className="py-1.5 px-2 w-14 text-right">Transfer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {localCurrentPath !== '/' && localCurrentPath !== '' && (
                    <tr
                      onClick={handleLocalGoUp}
                      className="hover:bg-zinc-900/60 cursor-pointer text-zinc-400 group"
                    >
                      <td className="py-1 px-2 text-center text-zinc-600"></td>
                      <td className="py-1 px-2 flex items-center gap-1.5">
                        <Folder className="w-3.5 h-3.5 text-amber-500/80 shrink-0" />
                        <span className="font-medium text-zinc-400 group-hover:text-zinc-200 font-mono text-[11px]">..</span>
                      </td>
                      <td className="py-1 px-2 text-right text-zinc-600 font-mono text-[10px]">--</td>
                      <td className="py-1 px-2 text-right text-zinc-600 text-[10px]">--</td>
                      <td className="py-1 px-2 text-right"></td>
                    </tr>
                  )}

                  {filteredLocalItems.map((item) => {
                    const isSelected = selectedLocalPaths.has(item.path);
                    return (
                      <tr
                        key={item.path}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            'text/plain',
                            JSON.stringify({
                              source: 'local',
                              paths: selectedLocalPaths.has(item.path)
                                ? Array.from(selectedLocalPaths)
                                : [item.path],
                            })
                          );
                        }}
                        onDoubleClick={() => handleOpenFile(item, 'local')}
                        className={cn(
                          'hover:bg-zinc-900/70 transition-colors group cursor-pointer text-zinc-300',
                          isSelected && 'bg-yellow-950/20 text-yellow-200'
                        )}
                      >
                        <td
                          className="py-1 px-2 text-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelectLocal(item.path);
                          }}
                        >
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-yellow-400 inline" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 inline" />
                          )}
                        </td>
                        <td className="py-1 px-2 flex items-center gap-1.5 truncate">
                          {getFileIcon(item)}
                          <span
                            onClick={() => handleOpenFile(item, 'local')}
                            className={cn(
                              'truncate text-[11px] hover:underline',
                              item.type === 'directory' ? 'text-zinc-100 font-medium' : 'text-zinc-300'
                            )}
                          >
                            {item.name}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-right text-zinc-400 font-mono text-[10px]">
                          {item.type === 'directory' ? '--' : formatBytes(item.size)}
                        </td>
                        <td className="py-1 px-2 text-right text-zinc-400 text-[10px] truncate">
                          {formatDate(item.mtime)}
                        </td>
                        <td className="py-1 px-2 text-right shrink-0">
                          <div className="flex items-center justify-end gap-1">
                            {/* Inline Transfer to Remote */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTransferToRemote([item.path]);
                              }}
                              disabled={isTransferring}
                              title="Transfer to Remote Server (➔)"
                              className="p-1 rounded text-zinc-400 hover:text-sky-400 hover:bg-zinc-800 transition-colors"
                            >
                              <ArrowRight className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteLocal(item);
                              }}
                              title="Delete local file"
                              className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {!localLoading && filteredLocalItems.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-zinc-500 text-xs">
                        This local directory is empty
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ================= CENTER ACTION STRIP (TRANSFER CONTROLS) ================= */}
        {isDualPane && (
          <div className="w-11 bg-zinc-900 border-r border-zinc-800 flex flex-col items-center justify-center py-4 gap-3 shrink-0 select-none shadow-xs z-10">
            {/* Transfer Local -> Remote */}
            <button
              onClick={() => handleTransferToRemote()}
              disabled={isTransferring || selectedLocalPaths.size === 0}
              title={
                selectedLocalPaths.size > 0
                  ? `Transfer ${selectedLocalPaths.size} selected item(s) to Remote Server (➔)`
                  : 'Select local item(s) then click to transfer to Remote'
              }
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-all shadow-sm',
                selectedLocalPaths.size > 0
                  ? 'bg-sky-500 text-white hover:bg-sky-400 shadow-sky-500/20 active:scale-95'
                  : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 disabled:opacity-40'
              )}
            >
              <ArrowRight className="w-4 h-4" />
            </button>

            {/* Indicator */}
            <div className="text-[9px] text-zinc-500 font-mono tracking-tighter">
              {isTransferring ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-yellow-400" />
              ) : (
                <ArrowRightLeft className="w-3.5 h-3.5 text-zinc-600" />
              )}
            </div>

            {/* Transfer Remote -> Local */}
            <button
              onClick={() => handleTransferToLocal()}
              disabled={isTransferring || selectedRemotePaths.size === 0}
              title={
                selectedRemotePaths.size > 0
                  ? `Transfer ${selectedRemotePaths.size} selected item(s) to Local Machine (⬅)`
                  : 'Select remote item(s) then click to transfer to Local'
              }
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-all shadow-sm',
                selectedRemotePaths.size > 0
                  ? 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-emerald-500/20 active:scale-95'
                  : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 disabled:opacity-40'
              )}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ================= RIGHT PANE: REMOTE SERVER ================= */}
        <div
          className={cn(
            'flex-1 flex flex-col h-full bg-zinc-950 min-w-[280px] relative transition-colors',
            dragOverTarget === 'remote' && 'ring-2 ring-inset ring-sky-500/60 bg-sky-950/10'
          )}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (dragOverTarget !== 'remote') setDragOverTarget('remote');
          }}
          onDragLeave={() => setDragOverTarget(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverTarget(null);
            try {
              const data = JSON.parse(e.dataTransfer.getData('text/plain'));
              if (data.source === 'local' && Array.isArray(data.paths)) {
                handleTransferToRemote(data.paths);
              }
            } catch {
              // Ignore invalid drag payload
            }
          }}
        >
          {/* Remote Pane Header / Nav */}
          <div className="h-9 bg-zinc-900/70 border-b border-zinc-800/90 flex items-center justify-between px-2.5 gap-2 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <Server className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="text-[11px] font-semibold text-zinc-200 shrink-0">Remote Server</span>

              <div className="h-3.5 w-px bg-zinc-800 mx-1 shrink-0" />

              <button
                onClick={handleRemoteGoUp}
                disabled={currentPath === '/' || currentPath === ''}
                title="Up Directory"
                className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 transition-colors shrink-0"
              >
                <ArrowUp className="w-3 h-3" />
              </button>
              <button
                onClick={() => handleRemoteNavigate('.')}
                title="Remote Home Directory (~)"
                className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors shrink-0"
              >
                <Home className="w-3 h-3" />
              </button>
              <button
                onClick={() => loadDirectory(currentPath)}
                disabled={loading}
                title="Refresh Remote Files"
                className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 transition-colors shrink-0"
              >
                <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
              </button>

              {/* Remote Path Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRemoteNavigate(pathInput);
                }}
                className="flex-1 flex items-center bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-xs min-w-[80px]"
              >
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  placeholder="/remote/path"
                  className="w-full bg-transparent border-none text-zinc-200 outline-none font-mono text-[10px]"
                />
              </form>
            </div>

            {/* Remote Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPromptModal({ target: 'remote', type: 'mkdir', title: 'New Remote Folder', value: 'new-folder' })}
                className="h-6 px-1.5 text-[11px] gap-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
                title="Create Remote Directory"
              >
                <FolderPlus className="w-3 h-3 text-amber-400" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPromptModal({ target: 'remote', type: 'touch', title: 'New Remote File', value: 'untitled.txt' })}
                className="h-6 px-1.5 text-[11px] gap-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
                title="Create Remote File"
              >
                <FilePlus className="w-3 h-3 text-purple-400" />
              </Button>
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
                className="h-6 px-1.5 text-[11px] gap-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
                title="Upload Files from Computer Dialog"
              >
                <Upload className="w-3 h-3 text-sky-400" />
              </Button>
            </div>
          </div>

          {/* Remote Search & Counter Bar */}
          <div className="h-7 bg-zinc-950/80 border-b border-zinc-800/60 flex items-center justify-between px-2.5 text-xs shrink-0">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <Search className="w-3 h-3 text-zinc-500 shrink-0" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter remote files..."
                className="bg-transparent border-none text-zinc-300 outline-none text-[11px] w-full placeholder:text-zinc-600"
              />
            </div>
            <div className="text-[10px] text-zinc-500 shrink-0">
              {selectedRemotePaths.size > 0 ? (
                <span className="text-yellow-400 font-semibold">{selectedRemotePaths.size} selected</span>
              ) : (
                `${filteredRemoteItems.length} items`
              )}
            </div>
          </div>

          {/* Remote File Table */}
          <div className="flex-1 w-full overflow-y-auto overflow-x-auto select-text relative">
            {loading && (
              <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center z-10">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                  <span>Loading remote files...</span>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="m-3 p-3 rounded bg-rose-950/30 border border-rose-800/60 text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Remote directory error</div>
                  <div className="font-mono text-[10px] text-zinc-400">{errorMsg}</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadDirectory(currentPath)}
                    className="mt-2 h-6 text-[11px] border-rose-800 text-rose-200 hover:bg-rose-950"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            )}

            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800/80 bg-zinc-900/40 text-zinc-400 text-[10px] font-medium sticky top-0 select-none">
                  <th className="py-1.5 px-2 w-6 text-center">
                    <button
                      onClick={toggleSelectAllRemote}
                      className="text-zinc-400 hover:text-zinc-100"
                      title="Select All Remote Files"
                    >
                      {selectedRemotePaths.size === filteredRemoteItems.length && filteredRemoteItems.length > 0 ? (
                        <CheckSquare className="w-3.5 h-3.5 text-yellow-400" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </th>
                  <th className="py-1.5 px-2">Name</th>
                  <th className="py-1.5 px-2 w-20 text-right">Size</th>
                  <th className="py-1.5 px-2 w-24 font-mono text-center">Permissions</th>
                  <th className="py-1.5 px-2 w-28 text-right">Modified</th>
                  <th className="py-1.5 px-2 w-20 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {currentPath !== '/' && currentPath !== '' && (
                  <tr
                    onClick={handleRemoteGoUp}
                    className="hover:bg-zinc-900/60 cursor-pointer text-zinc-400 group"
                  >
                    <td className="py-1 px-2 text-center text-zinc-600"></td>
                    <td className="py-1 px-2 flex items-center gap-1.5">
                      <Folder className="w-3.5 h-3.5 text-amber-500/80 shrink-0" />
                      <span className="font-medium text-zinc-400 group-hover:text-zinc-200 font-mono text-[11px]">..</span>
                    </td>
                    <td className="py-1 px-2 text-right text-zinc-600 font-mono text-[10px]">--</td>
                    <td className="py-1 px-2 text-center text-zinc-600 font-mono text-[10px]">drwxr-xr-x</td>
                    <td className="py-1 px-2 text-right text-zinc-600 text-[10px]">--</td>
                    <td className="py-1 px-2 text-right"></td>
                  </tr>
                )}

                {filteredRemoteItems.map((item) => {
                  const isSelected = selectedRemotePaths.has(item.path);
                  return (
                    <tr
                      key={item.path}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          'text/plain',
                          JSON.stringify({
                            source: 'remote',
                            paths: selectedRemotePaths.has(item.path)
                              ? Array.from(selectedRemotePaths)
                              : [item.path],
                          })
                        );
                      }}
                      onDoubleClick={() => handleOpenFile(item, 'remote')}
                      className={cn(
                        'hover:bg-zinc-900/70 transition-colors group cursor-pointer text-zinc-300',
                        isSelected && 'bg-yellow-950/20 text-yellow-200'
                      )}
                    >
                      <td
                        className="py-1 px-2 text-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectRemote(item.path);
                        }}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-3.5 h-3.5 text-yellow-400 inline" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 inline" />
                        )}
                      </td>
                      <td className="py-1 px-2 flex items-center gap-1.5 truncate">
                        {getFileIcon(item)}
                        <span
                          onClick={() => handleOpenFile(item, 'remote')}
                          className={cn(
                            'truncate text-[11px] hover:underline',
                            item.type === 'directory' ? 'text-zinc-100 font-medium' : 'text-zinc-300'
                          )}
                        >
                          {item.name}
                        </span>
                      </td>
                      <td className="py-1 px-2 text-right text-zinc-400 font-mono text-[10px]">
                        {item.type === 'directory' ? '--' : formatBytes(item.size)}
                      </td>
                      <td
                        onClick={(e) => {
                          e.stopPropagation();
                          setPromptModal({
                            target: 'remote',
                            type: 'chmod',
                            title: `Change Permissions: ${item.name}`,
                            value: (item.mode & 0o777).toString(8),
                            targetItem: item,
                          });
                        }}
                        title="Click to modify chmod permissions"
                        className="py-1 px-2 text-center font-mono text-zinc-400 hover:text-yellow-400 hover:underline cursor-pointer text-[10px]"
                      >
                        {item.permissions}
                      </td>
                      <td className="py-1 px-2 text-right text-zinc-400 text-[10px] truncate">
                        {formatDate(item.mtime)}
                      </td>
                      <td className="py-1 px-2 text-right shrink-0">
                        <div className="flex items-center justify-end gap-0.5">
                          {/* Inline Transfer to Local */}
                          {isDualPane && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTransferToLocal([item.path]);
                              }}
                              disabled={isTransferring}
                              title="Transfer to Local Machine (⬅)"
                              className="p-1 rounded text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition-colors"
                            >
                              <ArrowLeft className="w-3 h-3" />
                            </button>
                          )}

                          {item.type === 'file' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenFile(item, 'remote');
                              }}
                              title="Edit / View File"
                              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                            >
                              <Eye className="w-3 h-3" />
                            </button>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPromptModal({
                                target: 'remote',
                                type: 'rename',
                                title: `Rename "${item.name}"`,
                                value: item.name,
                                targetItem: item,
                              });
                            }}
                            title="Rename"
                            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRemote(item);
                            }}
                            title="Delete"
                            className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!loading && filteredRemoteItems.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-zinc-500 text-xs">
                      This remote directory is empty
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Active Transfer Floating Banner with Real-Time Progress Bar */}
      {isTransferring && transferProgress && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 w-[360px] sm:w-[420px] bg-zinc-900/95 border border-zinc-700/80 rounded-xl shadow-2xl p-3.5 backdrop-blur-md flex flex-col gap-2.5 animate-in fade-in slide-in-from-bottom-3 select-none">
          {/* Top Row: Direction icon + Filename + Item Counter + Percent */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div
                className={cn(
                  'w-6 h-6 rounded-md flex items-center justify-center shrink-0 border text-xs font-semibold',
                  transferProgress.direction === 'to-remote'
                    ? 'bg-sky-500/15 border-sky-500/30 text-sky-400'
                    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                )}
                title={transferProgress.direction === 'to-remote' ? 'Uploading to Remote Server' : 'Downloading to Local Machine'}
              >
                {transferProgress.direction === 'to-remote' ? (
                  <ArrowRight className="w-3.5 h-3.5" />
                ) : (
                  <ArrowLeft className="w-3.5 h-3.5" />
                )}
              </div>

              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-semibold text-zinc-100 truncate" title={transferProgress.file}>
                    {transferProgress.file}
                  </span>
                  {transferProgress.totalItems > 1 && (
                    <span className="text-[10px] text-zinc-400 font-mono shrink-0">
                      ({transferProgress.itemIndex}/{transferProgress.totalItems})
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-zinc-400">
                  {transferProgress.direction === 'to-remote' ? 'Local ➔ Remote' : 'Remote ➔ Local'}
                </span>
              </div>
            </div>

            {/* Percentage badge & Cancel button */}
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={cn(
                  'text-xs font-bold font-mono tracking-tight',
                  transferProgress.direction === 'to-remote' ? 'text-sky-400' : 'text-emerald-400'
                )}
              >
                {transferProgress.totalBytes > 0 ? `${transferProgress.percent}%` : 'Transferring...'}
              </span>

              <button
                type="button"
                onClick={handleCancelTransfer}
                title="Cancel transfer (Esc)"
                className="flex items-center justify-center w-6 h-6 rounded-md text-zinc-400 hover:text-rose-400 hover:bg-rose-500/15 border border-transparent hover:border-rose-500/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500 transition-all cursor-pointer"
                aria-label="Cancel transfer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Progress Bar Track */}
          <div
            role="progressbar"
            aria-valuenow={transferProgress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Transferring ${transferProgress.file}`}
            className="w-full h-2 bg-zinc-800/90 rounded-full overflow-hidden p-0.5 border border-zinc-700/50 relative"
          >
            {transferProgress.totalBytes > 0 ? (
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-200 ease-out',
                  transferProgress.direction === 'to-remote'
                    ? 'bg-gradient-to-r from-sky-500 via-indigo-500 to-sky-400'
                    : 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-400'
                )}
                style={{ width: `${Math.max(2, Math.min(100, transferProgress.percent))}%` }}
              />
            ) : (
              <div
                className={cn(
                  'h-full w-2/5 rounded-full animate-pulse',
                  transferProgress.direction === 'to-remote' ? 'bg-sky-500' : 'bg-emerald-500'
                )}
              />
            )}
          </div>

          {/* Bottom Stats Row: Size transferred vs total + Transfer Speed */}
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 pt-0.5 border-t border-zinc-800/60">
            <span className="truncate">
              {transferProgress.totalBytes > 0 ? (
                <>
                  <span className="text-zinc-200 font-medium">
                    {formatBytes(transferProgress.transferredBytes)}
                  </span>
                  {' / '}
                  <span>{formatBytes(transferProgress.totalBytes)}</span>
                </>
              ) : (
                <span className="text-zinc-300">Processing...</span>
              )}
            </span>

            <div className="flex items-center gap-1.5 text-zinc-300 font-medium shrink-0">
              <RefreshCw className="w-3 h-3 text-zinc-500 animate-spin" />
              <span>{formatSpeed(transferProgress.speedBytesPerSec)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {transferToast && (
        <div className="absolute bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg border text-xs bg-zinc-900 border-zinc-700 text-zinc-100 animate-in fade-in slide-in-from-bottom-2">
          {transferToast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {transferToast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
          {transferToast.type === 'info' && <RefreshCw className="w-4 h-4 text-sky-400 animate-spin shrink-0" />}
          <span>{transferToast.message}</span>
        </div>
      )}

      {/* Modal: New Folder / New File / Rename / Chmod */}
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
