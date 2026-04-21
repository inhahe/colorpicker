// ---------------------------------------------------------------------------
//  state.js  --  Central observable state store for the color picker
//
//  Provides:
//    - Path-based get/set with deep cloning
//    - Pub/sub with wildcard support and microtask batching
//    - Undo/redo (max 100 entries, color/picker changes only)
//    - localStorage persistence with debounced auto-save
//    - Saved-color management helpers
// ---------------------------------------------------------------------------

// ---- Default state --------------------------------------------------------

// #4A90D9 in sRGB = (74, 144, 217)
// Approximate CIE XYZ for that blue (D65, 0-1 scale):
const DEFAULT_XYZ = [0.2188, 0.2224, 0.6851];

export const DEFAULT_STATE = Object.freeze({
  currentColor: {
    xyz: DEFAULT_XYZ,
    sourceSpace: 'srgb',
    sourceValues: [74, 144, 217],
  },

  activeSpaces: ['srgb', 'hsb', 'hsl', 'lab', 'lch', 'adobergb', 'cmy', 'lms'],
  availableSpaces: [],

  picker: {
    spaceId: 'hsb',
    xAxis: 1,
    yAxis: 2,
    excluded: 0,
    excludedValue: 0,
    reversed: { x: false, y: false },
    rotAngle1: 0,
    rotAngle2: 0,
  },

  savedColors: [],

  activeCollection: null,

  gradient: {
    enabled: false,
    color1: null,
    color2: null,
    position: 0.5,
  },

  triangleGradient: {
    enabled: false,
    colors: [null, null, null],
  },

  accuracyMeters: {
    show: false,
    group: 'hsb',
  },

  infoPanel: {
    show: true,
    selectedSpace: 'srgb',
  },

  ui: {
    theme: 'dark',
  },

  paletteEditor: {
    open: false,
    currentPalette: null,
    savedPalettes: [],
  },
});

// ---- Path helpers ---------------------------------------------------------

function getByPath(obj, path) {
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

function setByPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) {
    if (cur[k] == null || typeof cur[k] !== 'object') {
      cur[k] = {};
    }
    cur = cur[k];
  }
  cur[last] = value;
}

function clone(v) {
  if (v === undefined || v === null || typeof v !== 'object') return v;
  return structuredClone(v);
}

// ---- Paths that record undo (color & picker changes, saved colors) --------

const UNDO_PREFIXES = [
  'currentColor',
  'picker',
  'savedColors',
  'gradient',
  'triangleGradient',
];

function isUndoable(path) {
  return UNDO_PREFIXES.some(p => path === p || path.startsWith(p + '.'));
}

// ---- Persistence key & debounce ------------------------------------------

const STORAGE_KEY = 'colorPickerState';
const SAVE_DEBOUNCE_MS = 500;

// ---- AppState class -------------------------------------------------------

export class AppState {
  /** @type {object} internal mutable state tree */
  #state;

  /** @type {Array<{paths: string[], old: object, next: object, ts: number}>} */
  #undoStack = [];
  /** @type {Array<{paths: string[], old: object, next: object, ts: number}>} */
  #redoStack = [];
  #maxUndo = 100;

  /** @type {Map<string, Set<Function>>} path -> callbacks */
  #subs = new Map();
  /** @type {Set<Function>} global listeners */
  #globalSubs = new Set();

  /** Pending notifications (coalesced via microtask) */
  #pendingNotifications = new Map();  // path -> {newVal, oldVal}
  #microtaskScheduled = false;

  /** Debounced save timer id */
  #saveTimer = null;

  // -------------------------------------------------------------------

  constructor(initialState) {
    this.#state = initialState
      ? clone(initialState)
      : clone(DEFAULT_STATE);
  }

  // ---- get / set --------------------------------------------------------

