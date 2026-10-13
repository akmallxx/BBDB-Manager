import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare const __API_PORT__: string;

// In Tauri desktop environment, redirect all /api calls to backend server
const isTauri = typeof window !== 'undefined' && (
  window.location.protocol === 'tauri:' ||
  window.location.hostname.includes('tauri') ||
  window.location.hostname === 'localhost' && window.location.port !== (__API_PORT__ || '3000') ||
  Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
);

if (isTauri) {
  const apiPort = typeof __API_PORT__ !== 'undefined' ? __API_PORT__ : '3000';
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const originalFetch = window.fetch;

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
    if (
      url.startsWith('/api') ||
      url.includes('tauri.localhost/api') ||
      url.includes('tauri://localhost/api') ||
      (url.includes('/api/') && !url.includes(`:${apiPort}/`))
    ) {
      const rewrittenUrl = url.replace(/^(?:https?:\/\/[^\/]+|tauri:\/\/[^\/]+)?\/api/, `${apiBase}/api`);
      if (typeof input === 'string' || input instanceof URL) {
        return originalFetch(rewrittenUrl, init);
      } else {
        return originalFetch(new Request(rewrittenUrl, input), init);
      }
    }
    return originalFetch(input, init);
  };
}

createRoot(document.getElementById('root')!).render(<App />);
