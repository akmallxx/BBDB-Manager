import React, { useState, useEffect } from 'react';
import { Terminal, Play, ChevronRight, X } from 'lucide-react';

export interface SnippetVariable {
  raw: string; // e.g. "lines:100" or "container_name"
  key: string; // e.g. "lines"
  defaultValue: string; // e.g. "100" or ""
}

interface SnippetVariableModalProps {
  isOpen: boolean;
  rawCommand: string;
  variables: SnippetVariable[];
  autoExecute: boolean;
  onClose: () => void;
  onSubmit: (resolvedCommand: string, autoExecute: boolean) => void;
}

export const SnippetVariableModal: React.FC<SnippetVariableModalProps> = ({
  isOpen,
  rawCommand,
  variables,
  autoExecute,
  onClose,
  onSubmit,
}) => {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      const initial: Record<string, string> = {};
      variables.forEach((v) => {
        initial[v.key] = v.defaultValue;
      });
      setValues(initial);
    }
  }, [isOpen, variables]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let resolved = rawCommand;
    variables.forEach((v) => {
      const val = values[v.key] ?? v.defaultValue;
      // Replace all occurrences of {{raw}}
      resolved = resolved.split(`{{${v.raw}}}`).join(val);
    });
    onSubmit(resolved, autoExecute);
    onClose();
  };

  const previewCommand = () => {
    let preview = rawCommand;
    variables.forEach((v) => {
      const val = values[v.key] ?? v.defaultValue;
      preview = preview.split(`{{${v.raw}}}`).join(val || `[${v.key}]`);
    });
    return preview;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="snippet-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in-50"
    >
      <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#27272a] flex items-center justify-between bg-[#121214]">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <h3 id="snippet-modal-title" className="text-xs font-semibold text-zinc-200">
              Command Variables
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-[#27272a] rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <p className="text-xs text-zinc-400">
            This snippet contains template placeholders. Please configure variable values before running:
          </p>

          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {variables.map((v) => {
              const inputId = `var-input-${v.key}`;
              return (
                <div key={v.key}>
                  <label htmlFor={inputId} className="text-[11px] font-mono text-emerald-400/90 block mb-1">
                    {`{{${v.key}}}`}
                  </label>
                  <input
                    id={inputId}
                    type="text"
                    autoFocus={variables[0]?.key === v.key}
                    value={values[v.key] ?? ''}
                    placeholder={v.defaultValue ? `Default: ${v.defaultValue}` : `Enter ${v.key}...`}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [v.key]: e.target.value }))
                    }
                    className="w-full bg-[#121214] border border-[#2e2e38] rounded-md px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/60 font-mono"
                  />
                </div>
              );
            })}
          </div>

          {/* Command Preview */}
          <div>
            <label className="text-[10px] uppercase font-semibold text-zinc-500 block mb-1">
              Command Preview
            </label>
            <div className="bg-[#121214] border border-[#232328] rounded p-2 text-xs font-mono text-zinc-300 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
              {previewCommand()}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#27272a]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-[#27272a] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-md text-xs transition-colors flex items-center gap-1.5 shadow-sm"
            >
              {autoExecute ? (
                <>
                  <Play className="w-3 h-3 fill-current" />
                  <span>Execute in Terminal</span>
                </>
              ) : (
                <>
                  <ChevronRight className="w-3.5 h-3.5" />
                  <span>Insert to Terminal</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
