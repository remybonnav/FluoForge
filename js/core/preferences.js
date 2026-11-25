/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 Remy Bonnavion
 */
/* User preferences. Each preference is one entry of PREFERENCES; adding a preference means adding an
   entry (and reading it with getPreference where it is used). The Preferences dialog
   (js/ui/preferences-dialog.js) builds its rows from this list.

   Where a value comes from, first match wins:
     1. the open project's override: docProps.preferences[key] (saved with the project, undoable);
     2. the global value: localStorage 'fluoforge-preferences' ({ version, values }), for every project;
     3. the entry's default.
   Values are checked against their entry; an invalid one is ignored. Keys this version does not know
   (from a newer FluoForge) are kept unchanged in both places. */

import { pushHistory } from './history.js';
import { applyDocProps } from './pages.js';
import { docProps } from './state.js';

export const STORAGE_KEY = 'fluoforge-preferences';
export const STORAGE_VERSION = 1;
export const SNAP_EDGES = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];
export const FONTS = ['Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];
/** The bundled fonts by what they replace: they have the metrics of these fonts (the same widths). */
export const FONT_REPLACES = { 'Liberation Sans': 'Arial', 'Liberation Serif': 'Times New Roman', 'Liberation Mono': 'Courier New' };
/** A font's name as shown in lists: "Liberation Sans (Arial metrics)". */
export const fontLabel = family => (FONT_REPLACES[family] ? `${family} (${FONT_REPLACES[family]} metrics)` : family);

/** Sections in dialog order. */
export const SECTIONS = [
  { id: 'snapping', label: 'Snapping' },
  { id: 'text', label: 'Text' },
  { id: 'units', label: 'Units' },
  { id: 'view', label: 'Rulers and guides' }
];

/** type: 'boolean' | 'number' (min, max, step) | 'choice' (options) | 'set' (options: any subset) | 'color' | 'font'.
    options: [{ value, label }]. help: one sentence shown as the row's title. */
export const PREFERENCES = [
  { key: 'snap.enabled', section: 'snapping', label: 'Snap while dragging', type: 'boolean', default: true,
    help: 'Snap a dragged object to page and object edges. Hold Alt while dragging to move freely.' },
  { key: 'snap.toPage', section: 'snapping', label: 'Snap to the page', type: 'boolean', default: true,
    help: 'Snap to the edges and centre lines of the pages.' },
  { key: 'snap.toObjects', section: 'snapping', label: 'Snap to other objects', type: 'boolean', default: true,
    help: 'Snap to the edges and centre lines of the other objects.' },
  { key: 'snap.edges', section: 'snapping', label: 'Snap these edges', type: 'set', default: SNAP_EDGES.slice(),
    options: [{ value: 'left', label: 'Left' }, { value: 'hcenter', label: 'Centre' }, { value: 'right', label: 'Right' },
      { value: 'top', label: 'Top' }, { value: 'vcenter', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }],
    help: 'Which edges of the dragged object and of the targets line up: left, centre (vertical centre line) and right snap horizontally; top, middle (horizontal centre line) and bottom snap vertically.' },
  { key: 'snap.distance', section: 'snapping', label: 'Snap distance (screen px)', type: 'number', default: 8, min: 2, max: 40, step: 1,
    help: 'How close, in pixels on screen, an edge must come to snap. The same at every zoom level.' },
  { key: 'snap.guides', section: 'snapping', label: 'Show snap guides', type: 'boolean', default: true,
    help: 'Draw a line along the edge an object snapped to while dragging. Guides are never exported.' },
  { key: 'snap.toGuides', section: 'snapping', label: 'Snap to guides', type: 'boolean', default: true,
    help: 'Snap object edges and centres to the guides dragged from the rulers, and to the margin and column guides.' },
  { key: 'snap.spacing', section: 'snapping', label: 'Snap to equal spacing', type: 'boolean', default: true,
    help: 'While dragging, give an object the same gap as two other objects of its row or column, or centre it between its neighbours, and mark the equal gaps.' },
  { key: 'text.fontFamily', section: 'text', label: 'Default font', type: 'font', default: 'Liberation Sans',
    help: 'Font of new text boxes. PDF export embeds the Liberation fonts only.' },
  { key: 'text.fontSize', section: 'text', label: 'Default size (document px)', type: 'number', default: 24, min: 1, max: 1000, step: 1,
    help: 'Font size of new text boxes, in document pixels (at 300 dpi, 24 px is 5.8 pt).' },
  { key: 'text.color', section: 'text', label: 'Default colour', type: 'color', default: '#000000',
    help: 'Colour of new text boxes.' },
  { key: 'units.size', section: 'units', label: 'Size units', type: 'choice', default: 'mm-pt',
    options: [{ value: 'mm-pt', label: 'mm and pt (print size)' }, { value: 'px', label: 'Document px' }],
    help: 'Units of the size fields: positions and sizes in mm, line widths and font sizes in pt, at the document\'s dpi; or document pixels.' },
  { key: 'view.rulers', section: 'view', label: 'Show rulers', type: 'boolean', default: true,
    help: 'Rulers along the top and left of the canvas, in the document unit. Drag from a ruler to make a guide.' },
  { key: 'view.guides', section: 'view', label: 'Show guides', type: 'boolean', default: true,
    help: 'Show the guides, and the margin and column guides. Guides are never exported.' }
];
const byKey = new Map(PREFERENCES.map(def => [def.key, def]));
export const preferenceDef = key => byKey.get(key);

/** The value if it is valid for the entry, else undefined. */
export function validPreference(def, value) {
  if (!def) return undefined;
  switch (def.type) {
    case 'boolean': return typeof value === 'boolean' ? value : undefined;
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      return value < def.min || value > def.max ? undefined : value;
    }
    case 'choice': return def.options.some(o => o.value === value) ? value : undefined;
    case 'font': return typeof value === 'string' && value.trim() && value.length <= 100 ? value : undefined;
    case 'color': return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
    case 'set': {
      if (!Array.isArray(value)) return undefined;
      const allowed = def.options.map(o => o.value);
      return value.every(v => allowed.includes(v)) ? allowed.filter(v => value.includes(v)) : undefined;
    }
    default: return undefined;
  }
}
const copy = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// ---- global (this browser) ----
function readStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (parsed && typeof parsed === 'object' && parsed.values && typeof parsed.values === 'object') return parsed;
  } catch (_) { /* Preferences are optional: defaults apply. */ }
  return { version: STORAGE_VERSION, values: {} };
}
let store = readStore();
function writeStore() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...store, version: Math.max(STORAGE_VERSION, store.version || 0) })); }
  catch (_) { /* Not stored (private window, storage full): the value still applies until the page closes. */ }
}
/** Reads the stored global values again (another tab, or a test). */
export function reloadGlobalPreferences() { store = readStore(); notify(null); }