  /** Return a deep-cloned value at `path`. */
  get(path) {
    return clone(getByPath(this.#state, path));
  }

  /**
   * Set a value at `path`. Records undo for undoable paths, notifies
   * subscribers, and schedules a debounced save.
   */
  set(path, value) {
    const oldVal = clone(getByPath(this.#state, path));
    const newVal = clone(value);

    setByPath(this.#state, path, newVal);

    // Undo
    if (isUndoable(path)) {
      this.#pushUndo([{ path, oldVal, newVal }]);
    }

    this.#enqueueNotification(path, newVal, oldVal);
    this.#scheduleSave();
  }

  /**
   * Apply multiple path/value pairs atomically. A single compound undo
   * entry is recorded and subscribers are notified once per affected path.
   */
  batch(updates) {
    const entries = [];

    for (const [path, value] of Object.entries(updates)) {
      const oldVal = clone(getByPath(this.#state, path));
      const newVal = clone(value);
      setByPath(this.#state, path, newVal);
      entries.push({ path, oldVal, newVal });
      this.#enqueueNotification(path, newVal, oldVal);
    }

    // One compound undo entry for all undoable paths in the batch
    const undoable = entries.filter(e => isUndoable(e.path));
    if (undoable.length > 0) {
      this.#pushUndo(undoable);
    }

    this.#scheduleSave();
  }

  // ---- Subscriptions ----------------------------------------------------

  /**
   * Subscribe to changes at `path`. Supports wildcards:
   *   'picker.*'  matches any change whose path starts with 'picker.'
   *   'picker'    matches 'picker' exactly AND any deeper path
   *
   * Returns an unsubscribe function.
   * Callback signature: (newValue, oldValue, changedPath)
   */
  subscribe(path, callback) {
    if (!this.#subs.has(path)) {
      this.#subs.set(path, new Set());
    }
    this.#subs.get(path).add(callback);

    return () => {
      const set = this.#subs.get(path);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.#subs.delete(path);
      }
    };
  }

  /** Subscribe to every change. Returns an unsubscribe function. */
  onChange(callback) {
    this.#globalSubs.add(callback);
    return () => this.#globalSubs.delete(callback);
  }

  // ---- Undo / Redo ------------------------------------------------------

  undo() {
    if (this.#undoStack.length === 0) return false;

    const entry = this.#undoStack.pop();
    const redoEntries = [];

    for (const { path, oldVal } of entry.changes) {
      const currentVal = clone(getByPath(this.#state, path));
      redoEntries.push({ path, oldVal: currentVal, newVal: oldVal });
      setByPath(this.#state, path, clone(oldVal));
      this.#enqueueNotification(path, oldVal, currentVal);
    }

    this.#redoStack.push({ changes: redoEntries, ts: Date.now() });
    this.#scheduleSave();
    return true;
  }

  redo() {
    if (this.#redoStack.length === 0) return false;

    const entry = this.#redoStack.pop();
    const undoEntries = [];

    for (const { path, newVal } of entry.changes) {
      const currentVal = clone(getByPath(this.#state, path));
      undoEntries.push({ path, oldVal: currentVal, newVal });
      setByPath(this.#state, path, clone(newVal));
      this.#enqueueNotification(path, newVal, currentVal);
    }

    this.#undoStack.push({ changes: undoEntries, ts: Date.now() });
    this.#scheduleSave();
    return true;
  }

  canUndo() { return this.#undoStack.length > 0; }
  canRedo() { return this.#redoStack.length > 0; }

  // ---- Persistence ------------------------------------------------------

  /** Serialize current state to localStorage. */
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#state));
    } catch { /* quota exceeded — silently ignore */ }
  }

  /**
   * Load state from localStorage, merging with defaults so new fields
   * added in future versions are picked up. Returns true if data was found.
   */
  load() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch { return false; }

    if (!raw) return false;

    let saved;
    try {
      saved = JSON.parse(raw);
    } catch { return false; }

    // Deep merge: defaults as base, saved values overlay
    this.#state = deepMerge(clone(DEFAULT_STATE), saved);
    return true;
  }

  /**
   * Reset to defaults but preserve savedColors, savedPalettes, and
   * triangle/gradient saved data the user may have built up.
   */
  cleanSlate() {
    const keep = {
      savedColors: clone(this.#state.savedColors),
      savedPalettes: clone(this.#state.paletteEditor?.savedPalettes ?? []),
    };

    this.#state = clone(DEFAULT_STATE);
    this.#state.savedColors = keep.savedColors;
    this.#state.paletteEditor.savedPalettes = keep.savedPalettes;

    this.#undoStack.length = 0;
    this.#redoStack.length = 0;

    // Notify everything
    this.#enqueueNotification('', clone(this.#state), null);
    this.save();
  }

  // ---- Saved colors helpers ---------------------------------------------

  addSavedColor(color) {
    const list = clone(this.#state.savedColors);
    list.push({
      sourceSpace: color.sourceSpace,
      sourceValues: clone(color.sourceValues),
      xyz: clone(color.xyz),
      name: color.name || null,
      timestamp: Date.now(),
    });
    this.set('savedColors', list);
  }

  removeSavedColor(index) {
    const list = clone(this.#state.savedColors);
    if (index < 0 || index >= list.length) return;
    list.splice(index, 1);
    this.set('savedColors', list);
  }

  reorderSavedColor(fromIndex, toIndex) {
    const list = clone(this.#state.savedColors);
    if (
      fromIndex < 0 || fromIndex >= list.length ||
      toIndex < 0 || toIndex >= list.length
    ) return;
    const [item] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, item);
    this.set('savedColors', list);
  }

  // ---- Snapshot ---------------------------------------------------------

  /** Return a deep-cloned read-only copy of the entire state tree. */
  snapshot() {
    return clone(this.#state);
  }

  // ---- Internal: undo stack management ----------------------------------

  #pushUndo(changeArray) {
    this.#undoStack.push({
      changes: changeArray.map(e => ({
        path: e.path,
        oldVal: e.oldVal,
        newVal: e.newVal,
      })),
      ts: Date.now(),
    });

    if (this.#undoStack.length > this.#maxUndo) {
      this.#undoStack.splice(0, this.#undoStack.length - this.#maxUndo);
    }

    // Any new mutation clears the redo stack
    this.#redoStack.length = 0;
  }

  // ---- Internal: notification batching ----------------------------------

  #enqueueNotification(path, newVal, oldVal) {
    this.#pendingNotifications.set(path, { newVal, oldVal });

    if (!this.#microtaskScheduled) {
      this.#microtaskScheduled = true;
      queueMicrotask(() => this.#flushNotifications());
    }
  }

  #flushNotifications() {
    this.#microtaskScheduled = false;

    const pending = new Map(this.#pendingNotifications);
    this.#pendingNotifications.clear();

    for (const [changedPath, { newVal, oldVal }] of pending) {
      // 1) Exact-match subscribers
      this.#notifySet(changedPath, newVal, oldVal, changedPath);

      // 2) Wildcard / parent subscribers
      //    'a.b.c' should notify 'a.b.*', 'a.b', 'a.*', 'a', '*'
      const parts = changedPath.split('.');
      for (let i = parts.length - 1; i >= 1; i--) {
        const parent = parts.slice(0, i).join('.');
        this.#notifySet(parent + '.*', newVal, oldVal, changedPath);
        this.#notifySet(parent, newVal, oldVal, changedPath);
      }
      // Top-level wildcard
      this.#notifySet('*', newVal, oldVal, changedPath);

      // 3) Root '' listener (used by cleanSlate to signal full reset)
      if (changedPath === '') {
        this.#notifySet('', newVal, oldVal, changedPath);
      }
    }

    // 4) Global onChange listeners
    for (const cb of this.#globalSubs) {
      try { cb(pending); } catch (err) { console.error('[state] onChange error:', err); }
    }
  }

  #notifySet(subPath, newVal, oldVal, changedPath) {
    const set = this.#subs.get(subPath);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(clone(newVal), clone(oldVal), changedPath);
      } catch (err) {
        console.error(`[state] subscriber error at "${subPath}":`, err);
      }
    }
  }

  // ---- Internal: debounced auto-save ------------------------------------

  #scheduleSave() {
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.save();
    }, SAVE_DEBOUNCE_MS);
  }
}

// ---- Deep-merge utility ---------------------------------------------------

/**
 * Recursively merge `src` into `base`. Arrays from src replace (not concat).
 * Returns the mutated `base`.
 */
function deepMerge(base, src) {
  if (src == null || typeof src !== 'object' || Array.isArray(src)) {
    return src;
  }
  if (typeof base !== 'object' || base === null || Array.isArray(base)) {
    return clone(src);
  }

  for (const key of Object.keys(src)) {
    if (
      typeof src[key] === 'object' && src[key] !== null &&
      !Array.isArray(src[key]) &&
      typeof base[key] === 'object' && base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      deepMerge(base[key], src[key]);
    } else {
      base[key] = clone(src[key]);
    }
  }
  return base;
}
