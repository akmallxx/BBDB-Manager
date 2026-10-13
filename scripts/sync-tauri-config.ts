import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load .env from project root
dotenv.config();

const appName = process.env.TAURI_PRODUCT_NAME || process.env.VITE_APP_NAME || process.env.APP_NAME || 'BBDB Manager';
const port = process.env.PORT || '3000';
const identifier = process.env.TAURI_IDENTIFIER || `com.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}.manager`;
const version = process.env.TAURI_VERSION || '1.0.0';
const windowTitle = process.env.TAURI_WINDOW_TITLE || appName;
const width = parseInt(process.env.TAURI_WINDOW_WIDTH || '1280', 10);
const height = parseInt(process.env.TAURI_WINDOW_HEIGHT || '820', 10);
const minWidth = parseInt(process.env.TAURI_WINDOW_MIN_WIDTH || '900', 10);
const minHeight = parseInt(process.env.TAURI_WINDOW_MIN_HEIGHT || '600', 10);
const resizable = process.env.TAURI_WINDOW_RESIZABLE !== 'false';
const fullscreen = process.env.TAURI_WINDOW_FULLSCREEN === 'true';
const center = process.env.TAURI_WINDOW_CENTER !== 'false';
const decorations = process.env.TAURI_WINDOW_DECORATIONS !== 'false';
const devUrl = process.env.TAURI_DEV_URL || `http://localhost:${port}`;
const beforeDevCommand = process.env.TAURI_BEFORE_DEV_COMMAND || 'bun run dev';
const beforeBuildCommand = process.env.TAURI_BEFORE_BUILD_COMMAND || 'bun run build';

const tauriConfPath = path.resolve('src-tauri/tauri.conf.json');
let tauriConf: any = {};
if (fs.existsSync(tauriConfPath)) {
  try {
    tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
  } catch {
    tauriConf = {};
  }
}

tauriConf.$schema = 'https://schema.tauri.app/config/2';
tauriConf.productName = appName;
tauriConf.version = version;
tauriConf.identifier = identifier;

if (!tauriConf.build) tauriConf.build = {};
tauriConf.build.beforeDevCommand = beforeDevCommand;
tauriConf.build.devUrl = devUrl;
tauriConf.build.beforeBuildCommand = beforeBuildCommand;
tauriConf.build.frontendDist = '../dist';

if (!tauriConf.app) tauriConf.app = {};
if (!tauriConf.app.windows || !tauriConf.app.windows.length) {
  tauriConf.app.windows = [{}];
}

tauriConf.app.windows[0] = {
  ...tauriConf.app.windows[0],
  title: windowTitle,
  width,
  height,
  minWidth,
  minHeight,
  resizable,
  fullscreen,
  center,
  decorations
};

if (!tauriConf.bundle) tauriConf.bundle = {};
tauriConf.bundle.active = true;
tauriConf.bundle.targets = 'all';
tauriConf.bundle.icon = [
  'icons/32x32.png',
  'icons/128x128.png',
  'icons/128x128@2x.png',
  'icons/icon.png',
  'icons/icon.ico'
];
tauriConf.bundle.linux = {
  deb: {
    depends: ['libwebkit2gtk-4.1-0 | libwebkit2gtk-4.0-37']
  }
};

fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf-8');

// Also sync version in src-tauri/Cargo.toml if present
const cargoTomlPath = path.resolve('src-tauri/Cargo.toml');
if (fs.existsSync(cargoTomlPath)) {
  try {
    let cargoToml = fs.readFileSync(cargoTomlPath, 'utf-8');
    const updatedCargoToml = cargoToml.replace(/^version = ".*"/m, `version = "${version}"`);
    if (cargoToml !== updatedCargoToml) {
      fs.writeFileSync(cargoTomlPath, updatedCargoToml, 'utf-8');
    }
  } catch (err) {
    console.warn('[Tauri Sync] Note: Could not update Cargo.toml version:', err);
  }
}

console.log(`[Tauri Config Synced from .env]`);
console.log(`  - App Name   : "${appName}"`);
console.log(`  - Version    : ${version}`);
console.log(`  - Identifier : ${identifier}`);
console.log(`  - Dev URL    : ${devUrl}`);
console.log(`  - Window     : ${width}x${height} (Title: "${windowTitle}", Resizable: ${resizable})`);
