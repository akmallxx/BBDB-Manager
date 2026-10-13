# BBDB Manager

<p align="center">
  <img src="./public/logo.png" width="100" height="100" alt="BBDB Manager Logo" style="border-radius: 18px;" />
</p>

<p align="center">
  <b>A modern, lightweight, and fast database management studio inspired by Beekeeper Studio.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/TailwindCSS-v4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Bun-Compatible-f472b6?logo=bun&logoColor=black" alt="Bun" />
</p>

---

## 🌟 Overview

**BBDB Manager** is an open-source database management tool designed for developers and database administrators who need a clean, responsive, and intuitive interface to query, inspect, and manage databases. Inspired by the sleek aesthetics and ergonomics of Beekeeper Studio, it brings desktop-grade database management straight to your workflow. The project name and appearance can easily be customized via `.env`.

---

## ✨ Features

### 🗄️ Multi-Database Connection Manager
- **Supported Databases**: PostgreSQL, SQLite, with extensible architecture for MySQL and SQL Server.
- **Connection Security**: SSL mode configuration and SSH Tunneling (Password or Private Key authentication).
- **Environment Tagging**: Tag connections as `Development`, `Test / Staging`, or `Production` with customizable color accents.
- **Read-Only Protection**: Prevent accidental writes with an enforceable read-only toggle.

### 📝 SQL Query Editor
- **Live Syntax Highlighting**: Clean token parsing coloring keywords (cyan), functions (amber), strings (emerald), numbers (orange), and comments (muted italic).
- **Format / Beautify SQL**: Standardize messy SQL clauses into well-indented statements with one click.
- **Run Selection or All**: Select any SQL snippet and run only that selection (`Ctrl + Enter`), or execute the entire editor script.
- **Minimizable & Resizable Results**: Collapsible query results tray with draggable splitter resizer.
- **Inline Cell Editing**: Double-click any data cell in query results to edit values inline, with automatic primary key detection and real-time database update.
- **Data Export**: Export results to CSV, JSON, or SQL `INSERT` statements.

### 📊 Interactive Data Table View
- **Tabular Data Inspection**: View table contents with pagination, sorting, and multi-field filtering.
- **Double-Click Inline Editing**: Edit any table column value inline with automatic saving on Enter/blur.
- **Row Number (`#`) Context Menu & 3-Dots**: Hovering over any row number provides a `⋮` button and right-click menu:
  - ✏️ **Edit Row**: Full-row edit modal.
  - ➕ **Duplicate Row (Insert Clone)**: Clone record into the Insert modal.
  - 🗑️ **Delete Row**: Confirmation modal with transaction safety.
  - 📄 **Generate SQL**: Generate formatted `INSERT`, `UPDATE`, `DELETE`, or `CREATE TABLE (DDL)` scripts directly copied to clipboard.
  - ⚡ **Open in SQL Editor**: Jump directly to a new Query Editor tab pre-populated with row SQL.
  - 📋 **Copy Data**: Copy row as JSON or CSV.

### 🛡️ Production Safety & Transaction Control
- **Manual Commit Mode**: Control execution units with `COMMIT` and `ROLLBACK` buttons.
- **Transaction Log Modal**: Inspect active pending statements, statement count, and execution timestamps before committing.
- **Production Guardrail**: Connections marked as `Production` automatically enforce Manual Commit to protect live data.

### 🌲 Entities Tree & Table Actions
- Right-click or click `⋮` on any table in the schema tree:
  - Open Table Data
  - Query Data (TOP 100)
  - View Table DDL (`CREATE TABLE` script modal)
  - Export Table (CSV, JSON, SQL)
  - Truncate Table with confirmation
  - Copy Table Name or `SELECT` statement

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl + Enter` | **Execute SQL** | Run active query or highlighted selection in SQL Editor |
| `Ctrl + W` / `Alt + W` | **Close Tab** | Close currently active workspace tab |
| `Alt + T` / `Ctrl + Shift + N` | **New Query Tab** | Open a new SQL Editor tab without browser conflict |
| `Ctrl + Shift + Q` | **Disconnect** | Disconnect from active database session |
| `Double Click` | **Inline Edit** | Double-click any grid cell in Table View or SQL Results |
| `Escape` | **Cancel / Close** | Cancel inline edit or dismiss context menus and modals |

---

## 🛠️ Tech Stack

- **Frontend**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/), [Lucide React Icons](https://lucide.dev/)
- **Backend**: [Express.js](https://expressjs.com/), [pg (node-postgres)](https://node-postgres.com/)
- **Runtime**: Works seamlessly on both [Node.js](https://nodejs.org/) (via `tsx`) and [Bun](https://bun.sh/)
- **Local Storage**: SQLite metadata store for saved connections and theme settings

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+) or [Bun](https://bun.sh/) (v1.0+)

### 1. Clone the Repository

```bash
git clone https://github.com/akmallxx/beekeeper-like.git
cd beekeeper-like
```

### 2. Install Dependencies

Using npm:
```bash
npm install
```

Or using Bun:
```bash
bun install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Customize the port or configuration if needed:
```env
# Server Port (Default is 3000)
PORT=3000
```

### 4. Run Development Server

Using npm:
```bash
npm run dev
```

Or using Bun:
```bash
bun run server.ts
```

Open your browser at **`http://localhost:3000`**.

---

## 📁 Project Structure

```
database-studio/
├── data/                       # Local SQLite connection storage & settings
├── src/
│   ├── components/
│   │   ├── ui/                 # Reusable UI primitives (Button, Input, Modal, Toast)
│   │   ├── ConnectionFooter.tsx# Bottom status bar (Row count, latency, pagination)
│   │   ├── ConnectionView.tsx  # Database connection form & manager
│   │   ├── DataTableView.tsx   # Interactive table grid & inline cell editor
│   │   ├── NavigationRail.tsx  # Left vertical rail (Entities, Connections, History)
│   │   ├── SidebarDrawer.tsx   # Schema tree, tables, context menus
│   │   ├── SqlEditorView.tsx   # SQL Editor with syntax highlighting & resizer
│   │   ├── TabBar.tsx          # Workspace tabs and transaction control switch
│   │   ├── TableDdlModal.tsx   # DDL generator modal
│   │   └── TransactionLogModal.tsx # Pending transaction viewer
│   ├── lib/
│   │   └── utils.ts            # Formatting, relative time, downloads
│   ├── types/
│   │   └── database.ts         # TypeScript schema definitions
│   ├── App.tsx                 # Main application state & global shortcuts
│   ├── main.tsx                # React root entry
│   └── index.css               # Global theme tokens and typography
├── server.ts                   # Backend API engine (Express + Vite SSR middleware)
├── .env.example                # Example environment settings
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
