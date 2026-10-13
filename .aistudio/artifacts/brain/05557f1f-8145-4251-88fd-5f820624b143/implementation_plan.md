# Beekeeper-Style Database Studio Implementation Plan (Revised)

A high-fidelity, desktop-grade database studio and management environment meticulously modeled after Beekeeper Studio's UI/UX, built as a modern web-based application using **React SPA on Vite** with an **Express full-stack backend** and **shadcn/ui** design system (zinc theme, Radix primitives, and Sonner notifications).

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The architectural decisions below address your latest feedback and recommendations:

- **Confirmed Decision 1 (Framework: React SPA + Express Full-Stack - Recommended)**: 
  - **Saran Kami**: Sangat direkomendasikan menggunakan **React SPA on Vite + Express** (bukan Next.js SSR) karena Database Studio adalah aplikasi *client-heavy desktop-like tool* yang membutuhkan:
    1. Zero-latency tab switching, instan virtualized data grid scrolling, dan editor SQL tanpa re-rendering page full SSR.
    2. Arsitektur backend Express terintegrasi langsung untuk SQLite storage (connections & history) dan server-side proxy query execution.
    3. Sudah sesuai dengan ekosistem dan runtime environment project saat ini tanpa resiko breaking hydration SSR pada code editor & canvas.
- **Confirmed Decision 2 (UI System: shadcn/ui & Tailwind CSS Zinc)**:
  - Menggunakan arsitektur komponen **shadcn/ui** dengan palet dasar `zinc`, semantic variables (`bg-background`, `border-border`, `text-foreground`, `bg-muted`), custom component primitives (Button, Input, Select/Dropdown, Tabs, Dialog, Switch, Tooltip, Badge, Table), serta **Sonner** untuk error/query status notifications yang informatif.
  - Mempertahankan signature Beekeeper accent (kuning cerah `#FACC15` untuk cell outline highlight pada data grid, serta badge warna koneksi).
- **Confirmed Decision 3 (Sample Databases & Execution)**:
  - Pre-populates sample databases siap pakai untuk PostgreSQL (`hospital_simrs` / `mst_pasien`), MySQL (`ecommerce_store`), SQLite (`inventory_app`), dan SQL Server (`enterprise_erp`).
- **Confirmed Decision 4 (Data Export)**:
  - Ekspor cepat ke format CSV, JSON terformat, dan SQL `INSERT INTO` statements.
- **Confirmed Decision 5 (Dual Storage Strategy)**:
  - SQLite untuk menyimpan `connections` dan `query_history`.
  - JSON file (`theme-config.json`) untuk menyimpan preferensi tema (dark mode / light mode).

---

### 1. Overview & Core Concept

- **What It Does**: Web-based Database Studio lengkap dengan UI Beekeeper Studio:
  - Layar New Connection & Saved Connections list dengan color indicator stripes.
  - Dukungan SSH Tunnel toggle, SSL toggle, dan opsi multi-driver (PostgreSQL, MySQL, SQLite, SQL Server).
  - Schema tree explorer (Database -> Schema `public` -> Tables dengan count badge).
  - Multi-tab SQL query editor dengan auto-complete kata kunci SQL dan nama tabel/kolom.
  - Manual Commit transaction controls (`Autocommit: ON / OFF`, tombol `Commit` & `Rollback`).
  - Data table viewer dengan cell selection khas Beekeeper (border kuning), filter bar cepat, dan ekspor instan.
  - Panel Query History untuk melacak riwayat query dan mengeksekusi ulang secara instan.
- **Visual Identity**: Beekeeper charcoal-zinc dark mode dengan mode terang (light mode) yang dapat dialihkan via JSON setting.

---

### 2. User Experience & Visual Design (shadcn/ui Architecture)

#### Key User Flows
1. **Connection Manager (Default View)**:
   - Panel Kiri: Tombol `+ New Connection`, input filter, dan list `SAVED` connections lengkap dengan strip vertikal berwarna (Cyan, Red, Green, Purple, Yellow, Orange, dll.) serta badge driver.
   - Panel Kanan: Form New Connection berbasis form controls shadcn:
     - Driver select (`Postgres`, `MySQL`, `SQLite`, `SQL Server`).
     - Host, Port, toggle switch SSL.
     - User, Password (dengan toggle reveal mata).
     - Default Database input.
     - Expandable **SSH Tunnel** accordion/switch (SSH Host, SSH Port, SSH User, Auth Mode).
     - Read-Only Mode checkbox.
     - Action buttons: "Test" dan "Connect" (shadcn primary button styling).
     - Save Connection panel: input nama koneksi, checkbox Save Password, 8 pilihan palet warna titik (dots), dan tombol "Save".
2. **Database Workspace & Schema Explorer**:
   - Sidebar kiri: Database dropdown selector dengan icon refresh, filter input pencarian entitas, badge total ENTITIES, dan tree expander (`public` -> list tables dengan table icon).
   - Klik tabel membuka tab Tabel (`mst_pasien [all]`).
3. **Data Grid Viewer (Signature Beekeeper)**:
   - Bar filter atas: `<> [column] [equals/contains/gt] [value]` + tombol filter dan search.
   - Grid tabel virtual dengan nomor baris (1, 2, 3...), header kolom dengan type hint (`created_at timestamp`, `created_by varchar`), panah sort, dan penanda nilai `(NULL)` / `(EMPTY)`.
   - **Signature Yellow Focus**: Sel yang dipilih/aktif memiliki highlight border kuning cerah Beekeeper (`border-2 border-yellow-400 bg-yellow-400/10`).
   - Toolbar bawah: pagination info bar dan menu dropdown "Export" (CSV, JSON, SQL Insert).
