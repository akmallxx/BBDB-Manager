import React, { useState } from 'react';
import { X, Copy, Check, Terminal, FileCode, ExternalLink, Download } from 'lucide-react';
import { Button } from './ui/button';
import { cn, triggerDownload } from '../lib/utils';
import { useToast } from './ui/toast';

interface TableDdlModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  schemaName: string;
  ddl: string;
  columnsCount?: number;
  primaryKeys?: string[];
  onOpenInEditor?: (ddl: string) => void;
}

export function TableDdlModal({
  isOpen,
  onClose,
  tableName,
  schemaName,
  ddl,
  columnsCount,
  primaryKeys = [],
  onOpenInEditor
}: TableDdlModalProps) {
  const { success } = useToast();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(ddl);
    setCopied(true);
    success('Copied DDL', `DDL for "${schemaName}"."${tableName}" copied to clipboard.`);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportSql = () => {
    triggerDownload(ddl, `${schemaName}_${tableName}_ddl.sql`, 'text/plain');
    success('Downloaded DDL', `Saved ${tableName} DDL as .sql file.`);
  };

  const lines = ddl.split('\n');

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in-50">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden animate-in zoom-in-95">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-yellow-400/15 border border-yellow-400/30 flex items-center justify-center text-yellow-400">
              <FileCode className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-zinc-100 tracking-tight">Table DDL Definition</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-zinc-800 text-yellow-300 border border-zinc-700">
                  {schemaName}.{tableName}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                SQL CREATE TABLE schema statement with columns, defaults, and primary keys
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Metadata subbar */}
        <div className="px-5 py-2 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between text-xs font-mono text-zinc-400 shrink-0">
          <div className="flex items-center gap-3">
            {columnsCount !== undefined && (
              <span className="flex items-center gap-1 text-[11px]">
                <span className="text-zinc-500">Columns:</span>
                <span className="text-zinc-200 font-semibold">{columnsCount}</span>
              </span>
            )}
            {primaryKeys.length > 0 && (
              <span className="flex items-center gap-1 text-[11px]">
                <span className="text-zinc-500">PK:</span>
                <span className="text-amber-300 font-semibold">({primaryKeys.join(', ')})</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="xs"
              variant="secondary"
              onClick={handleExportSql}
              className="h-6 text-[11px] bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100"
            >
              <Download className="w-3 h-3 mr-1" />
              Download .sql
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={handleCopy}
              className="h-6 text-[11px] bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100"
            >
              {copied ? <Check className="w-3 h-3 mr-1 text-emerald-400" /> : <Copy className="w-3 h-3 mr-1" />}
              {copied ? 'Copied' : 'Copy DDL'}
            </Button>
          </div>
        </div>

        {/* DDL Code Area */}
        <div className="flex-1 overflow-auto bg-zinc-950 p-4 font-mono text-xs leading-5 select-text">
          <div className="flex">
            {/* Line numbers */}
            <div className="w-8 select-none text-zinc-600 text-right pr-3 font-mono text-[11px] leading-5 shrink-0 border-r border-zinc-800/60">
              {lines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            {/* Code */}
            <pre className="pl-3 overflow-x-auto text-zinc-200 font-mono text-xs leading-5">
              <code>
                {lines.map((line, idx) => {
                  let lineEl = <span>{line}</span>;
                  if (line.trim().startsWith('--')) {
                    lineEl = <span className="text-zinc-500 italic">{line}</span>;
                  } else if (line.includes('CREATE TABLE')) {
                    lineEl = (
                      <span>
                        <span className="text-cyan-400 font-semibold">CREATE TABLE </span>
                        <span className="text-yellow-300">{line.replace('CREATE TABLE ', '')}</span>
                      </span>
                    );
                  } else if (line.includes('PRIMARY KEY') || line.includes('CONSTRAINT')) {
                    lineEl = (
                      <span>
                        <span className="text-amber-400 font-medium">{line}</span>
                      </span>
                    );
                  } else if (line.includes('NOT NULL') || line.includes('DEFAULT')) {
                    lineEl = (
                      <span>
                        <span className="text-zinc-200">{line.split('NOT NULL')[0]}</span>
                        {line.includes('NOT NULL') && <span className="text-cyan-400 font-semibold">NOT NULL</span>}
                        {line.split('NOT NULL')[1] && <span className="text-zinc-200">{line.split('NOT NULL')[1]}</span>}
                      </span>
                    );
                  }
                  return (
                    <div key={idx} className="whitespace-pre">
                      {lineEl}
                    </div>
                  );
                })}
              </code>
            </pre>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950/70 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-zinc-500 font-mono">
            Generated DDL definition complies with active database dialect
          </span>
          <div className="flex items-center gap-2">
            {onOpenInEditor && (
              <Button
                size="sm"
                variant="yellow"
                onClick={() => {
                  onClose();
                  onOpenInEditor(ddl);
                }}
                className="h-8 text-xs font-semibold"
              >
                <Terminal className="w-3.5 h-3.5 mr-1.5" />
                Open in SQL Editor
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={onClose}
              className="h-8 text-xs bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100"
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
