import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare const __API_PORT__: string;

// In Tauri desktop environment, redirect relative /api calls to the backend server
const isTauri = typeof window !== 'undefined' && (
  window.location.protocol === 'tauri:' ||
  window.location.hostname.includes('tauri') ||
  Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
);

if (isTauri) {
  const apiPort = typeof __API_PORT__ !== 'undefined' ? __API_PORT__ : '3000';
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const originalFetch = window.fetch;

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
      if (input.startsWith('/api')) {
        return originalFetch(`${apiBase}${input}`, init);
      }
    } else if (input instanceof URL) {
      if (input.pathname.startsWith('/api')) {
        return originalFetch(`${apiBase}${input.pathname}${input.search}`, init);
      }
    } else if (input instanceof Request) {
      if (input.url.startsWith('/api') || input.url.includes('tauri.localhost/api')) {
        const newUrl = input.url.replace(/^(?:https?:\/\/[^\/]+|tauri:\/\/[^\/]+)?\/api/, `${apiBase}/api`);
        return originalFetch(new Request(newUrl, input), init);
      }
    }
    return originalFetch(input, init);
  };
}

createRoot(document.getElementById('root')!).render(<App />);
