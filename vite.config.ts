import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appName = env.VITE_APP_NAME || env.APP_NAME || 'BBDB Manager';
  const backendPort = env.PORT || env.VITE_BACKEND_PORT || env.BACKEND_PORT || '39001';

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_APP_NAME': JSON.stringify(appName),
      '__APP_NAME__': JSON.stringify(appName),
      '__API_PORT__': JSON.stringify(backendPort),
    },
    resolve: {
      alias: {
        '@': path.resolve('.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api/ssh/ws': {
          target: `ws://localhost:${backendPort}`,
          ws: true,
          changeOrigin: true
        },
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true
        }
      }
    },
  };
});
