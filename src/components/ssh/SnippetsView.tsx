import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Copy, 
  Plus, 
  Trash2, 
  Edit2, 
  Search, 
  Tag, 
  Check, 
  Terminal, 
  Star, 
  Sparkles,
  ChevronRight,
  MoreVertical,
  X
} from 'lucide-react';
import { TerminalSnippet } from '../../types/database';

interface SnippetsViewProps {
  onRunSnippet?: (command: string, autoExecute: boolean) => void;
  onClose?: () => void;
}

export const SnippetsView: React.FC<SnippetsViewProps> = ({ onRunSnippet, onClose }) => {
  const [snippets, setSnippets] = useState<TerminalSnippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | number | null>(null);

  // Form State
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formCommand, setFormCommand] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formIsFavorite, setFormIsFavorite] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchSnippets = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/snippets');
      if (res.ok) {
        const data = await res.json();
        setSnippets(data);
      }
    } catch (err) {
      console.error('Failed to load snippets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSnippets();
  }, []);

  const allTags = Array.from(
    new Set(
      snippets.flatMap((s) =>
        s.tags
          ? s.tags
              .split(',')
              .map((t) => t.trim().toLowerCase())
              .filter(Boolean)
          : []
      )
    )
  );

  const filteredSnippets = snippets.filter((s) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      (s.title && s.title.toLowerCase().includes(q)) ||
      s.command.toLowerCase().includes(q) ||
      (s.tags && s.tags.toLowerCase().includes(q));

    const matchesTag =
      !selectedTag ||
      (s.tags &&
        s.tags
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .includes(selectedTag));

    return matchesSearch && matchesTag;
  });

  const handleCopy = async (snippet: TerminalSnippet) => {
    try {
      await navigator.clipboard.writeText(snippet.command);
      setCopiedId(snippet.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch (err) {
      console.warn('Failed to copy snippet:', err);
    }
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormTitle('');
    setFormCommand('');
    setFormTags('');
    setFormIsFavorite(false);
    setIsEditing(true);
  };

  const handleOpenEdit = (s: TerminalSnippet) => {
    setEditingId(s.id);
    setFormTitle(s.title || '');
    setFormCommand(s.command);
    setFormTags(s.tags || '');
    setFormIsFavorite(!!s.is_favorite);
    setIsEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCommand.trim()) return;

    try {
      setSaving(true);
      const payload = {
        title: formTitle.trim() || null,
        command: formCommand.trim(),
        tags: formTags.trim() || null,
        is_favorite: formIsFavorite ? 1 : 0,
      };

      if (editingId) {
        const res = await fetch(`/api/snippets/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          setIsEditing(false);
          fetchSnippets();
        }
      } else {
        const res = await fetch('/api/snippets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          setIsEditing(false);
          fetchSnippets();
        }
      }
    } catch (err) {
      console.error('Failed to save snippet:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string | number) => {
    if (!confirm('Are you sure you want to delete this snippet?')) return;
    try {
      const res = await fetch(`/api/snippets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchSnippets();
      }
    } catch (err) {
      console.error('Failed to delete snippet:', err);
    }
  };

  const handleToggleFavorite = async (s: TerminalSnippet) => {
    try {
      const res = await fetch(`/api/snippets/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_favorite: s.is_favorite ? 0 : 1 }),
      });
      if (res.ok) {
        fetchSnippets();
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#18181b] border-r border-[#27272a] text-zinc-200">
      {/* Top Header */}
      <div className="p-3 border-b border-[#27272a] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Snippets
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleOpenAdd}
            title="New Snippet"
            className="flex items-center gap-1 px-2 py-1 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30 rounded text-xs font-medium transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Close Snippets Panel"
              className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-[#27272a] rounded transition-colors ml-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Search & Tag Filter Bar */}
      <div className="p-2 border-b border-[#27272a] space-y-2 bg-[#121214]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search command, title or tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1e1e24] border border-[#2e2e38] rounded pl-8 pr-3 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500/60"
          />
        </div>

        {allTags.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
            <button
              onClick={() => setSelectedTag(null)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors shrink-0 ${
                selectedTag === null
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-[#27272a] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors shrink-0 flex items-center gap-1 ${
                  selectedTag === tag
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-[#27272a] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>#{tag}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Editor Modal / Inline Form */}
      {isEditing && (
        <form onSubmit={handleSave} className="p-3 border-b border-[#27272a] bg-[#1a1a20] space-y-2.5 animate-fadeIn">
          <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
            <span>{editingId ? 'Edit Snippet' : 'New Terminal Snippet'}</span>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="text-zinc-500 hover:text-zinc-300 text-xs"
            >
              Cancel
            </button>
          </div>

          <div>
            <label className="text-[10px] uppercase font-semibold text-zinc-400 block mb-1">
              Title (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Restart Docker App"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              className="w-full bg-[#121214] border border-[#2e2e38] rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/60"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-semibold text-zinc-400 block mb-1">
              Command <span className="text-emerald-400">*</span>
            </label>
            <textarea
              required
              rows={3}
              placeholder="docker compose restart web..."
              value={formCommand}
              onChange={(e) => setFormCommand(e.target.value)}
              className="w-full font-mono bg-[#121214] border border-[#2e2e38] rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/60 resize-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[10px] uppercase font-semibold text-zinc-400 block mb-1">
                Tags (comma separated)
              </label>
              <input
                type="text"
                placeholder="docker, restart, deploy"
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
                className="w-full bg-[#121214] border border-[#2e2e38] rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/60"
              />
            </div>
            <div className="pt-4">
              <button
                type="button"
                onClick={() => setFormIsFavorite(!formIsFavorite)}
                className={`p-1.5 rounded border transition-colors ${
                  formIsFavorite
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                    : 'border-[#2e2e38] bg-[#121214] text-zinc-500 hover:text-zinc-300'
                }`}
                title={formIsFavorite ? 'Favorited' : 'Add to Favorites'}
              >
                <Star className="w-4 h-4 fill-current" />
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-[#27272a] rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !formCommand.trim()}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded text-xs transition-colors"
            >
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {/* Snippet List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-xs text-zinc-500">
            Loading snippets...
          </div>
        ) : filteredSnippets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center p-4">
            <Sparkles className="w-8 h-8 text-zinc-600 mb-2 stroke-1" />
            <p className="text-xs text-zinc-400 font-medium">No snippets found</p>
            <p className="text-[11px] text-zinc-600 mt-1 max-w-[200px]">
              Save frequently used commands, docker scripts, or log tails.
            </p>
            <button
              onClick={handleOpenAdd}
              className="mt-3 px-2.5 py-1 text-xs bg-[#27272a] hover:bg-[#323238] text-zinc-300 rounded border border-[#3f3f46]"
            >
              Create Snippet
            </button>
          </div>
        ) : (
          filteredSnippets.map((snippet) => {
            const isCopied = copiedId === snippet.id;
            const snippetTags = snippet.tags
              ? snippet.tags.split(',').map((t) => t.trim()).filter(Boolean)
              : [];

            return (
              <div
                key={snippet.id}
                className="group relative bg-[#1c1c22] hover:bg-[#22222a] border border-[#27272f] hover:border-[#383844] rounded-lg p-2.5 transition-all shadow-sm"
              >
                {/* Header: Title or Command preview + Actions */}
                <div className="flex items-start justify-between gap-1 mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {!!snippet.is_favorite && (
                      <button
                        onClick={() => handleToggleFavorite(snippet)}
                        className="text-amber-400 hover:text-amber-300 transition-colors shrink-0"
                        title="Favorited (click to unfavorite)"
                      >
                        <Star className="w-3 h-3 fill-current" />
                      </button>
                    )}
                    {snippet.title ? (
                      <span className="text-xs font-semibold text-zinc-200 truncate">
                        {snippet.title}
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono text-zinc-400 truncate">
                        {snippet.command.split('\n')[0]}
                      </span>
                    )}
                  </div>

                  {/* 3-Dots Action Button & Dropdown */}
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuId(activeMenuId === snippet.id ? null : snippet.id);
                      }}
                      title="More actions"
                      className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-[#2e2e38] rounded transition-colors cursor-pointer"
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>

                    {activeMenuId === snippet.id && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(null);
                          }}
                        />
                        <div className="absolute right-0 top-7 z-50 w-36 py-1 rounded-md bg-[#1e1e24] border border-[#2f2f38] shadow-2xl text-xs flex flex-col">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(snippet);
                              setActiveMenuId(null);
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 text-zinc-300 hover:text-zinc-100 hover:bg-[#2a2a34] transition-colors text-left cursor-pointer"
                          >
                            {isCopied ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            )}
                            <span>{isCopied ? 'Copied!' : 'Copy'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEdit(snippet);
                              setActiveMenuId(null);
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 text-zinc-300 hover:text-zinc-100 hover:bg-[#2a2a34] transition-colors text-left cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            <span>Edit</span>
                          </button>

                          <div className="my-1 border-t border-[#2f2f38]" />

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(snippet.id);
                              setActiveMenuId(null);
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-left cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-400 shrink-0" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Command Snippet Block */}
                <div className="bg-[#121214] border border-[#232328] rounded p-2 text-xs font-mono text-emerald-400/90 whitespace-pre-wrap break-all select-text mb-2 max-h-24 overflow-y-auto">
                  {snippet.command}
                </div>

                {/* Tags & Action Buttons */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#27272f]/50">
                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                    {snippetTags.map((tag) => (
                      <span
                        key={tag}
                        onClick={() => setSelectedTag(tag.toLowerCase())}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-[#27272e] text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors shrink-0"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {onRunSnippet && (
                      <>
                        <button
                          onClick={() => onRunSnippet(snippet.command, false)}
                          title="Insert command into terminal without pressing enter"
                          className="px-2 py-0.5 bg-[#2a2a34] hover:bg-[#343442] text-zinc-300 text-[10px] font-medium rounded transition-colors flex items-center gap-1"
                        >
                          <ChevronRight className="w-3 h-3 text-zinc-400" />
                          <span>Insert</span>
                        </button>
                        <button
                          onClick={() => onRunSnippet(snippet.command, true)}
                          title="Run immediately in terminal"
                          className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-medium rounded transition-colors flex items-center gap-1 shadow-sm"
                        >
                          <Play className="w-2.5 h-2.5 fill-current" />
                          <span>Run</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