4. **Multi-Tab SQL Editor**:
   - Tab bar interaktif dengan tab query (`<> Query #1`, `<> Query #2`) yang bisa ditambah (`+`) dan ditutup (`x`).
   - Editor teks SQL dengan line numbering, syntax highlighting kata kunci, dan dropdown autocomplete otomatis.
   - Bar eksekusi: Run Query (`Ctrl+Enter`), Format SQL, Clear, serta switch **Manual Commit** dengan tombol `Commit` & `Rollback` aktif saat ada transaksi berjalan.
   - Panel hasil bawah: waktu eksekusi (`14ms`, `23 rows returned`), grid hasil, serta notifikasi error informatif (error banner berisi line number, pesan error SQL yang jelas, dan solusi perbaikan).
5. **Query History Drawer**:
   - Diakses dari ikon jam di navigation rail paling kiri.
   - Menampilkan riwayat query berurutan lengkap dengan status (success / error), jumlah hasil, dan waktu relatif.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: React SPA on Vite vs Next.js**
  - *Chosen Approach*: **React SPA on Vite + Express Backend**.
  - *Why*: Menghindari latensi SSR dan hydration mismatches pada komponen editor & virtual data grid. Database IDE adalah aplikasi stateful yang berjalan 100% di browser dengan websocket/REST backend call yang cepat.
- **Decision 2: shadcn/ui Component Strategy**
  - *Chosen Approach*: Mengadopsi fondasi shadcn/ui (Tailwind CSS v4 variables, Radix primitives, Sonner toasts) yang disesuaikan khusus dengan proporsi compact/dense ala Beekeeper Studio (padding `py-1.5 px-3`, font-mono untuk data tabular).
- **Decision 3: Dual Persistence (SQLite + JSON)**
  - *Chosen Approach*: Backend Express menyimpan connections dan history ke file SQLite lokal (`data/database-studio.sqlite`), sedangkan konfigurasi tema (dark/light) disimpan di file JSON terpisah (`data/theme-config.json`).

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                   BEEKEEPER DATABASE STUDIO (REACT SPA)                │
│                                                                        │
│ ┌──────────────┐ ┌────────────────────┐ ┌────────────────────────────┐ │
│ │  Rail Bar    │ │  Sidebar / Drawer  │ │      Main Workspace Area    │ │
│ │ ──────────── │ │ ────────────────── │ │ ────────────────────────── │ │
│ │ • Connect    │ │ • Saved Conns List │ │ • Connection Form (SSH)    │ │
│ │ • Entities   │ │ • Database Selector│ │ • Data Grid (Yellow Focus) │ │
│ │ • History    │ │ • Schema & Tables  │ │ • Multi-Tab SQL Editor     │ │
│ └──────────────┘ └────────────────────┘ └────────────────────────────┘ │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ REST API (/api/*)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        EXPRESS BACKEND SERVER                          │
│                                                                        │
│ ┌───────────────────────────────┐   ┌────────────────────────────────┐ │
│ │  Database Driver Simulator    │   │  Persistence Engine            │ │
│ │  • Postgres, MySQL, SQLite,   │   │  • SQLite: connections &       │ │
│ │    SQL Server query runner    │   │    query execution history     │ │
│ │  • Manual Commit Transactions │   │  • JSON: theme & preferences   │ │
│ │  • Export to CSV, JSON, SQL   │   │                                │ │
│ └───────────────────────────────┘   └────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

#### Data Entities & Storage Model
1. **SQLite (`data/database-studio.sqlite`)**:
   - `connections`: `id`, `name`, `driver`, `host`, `port`, `user`, `password`, `database_name`, `ssl`, `ssh_enabled`, `ssh_host`, `ssh_port`, `ssh_user`, `color`, `created_at`.
   - `query_history`: `id`, `connection_id`, `query_text`, `status`, `row_count`, `duration_ms`, `error_message`, `created_at`.
2. **JSON (`data/theme-config.json`)**:
   - `{ "theme": "dark", "fontSize": 14, "autoCommitDefault": false }`.

---

### Planned Implementation Sequence
1. Konfigurasi Express backend di `server.ts` dengan REST endpoint:
   - `/api/theme` (baca/tulis `theme-config.json`)
   - `/api/connections` (CRUD SQLite untuk koneksi)
   - `/api/history` (riwayat query SQLite)
   - `/api/query` (eksekutor query multi-driver dengan manual commit support)
   - `/api/export` (generate CSV, JSON, SQL INSERT)
2. Setup komponen UI shadcn (Button, Input, Select, Switch, Tabs, Dialog, Tooltip, Sonner) dengan palet Zinc & Beekeeper Yellow accent.
3. Implementasi Connection Manager (New Connection form, SSH Tunnel accordion, Color tags, Saved connections list).
4. Implementasi Schema & Table Explorer (Tree view, filter, live entity counter).
5. Implementasi Data Grid View (Yellow cell focus border, filtering bar, sorting, type labels, export).
6. Implementasi Multi-Tab SQL Editor (Syntax highlighting, autocomplete dropdown, manual commit controls, error diagnostic alert).
7. Implementasi History Drawer & Theme Toggle (Dark / Light mode).
8. Verifikasi `compile_applet` dan pengetesan fungsional end-to-end.
