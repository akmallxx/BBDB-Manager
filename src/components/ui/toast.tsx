import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
  duration?: number;
}

interface ToastContextType {
  toast: (item: Omit<ToastItem, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback(({ type, title, description, duration = 4000 }: Omit<ToastItem, 'id'>) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    setToasts(prev => [...prev, { id, type, title, description, duration }]);

    setTimeout(() => {
      removeToast(id);
    }, duration);
  }, [removeToast]);

  const success = useCallback((title: string, description?: string) => toast({ type: 'success', title, description }), [toast]);
  const error = useCallback((title: string, description?: string) => toast({ type: 'error', title, description, duration: 6000 }), [toast]);
  const info = useCallback((title: string, description?: string) => toast({ type: 'info', title, description }), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info }}>
      {children}
      {/* Toast Notification Container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 p-3 rounded-lg border shadow-xl transition-all animate-in slide-in-from-bottom-2 ${
              t.type === 'success'
                ? 'bg-zinc-900 border-emerald-500/40 text-emerald-100'
                : t.type === 'error'
                ? 'bg-zinc-900 border-red-500/50 text-red-100'
                : 'bg-zinc-900 border-zinc-700 text-zinc-100'
            }`}
          >
            {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
            {t.type === 'error' && <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
            {t.type === 'info' && <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold leading-tight">{t.title}</div>
              {t.description && <div className="text-[11px] text-zinc-400 mt-1 leading-snug break-words">{t.description}</div>}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
