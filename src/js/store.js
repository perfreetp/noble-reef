/**
 * Editor state: document, selection, tool mode, worker results, history.
 *
 * All document mutations flow through transactions so one drag or one slider
 * gesture produces exactly one undo entry.
 */

import { groupOfElement } from '../model/doc.js';

const HISTORY_LIMIT = 100;

export class Store {
  constructor(doc) {
    this.state = {
      doc,
      selection: [],
      gizmo: 'translate',
      placingType: null,
      category: 'ramp',
      payload: null,
      overlaps: [],
      engine: 'loading',
      engineMessage: '正在载入几何引擎…',
      dirty: false,
      savedAt: null,
      buildError: '',
      stats: null,
      statusHint: '从左侧元素库开始搭建，或先从示例场地入手',
      showHelp: false,
      toastSeq: 0,
      buildEpoch: 0,
      focusMember: null,
    };
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.tx = null;
  }

  get doc() {
    return this.state.doc;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason = 'state') {
    for (const fn of this.listeners) {
      try {
        fn(this.state, reason);
      } catch (err) {
        console.error('[store] listener failed', err);
      }
    }
  }

  set(patch, reason = 'state') {
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (this.state[k] !== v) {
        this.state[k] = v;
        changed = true;
      }
    }
    if (changed) this.emit(reason);
  }

  /* --------------------------------------------------------- transactions */

  beginTransaction(label = 'edit') {
    if (this.tx) this.commitTransaction();
    this.tx = { label, doc: this.state.doc, selection: [...this.state.selection], changed: false };
  }

  /** Update the doc inside the current transaction (or an implicit one-off). */
  live(nextDoc, { reason = 'doc-live' } = {}) {
    if (!nextDoc) return;
    if (!this.tx) this.beginTransaction('edit');
    this.tx.changed = true;
    this.state.doc = nextDoc;
    this.state.selection = this.state.selection.filter((id) => this.exists(nextDoc, id));
    this.state.dirty = true;
    this.state.buildError = '';
    this.emit(reason);
  }

  /** Single-step edit with automatic transaction boundaries. */
  commit(nextDoc, { label = 'edit', selection } = {}) {
    this.beginTransaction(label);
    this.live(nextDoc);
    if (selection) {
      this.state.selection = selection.filter((id) => this.exists(nextDoc, id));
    }
    this.commitTransaction();
  }

  commitTransaction() {
    if (!this.tx) return;
    const tx = this.tx;
    this.tx = null;
    if (!tx.changed) return;
    this.undoStack.push({ doc: tx.doc, selection: tx.selection, label: tx.label });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.state.dirty = true;
    this.emit('doc');
  }

  cancelTransaction() {
    if (!this.tx) return;
    const tx = this.tx;
    this.tx = null;
    if (tx.changed) {
      this.state.doc = tx.doc;
      this.state.selection = tx.selection;
      this.emit('doc');
    }
  }

  exists(doc, id) {
    return doc.elements.some((e) => e.id === id) || doc.groups.some((g) => g.id === id);
  }

  setSettings(patch, { record = false } = {}) {
    const doc = {
      ...this.state.doc,
      settings: { ...this.state.doc.settings, ...patch },
      updatedAt: new Date().toISOString(),
    };
    if (record) {
      this.commit(doc, { label: '设置' });
      return;
    }
    // View preferences are not document edits: keep them out of history but
    // still persist them with autosave.
    this.state.doc = doc;
    this.state.dirty = true;
    this.emit('settings');
  }

  /* -------------------------------------------------------------- history */

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ doc: this.state.doc, selection: this.state.selection, label: entry.label });
    this.state.doc = entry.doc;
    this.state.selection = entry.selection.filter((id) => this.exists(entry.doc, id));
    this.state.dirty = true;
    this.state.buildError = '';
    this.emit('doc');
    return entry.label;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ doc: this.state.doc, selection: this.state.selection, label: entry.label });
    this.state.doc = entry.doc;
    this.state.selection = entry.selection.filter((id) => this.exists(entry.doc, id));
    this.state.dirty = true;
    this.state.buildError = '';
    this.emit('doc');
    return entry.label;
  }

  /* ------------------------------------------------------------ selection */

  selectionKind() {
    const { doc, selection } = this.state;
    if (!selection.length) return 'none';
    if (selection.length > 1) return 'multi';
    const id = selection[0];
    if (doc.groups.some((g) => g.id === id)) return 'group';
    if (doc.elements.some((e) => e.id === id)) return 'element';
    return 'none';
  }

  setSelection(ids, { toggle = false, additive = false } = {}) {
    const current = this.state.selection;
    let next;
    if (toggle) {
      const id = ids[0];
      next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    } else if (additive) {
      next = [...current];
      for (const id of ids) if (!next.includes(id)) next.push(id);
    } else {
      next = [...ids];
    }
    this.state.selection = next;
    this.emit('selection');
  }

  clearSelection() {
    if (!this.state.selection.length) return;
    this.state.selection = [];
    this.emit('selection');
  }

  groupOf(elementId) {
    return groupOfElement(this.state.doc, elementId);
  }

  markSaved() {
    this.state.dirty = false;
    this.state.savedAt = new Date();
    this.emit('save');
  }
}
