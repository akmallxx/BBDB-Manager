# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-10-22

### Added
- **Side-by-Side (Dual-Pane) SFTP Explorer**:
  - Twin-panel explorer showing Local Machine on the left and Remote Server on the right for seamless navigation.
  - View switcher in top toolbar allowing instant toggle between `[ ◫ Side-by-Side ]` and `[ ▭ Remote Only ]` views.
  - Independent navigation controls for both panes: path input bar, parent directory (`ArrowUp`), home directory (`Home`), refresh (`RefreshCw`), and new folder creation (`FolderPlus`).
  - Independent search filter bars for quick filtering of local and remote directory entries.
- **Direct Streaming File & Folder Transfer (No Download/Upload Dialogs)**:
  - Streaming backend endpoint `/api/sftp/transfer` directly piping streams between local disk and remote SFTP without loading files into memory or opening browser file pickers.
  - Central action strip with `[ ➔ Transfer to Remote ]` and `[ ⬅ Transfer to Local ]` buttons with live item counters.
  - 1-click inline row quick transfer buttons (`➔` and `⬅`) on every file and directory row.
  - Interactive Drag & Drop: drag files or folders directly between Local and Remote panes to initiate transfer with visual drop target highlighting.
  - Multi-select checkbox support across both panes to batch transfer multiple files and folders at once.
  - Recursive directory transfer handling for nested folders in both directions (local-to-remote and remote-to-local).
- **Local Filesystem Service**:
  - Secure backend service (`server/local-fs-service.ts`) providing directory listing, folder creation, deletion, and renaming for the local machine.

## [1.2.0] - 2026-10-22

### Added
- **Remote SSH Terminal**:
  - Full-featured xterm.js terminal session over WebSockets (`ws`).
  - Terminal theme synchronization (live dark and light mode adaptation).
  - Customizable terminal font size (11px–20px) and cursor styles (block, underline, vertical bar).
  - Terminal zoom in/out with layout refit without dropping SSH connections.
  - SSH keepalive packets every 15 seconds to prevent idle timeout disconnects.
- **SFTP Remote File Explorer**:
  - Interactive graphical remote file browser with directory tree navigation.
  - File details inspection: file sizes, last modified times, and human-readable Unix permission octals.
  - In-app text viewer and editor for remote configuration files and scripts.
  - Remote file and directory management: rename, delete, chmod permissions, and directory creation.
  - Chunked binary file upload (up to 100MB) and direct browser file downloads via streaming.
- **Terminal Snippets Manager**:
  - Right-hand side drawer inside terminal tabs for quick snippet discovery and execution.
  - Dynamic template variables (`{{variable:default}}`) with interactive parameter modal.
  - Snippet categorization, search filtering, favorites, and 3-dots action menu (Copy, Edit, Delete).
  - Persistent SQLite table `terminal_snippets` with REST API CRUD endpoints.
- **Studio Preferences & Settings Dialog**:
  - Accessible tabbed modal (`Ctrl+,`) with sections for Appearance, Database & SQL, Terminal & SFTP, Keyboard Shortcuts, and Storage & SQLite.
  - Live database statistics: saved connection count, query history row count, and terminal snippet count.
  - Safe database maintenance action to clear query history without affecting saved connections.
- **Customizable Keyboard Shortcuts Manager**:
  - Dedicated "Keyboard Shortcuts" section in Settings modal.
  - Interactive key recorder capturing combinations directly from physical keyboard (`Ctrl`, `Alt`, `Shift`, `Cmd/⌘`, letters, numbers, punctuation, `Enter`, `Space`).
  - Real-time collision detection showing warning badges when combinations conflict.
  - Per-action reset and global "Reset All to Defaults" buttons.
  - Persistent storage in SQLite `app_settings` via `custom_shortcuts` JSON mapping.
  - Dynamic dispatching in `App.tsx` and `SqlEditorView.tsx`.
  - Input protection guards preventing shortcut hijacking during active terminal (`xterm.js`) sessions and modal interactions.
- **Dual Workspace Navigation**:
  - Mode toggle pill in Navigation Rail to switch between Database Workspace and Remote SSH Workspace.
  - Smart tab handling preventing accidental cross-workspace tab closure.
  - Auto-collapsing SSH connection list in sidebar upon successful connection.
  - Active connection emerald status card for active SSH sessions with quick Disconnect and Open SFTP actions.

### Changed
- **Tailwind CSS v4 & Theme Overhaul**:
  - Registered `@custom-variant dark (&:where(.dark, .dark *));`.
  - Re-mapped `--color-zinc-*` variables in `:root` and `.dark` for crisp contrast in both Light and Dark modes.
  - Styled all yellow primary buttons with `text-slate-950 font-bold` for optimal readability and WCAG AA contrast.
  - Added accessible keyboard focus rings via `:focus-visible` without intrusive mouse click outlines.
  - SQL syntax highlighting calibrated for high contrast on light editor canvases.
- **SQLite Settings Architecture**:
  - Migrated legacy `data/theme-config.json` into unified SQLite `app_settings` table.
  - Added `/api/settings` and `/api/settings/info` endpoints.
  - Removed hardcoded fallback dummy connections and starter snippets in favor of user-managed SQLite records.
  - Strict HTTP 404 validation when connections are not found.

### Fixed
- Fixed terminal reconnecting loop caused by zoom button clicks.
- Fixed premature tab closing and unexpected return to database mode when disconnecting from SSH sessions.
- Fixed invisible white SQL identifier text in light mode.
- Fixed unreadable white text on yellow primary buttons in light mode.
- Fixed macOS Command (`Cmd`) key modifier matching in shortcut engine.
- Fixed global keyboard shortcut collision where pressing `Ctrl+W` in terminal killed the active tab instead of deleting word in bash.

### Removed
- Removed legacy `data/theme-config.json` file.
- Removed hardcoded fallback dummy connection (`PROD - RSKG`) and 60+ lines of hardcoded starter snippets.

---

## [1.1.0] - 2026-10-15

### Added
- Multi-database driver support for MySQL, MariaDB, SQLite, and Microsoft SQL Server (MSSQL).
- Unified schema and table metadata adapters.
- Primary key detection and inline grid editing.

## [1.0.0] - 2026-10-01

### Added
- Initial release of BBDB Manager.
- PostgreSQL connection manager with SSL and SSH tunneling.
- SQL Query editor with syntax highlighting, autocomplete, and formatter.
- Data table grid with pagination and CSV/JSON export.
- Tauri v2 standalone desktop application support.