// ---- project ----
const projectValues = () => (docProps && docProps.preferences && typeof docProps.preferences === 'object' ? docProps.preferences : {});

const listeners = new Set();
/** Calls fn(key) after a preference changes (key null: possibly all of them). Returns an unsubscribe function. */
export function onPreferenceChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify(key) { listeners.forEach(fn => { try { fn(key); } catch (error) { console.error(error); } }); }
// Undo, redo and opening a project change docProps.preferences.
window.addEventListener('mfc:changed', () => notify(null));

export function globalPreference(key) {
  const def = byKey.get(key), stored = validPreference(def, store.values[key]);
  return copy(stored !== undefined ? stored : def ? def.default : undefined);
}
export const isProjectOverride = key => validPreference(byKey.get(key), projectValues()[key]) !== undefined;
/** The value in effect: the project's override, else the global value, else the default. */
export function getPreference(key) {
  const own = validPreference(byKey.get(key), projectValues()[key]);
  return own !== undefined ? copy(own) : globalPreference(key);
}

/** Sets the global value (for every project without its own). Returns false when the value is invalid. */
export function setGlobalPreference(key, value) {
  const valid = validPreference(byKey.get(key), value);
  if (valid === undefined) return false;
  store = { ...store, values: { ...store.values, [key]: valid } };
  writeStore(); notify(key);
  return true;
}
/** Forgets every global value this version knows (keys of newer versions are kept). */
export function resetGlobalPreferences() {
  const values = Object.fromEntries(Object.entries(store.values).filter(([key]) => !byKey.has(key)));
  store = { ...store, values };
  writeStore(); notify(null);
}

/** Sets this project's own value (one undo step); undefined removes the override. Returns false when invalid. */
export function setProjectPreference(key, value) {
  const def = byKey.get(key);
  if (!def || !documentReady()) return false;
  const next = { ...projectValues() };
  if (value === undefined) delete next[key];
  else {
    const valid = validPreference(def, value);
    if (valid === undefined) return false;
    next[key] = valid;
  }
  const props = { ...docProps, preferences: next };
  if (!Object.keys(next).length) delete props.preferences;
  applyDocProps(props);
  pushHistory();
  notify(key);
  return true;
}
const documentReady = () => !!(window.MFC && MFC.hasDocument);
