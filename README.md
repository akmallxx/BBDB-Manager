# BBDB Manager

<p align="center">
  <img src="./public/logo.png" width="100" height="100" alt="BBDB Manager Logo" style="border-radius: 18px;" />
</p>

<p align="center">
  Database management client for PostgreSQL, MySQL / MariaDB, SQLite, and SQL Server (MSSQL) with web and native desktop interfaces.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8.0-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/TailwindCSS-v4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white" alt="Tauri" />
  <img src="https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Bun-Compatible-f472b6?logo=bun&logoColor=black" alt="Bun" />
</p>

---

## Overview

BBDB Manager provides an interface for querying, modifying, and managing relational databases. It supports direct connections and SSH tunneling, with manual transaction control for production environments. It runs in modern web browsers or as a standalone desktop application via Tauri v2.

---

## Features

### Connection Management
- Database drivers: PostgreSQL, MySQL / MariaDB, SQLite, and SQL Server (MSSQL).
- Network security: SSL encryption and SSH tunneling (password or private key with passphrase).
- Environment tagging: Label connections as Development, Staging, or Production with color indicators.
- Read-only mode: Enforceable read-only toggle to prevent write operations.

### SQL Query Editor
- Syntax highlighting for SQL keywords, functions, literals, and comments.
- SQL formatter to indent and structure queries.
- Execute selection or entire script with keyboard shortcut (`Ctrl + Enter`).
- Resizable and collapsible query result tray.
- Inline cell editing in result grids with primary key detection.
- Export results to CSV, JSON, or SQL INSERT statements.

### Data Table View
- Paginated table browser with sorting and column filtering.
- Inline cell editing with automatic persistence on Enter or blur.
- Context menu actions per row:
  - Edit row modal
  - Clone and insert row
  - Delete row
  - Generate SQL (INSERT, UPDATE, DELETE, DDL)
  - Copy row data (JSON or CSV)
  - Open row query in SQL Editor

### Transaction Control
- Manual commit mode with explicit `COMMIT` and `ROLLBACK` actions.
- Transaction log modal showing uncommitted statements, timestamps, and row counts.
- Automated safety guardrail: connections marked as Production enforce manual commit mode.

### Schema Browser
- Hierarchical schema and table tree.
- Context actions:
  - View table data
  - Query top 100 rows
  - View table DDL (`CREATE TABLE` schema)
  - Export table data (CSV, JSON, SQL)
  - Truncate table
  - Copy table identifier or SELECT statement

---

## Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl + Enter` | Execute SQL | Run active query or selected text |
| `Ctrl + W` / `Alt + W` | Close Tab | Close active workspace tab |
| `Alt + T` / `Ctrl + Shift + N` | New Query Tab | Open a new SQL Editor tab |
| `Ctrl + Shift + Q` | Disconnect | Close active database connection |
| Double Click | Inline Edit | Edit value in grid cell |
| `Escape` | Dismiss | Cancel inline edit or close open modals |

---

## Tech Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons
- Backend: Express.js, node-postgres (`pg`), `mysql2`, `node:sqlite`, `mssql`, ssh2
- Desktop: Tauri v2 (Rust) with bundled standalone Bun binary sidecar
- Runtimes: Node.js (via `tsx`) and Bun

---

## Getting Started

### Prerequisites

- Node.js (v18+) or Bun (v1.0+)
- For desktop development: Rust toolchain and Linux development libraries

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/akmallxx/beekeeper-like.git
   cd beekeeper-like
   ```

2. Install dependencies:
   ```bash
   bun install
   # or: npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```

4. Start the development server:
   ```bash
   bun run dev
   # or: npm run dev
   ```

   The application will be accessible at `http://localhost:39000`.

---

## Desktop Application (Tauri v2)

The desktop application bundles the backend as a standalone binary sidecar, allowing distribution without requiring a Node.js or Bun runtime on target machines.

### Desktop Dependencies (Linux)

```bash
sudo apt update && sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

### Run Desktop in Development

```bash
bun run desktop:dev
# or: npm run desktop:dev
```

### Build Standalone Installers (.deb, .AppImage)

```bash
bun run desktop:build
# or: npm run desktop:build
```

Generated packages are located in `src-tauri/target/release/bundle/`.

---

## Project Structure

```
database-studio/
├── data/                       # Local SQLite connection store and settings
├── scripts/
│   ├── build-server.ts         # Bun sidecar binary compilation script
│   └── sync-tauri-config.ts    # Synchronizes .env configuration into tauri.conf.json
├── src/
│   ├── components/             # UI views, table grid, editor, modals
│   ├── lib/                    # Utilities and formatters
│   ├── types/                  # TypeScript data interfaces
│   ├── App.tsx                 # Application state and workspace tabs
│   └── main.tsx                # Client entry point
├── src-tauri/                  # Rust Tauri desktop application source
├── server.ts                   # Express API backend with Vite middleware
├── .env.example                # Sample environment configuration
├── package.json
└── vite.config.ts
```

---

## License

This project is licensed under the [MIT License](LICENSE).
