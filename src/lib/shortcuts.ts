import { ShortcutActionId, ShortcutItem, ShortcutMap } from '../types/database';

export const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  {
    id: 'new_query',
    name: 'New Query Tab',
    category: 'Workspace',
    description: 'Open a new SQL query editor tab in the active database',
    defaultKey: 'Alt+T',
    currentKey: 'Alt+T',
  },
  {
    id: 'close_tab',
    name: 'Close Active Tab',
    category: 'Workspace',
    description: 'Close currently selected workspace tab',
    defaultKey: 'Ctrl+W',
    currentKey: 'Ctrl+W',
  },
  {
    id: 'toggle_sidebar',
    name: 'Toggle Sidebar Panel',
    category: 'Navigation',
    description: 'Collapse or expand the left connection & schema sidebar',
    defaultKey: 'Ctrl+B',
    currentKey: 'Ctrl+B',
  },
  {
    id: 'open_settings',
    name: 'Studio Settings',
    category: 'Navigation',
    description: 'Open or close application settings dialog',
    defaultKey: 'Ctrl+,',
    currentKey: 'Ctrl+,',
  },
  {
    id: 'new_terminal',
    name: 'New Terminal Tab',
    category: 'Remote',
    description: 'Open a new remote SSH terminal session tab',
    defaultKey: 'Alt+S',
    currentKey: 'Alt+S',
  },
  {
    id: 'disconnect',
    name: 'Disconnect Session',
    category: 'Database',
    description: 'Safely disconnect active database connection',
    defaultKey: 'Ctrl+Shift+Q',
    currentKey: 'Ctrl+Shift+Q',
  },
  {
    id: 'run_query',
    name: 'Execute SQL Query',
    category: 'Database',
    description: 'Execute highlighted SQL statement or full editor contents',
    defaultKey: 'Ctrl+Enter',
    currentKey: 'Ctrl+Enter',
  },
  {
    id: 'toggle_autocommit',
    name: 'Toggle Autocommit Mode',
    category: 'Database',
    description: 'Switch between automatic commit and manual transaction mode',
    defaultKey: 'Ctrl+Shift+A',
    currentKey: 'Ctrl+Shift+A',
  },
];

export const DEFAULT_SHORTCUT_MAP: ShortcutMap = DEFAULT_SHORTCUTS.reduce((acc, item) => {
  acc[item.id] = item.defaultKey;
  return acc;
}, {} as ShortcutMap);

/**
 * Format a string combo like 'Ctrl+Shift+Q' into readable display key badges
 */
export function formatShortcutKeys(combo: string): string[] {
  if (!combo) return [];
  return combo.split('+').map(part => {
    const trimmed = part.trim();
    if (trimmed.toLowerCase() === 'ctrl') return 'Ctrl';
    if (trimmed.toLowerCase() === 'alt') return 'Alt';
    if (trimmed.toLowerCase() === 'shift') return 'Shift';
    if (trimmed.toLowerCase() === 'cmd' || trimmed.toLowerCase() === 'meta') return '⌘';
    if (trimmed === ',') return ',';
    if (trimmed.toLowerCase() === 'enter') return 'Enter';
    if (trimmed.toLowerCase() === 'plus') return '+';
    return trimmed.toUpperCase();
  });
}

/**
 * Parse an active KeyboardEvent during interactive key recording
 * Returns null if only modifier keys are pressed, or a clean combo string (e.g. 'Ctrl+Shift+N')
 */
export function parseKeyboardEventToCombo(e: KeyboardEvent): string | null {
  // Ignore lone modifier presses
  if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) {
    return null;
  }

  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey && !e.ctrlKey) parts.push('Cmd');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key === '+') key = 'Plus';
  else if (key.length === 1) key = key.toUpperCase();

  // Special keys
  if (key === ',') parts.push(',');
  else if (key === '.') parts.push('.');
  else if (key === '/') parts.push('/');
  else parts.push(key);

  return parts.join('+');
}

/**
 * Check if a KeyboardEvent matches a shortcut combo string
 */
export function isShortcutMatch(e: KeyboardEvent, combo?: string): boolean {
  if (!combo) return false;

  const rawParts = combo.toLowerCase().split('+').map(p => p.trim());
  const needsCtrl = rawParts.includes('ctrl');
  const needsAlt = rawParts.includes('alt');
  const needsShift = rawParts.includes('shift');
  const needsMeta = rawParts.includes('cmd') || rawParts.includes('meta');

  // Key portion
  const keyPart = rawParts.find(p => !['ctrl', 'alt', 'shift', 'cmd', 'meta'].includes(p));
  if (!keyPart) return false;

  // Modifier match (Cross-platform Mac Cmd / PC Ctrl support)
  const metaMatches = needsMeta ? e.metaKey : (needsCtrl ? true : !e.metaKey);
  const ctrlMatches = needsCtrl
    ? (e.ctrlKey || (!needsMeta && e.metaKey))
    : !e.ctrlKey;
  const altMatches = needsAlt ? e.altKey : !e.altKey;
  const shiftMatches = needsShift ? e.shiftKey : !e.shiftKey;

  if (!ctrlMatches || !metaMatches || !altMatches || !shiftMatches) {
    return false;
  }

  // Key match
  const eventKey = e.key.toLowerCase();
  const eventCode = e.code.toLowerCase();

  if (keyPart === ',' && (eventKey === ',' || eventCode === 'comma')) return true;
  if (keyPart === '.' && (eventKey === '.' || eventCode === 'period')) return true;
  if (keyPart === '/' && (eventKey === '/' || eventCode === 'slash')) return true;
  if ((keyPart === 'plus' || keyPart === '+') && (eventKey === '+' || eventKey === '=' || eventCode === 'equal' || eventCode === 'numpadadd')) return true;
  if (keyPart === 'enter' && (eventKey === 'enter' || eventCode === 'enter' || eventCode === 'numpadenter')) return true;
  if (keyPart === 'space' && (eventKey === ' ' || eventCode === 'space')) return true;

  if (eventKey === keyPart) return true;
  if (eventCode === `key${keyPart}`) return true;
  if (eventCode === `digit${keyPart}`) return true;

  return false;
}
