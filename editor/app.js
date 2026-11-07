// @ts-check
/** @import { BTNode, Warning } from './types.js' */
import { NodeTypes } from './nodes.js';
import { History } from './history.js';
import { Serialization } from './serialization.js';
import { Validation } from './validation.js';
import { Canvas } from './canvas.js';
import { Properties } from './properties.js';
import { ContextMenus } from './context-menus.js';
import { activeTabId, createTab, initTabs, renderTabs, switchTab, tabs } from './tab-manager.js';
import { TEMPLATES, initToolbar, saveAsTemplate, updatePaletteCounts } from './toolbar.js';
import { initPanels, initResizers, outlineOpen, updateOutline } from './panels.js';
import { initDialogs, openAI, showOnboarding } from './dialogs.js';
import { copyAsImage, extractSubtreeToClipboard, initFileIO, initPersistence, pasteFromClipboard } from './file-io.js';
import { initKeyboardShortcuts, resetWarningIdx } from './keyboard-shortcuts.js';

/** Main app — owns the editor state and wires the modules together. */

export let state = { title: "Untitled", description: "", root: "", nodes: [] };
export let dirty = false;
/**
 * Set the unsaved-changes flag without updating the UI (tab switching).
 * @param {boolean} d
 */
export function setDirtyFlag(d) { dirty = d; }

export const ctxMenu = document.getElementById("context-menu");

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("canvas"));
const minimap = /** @type {HTMLCanvasElement} */ (document.getElementById("minimap"));
const propsEl = document.getElementById("props-content");

// --- Toast ---
/** @param {string} msg Shown briefly at the bottom of the window. */
export function toast(msg) {
  let el = /** @type {HTMLElement & {_t?: any}} */ (document.getElementById("toast"));
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2000);
}

// --- History / State ---
/** Snapshot the current state onto the undo stack. */
export function pushHistory() {
  const { tree, layout } = Serialization.toJSON(state);
  History.push({ tree, layout });
}

/**
 * Set the unsaved-changes flag and refresh the title, tab label and stats tooltip.
 * @param {boolean} d
 */
export function setDirty(d) {
  dirty = d;
  const title = state.title || "Untitled";
  const el = document.getElementById("tree-title");
  el.textContent = dirty ? title + " *" : title;
  const countStr = state.nodes.length > 0 ? ` (${state.nodes.length})` : "";
  document.title = (dirty ? "* " : "") + title + countStr + " — BT Editor";
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (activeTab) { activeTab.title = title; activeTab.dirty = dirty; renderTabs(); }
  // Every load path (examples, library, files, drag-and-drop) ends here: drop the empty-canvas hints once there's a tree.
  document.getElementById("empty-examples").classList.toggle("hidden", state.nodes.length > 0);
  // Stats tooltip
  if (state.nodes.length > 0) {
    let conn = 0;
    const cats = { composite: 0, decorator: 0, leaf: 0 };
    for (const n of state.nodes) { conn += n.children.length; cats[n.category] = (cats[n.category] || 0) + 1; }
    el.title = `${state.nodes.length} nodes · ${conn} connections\n${cats.composite} composites · ${cats.decorator} decorators · ${cats.leaf} leaves\nDouble-click to rename`;
  } else {
    el.title = "Double-click to rename";
  }
}

export function updateUndoRedoButtons() {
  const undoBtn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-undo"));
  const redoBtn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-redo"));
  undoBtn.disabled = !History.canUndo();
  redoBtn.disabled = !History.canRedo();
  undoBtn.title = History.canUndo() ? `Undo (Ctrl+Z) — ${History.getUndoCount()} step${History.getUndoCount() !== 1 ? "s" : ""}` : "Nothing to undo";
  redoBtn.title = History.canRedo() ? `Redo (Ctrl+Shift+Z) — ${History.getRedoCount()} step${History.getRedoCount() !== 1 ? "s" : ""}` : "Nothing to redo";
}

/** Re-run validation and update the warning badge. */
export function updateWarnings() {
  const w = validate();
  const wd = validateDetailed();
  state._warningIds = new Set(wd.filter(x => x.nodeId).map(x => x.nodeId));
  const badge = document.getElementById("warning-badge");
  if (w.length > 0) {
    badge.textContent = w.length + " warning" + (w.length > 1 ? "s" : "");
    badge.title = "Click to cycle through warnings\n" + w.join("\n");
    badge.classList.remove("hidden");
    resetWarningIdx();
  } else {
    badge.classList.add("hidden");
  }
}

export let _extraOnChanged = [];
/** Call after any edit: redraw, record history, mark dirty, refresh panels. */
export function onChanged() {
  Canvas.notifyChanged();
  pushHistory();
  setDirty(true);
  updateUndoRedoButtons();
  updateWarnings();
  updatePaletteCounts();
  document.getElementById("node-count").textContent = state.nodes.length > 0 ? state.nodes.length + " nodes" : "";
  document.getElementById("empty-examples").classList.toggle("hidden", state.nodes.length > 0);
  for (const fn of _extraOnChanged) fn();
}

function onSelect(ids) {
  Properties.show(ids);
  updateBreadcrumb(ids);
  updateSelectionInfo(ids);
  if (outlineOpen) updateOutline();
}

// --- Selection info bar ---
const selInfoEl = document.createElement("div");
function updateSelectionInfo(ids) {
  if (ids.length < 2) { selInfoEl.classList.remove("visible"); return; }
  const counts = {};
  for (const id of ids) {
    const n = state.nodes.find(nd => nd.id === id);
    if (n) { const cat = NodeTypes.categoryOf(n.type); counts[cat] = (counts[cat] || 0) + 1; }
  }
  const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`);
  selInfoEl.textContent = `${ids.length} selected: ${parts.join(", ")}`;
  selInfoEl.classList.add("visible");
}

// --- Breadcrumb ---
const breadcrumbEl = document.getElementById("breadcrumb");

function updateBreadcrumb(ids) {
  breadcrumbEl.textContent = "";
  if (ids.length !== 1) return;
  const nodeById = {};
  for (const n of state.nodes) nodeById[n.id] = n;
  const path = [];
  let cur = ids[0];
  const visited = new Set();
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    path.unshift(cur);
    const parent = state.nodes.find(n => n.children.includes(cur));
    cur = parent ? parent.id : null;
  }
  for (let i = 0; i < path.length; i++) {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "bc-sep";
      sep.textContent = ">";
      breadcrumbEl.appendChild(sep);
    }
    const seg = document.createElement("span");
    seg.className = "bc-seg" + (i === path.length - 1 ? " active" : "");
    const n = nodeById[path[i]];
    const icon = n ? (NodeTypes.ICONS[n.type] || "") : "";
    seg.textContent = n ? `${icon} ${n.name}` : path[i];
    const nid = path[i];
    seg.addEventListener("click", () => Canvas.focusNode(nid));
    breadcrumbEl.appendChild(seg);
  }
}

function restoreState(snapshot, msg) {
  const s = Serialization.fromJSON(snapshot.tree, snapshot.layout);
  state.title = s.title;
  state.description = s.description;
  state.root = s.root;
  state.nodes = s.nodes;
  Canvas.notifyChanged();
  Properties.show(Canvas.getSelectedIds());
  setDirty(true);
  updateUndoRedoButtons();
  updateWarnings();
  updatePaletteCounts();
  document.getElementById("empty-examples").classList.toggle("hidden", state.nodes.length > 0);
  if (msg) toast(msg);
  for (const fn of _extraOnChanged) fn();
}

// --- Context menu ---

function showContextMenu(node, cx, cy) { ContextMenus.showContextMenu(node, cx, cy); }
/** @param {Object[]} items */
export function renderCtxItems(items) { ContextMenus.renderCtxItems(items); }
/**
 * @param {number} cx
 * @param {number} cy
 */
export function positionCtxMenu(cx, cy) { ContextMenus.positionCtxMenu(cx, cy); }
function showConnectionContextMenu(conn, cx, cy) { ContextMenus.showConnectionContextMenu(conn, cx, cy); }

function wrapInDecorator(node, type) {
  const wrapper = {
    id: Serialization.uid(),
    type,
    category: "decorator",
    name: type.charAt(0).toUpperCase() + type.slice(1),
    children: [node.id],
    parameters: NodeTypes.defaultParams(type),
    x: node.x,
    y: node.y - 80,
  };
  // Replace node with wrapper in parent's children
  const parent = state.nodes.find(n => n.children.includes(node.id));
  if (parent) {
    const idx = parent.children.indexOf(node.id);
    parent.children[idx] = wrapper.id;
  }
  if (state.root === node.id) state.root = wrapper.id;
  state.nodes.push(wrapper);
  Canvas.notifyChanged();
  onChanged();
  Canvas.focusNode(wrapper.id);
}

/**
 * Replace a decorator with its only child.
 * @param {BTNode} node
 */
export function unwrapDecorator(node) {
  if (node.children.length !== 1) return;
  const childId = node.children[0];
  const child = state.nodes.find(n => n.id === childId);
  const parent = state.nodes.find(n => n.children.includes(node.id));
  if (parent) {
    const idx = parent.children.indexOf(node.id);
    parent.children[idx] = childId;
  }
  if (state.root === node.id) state.root = childId;
  if (child) { child.x = node.x; child.y = node.y; }
  state.nodes = state.nodes.filter(n => n.id !== node.id);
  Canvas.notifyChanged();
  onChanged();
  Canvas.focusNode(childId);
  toast("Unwrapped " + node.name);
}

function flattenComposite(node) {
  if (node.children.length === 0) { toast("No children to flatten"); return; }
  const parent = state.nodes.find(n => n.children.includes(node.id));
  if (!parent) { toast("Can't flatten root — no parent"); return; }
  const idx = parent.children.indexOf(node.id);
  parent.children.splice(idx, 1, ...node.children);
  state.nodes = state.nodes.filter(n => n.id !== node.id);
  Canvas.notifyChanged();
  onChanged();
  Canvas.setSelectedIds(node.children);
  toast(`Flattened ${node.name} — ${node.children.length} children moved to ${parent.name}`);
}

/** Wrap the selected nodes in a new Sequence. */
export function groupIntoSequence() {
  const sel = Canvas.getSelectedIds();
  if (sel.length < 1) { toast("Select nodes to group"); return; }
  const selSet = new Set(sel);
  const selNodes = sel.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
  if (selNodes.length === 0) return;
  // Find bounding box center
  let cx = 0, cy = Infinity;
  for (const n of selNodes) { cx += n.x; cy = Math.min(cy, n.y); }
  cx = cx / selNodes.length;
  const group = {
    id: Serialization.uid(),
    type: "sequence", category: "composite",
    name: "Group",
    children: sel.slice(),
    parameters: {},
    x: cx, y: cy - 90,
  };
  // Reparent: for each selected node, if it had a parent not in selection, replace with group
  const reparented = new Set();
  for (const n of state.nodes) {
    if (selSet.has(n.id)) continue;
    for (let i = 0; i < n.children.length; i++) {
      if (selSet.has(n.children[i]) && !reparented.has(n.id)) {
        n.children[i] = group.id;
        reparented.add(n.id);
      } else if (selSet.has(n.children[i])) {
        n.children.splice(i, 1);
        i--;
      }
    }
  }
  if (selSet.has(state.root)) state.root = group.id;
  state.nodes.push(group);
  Canvas.notifyChanged();
  Canvas.triggerSpawn([group.id]);
  Canvas.setSelectedIds([group.id]);
  onChanged();
  toast("Grouped " + sel.length + " nodes into Sequence");
}

function showQuickCreate(parentId, wx, wy, cx, cy) { ContextMenus.showQuickCreate(parentId, wx, wy, cx, cy); }
function showCanvasContextMenu(wx, wy, cx, cy) { ContextMenus.showCanvasContextMenu(wx, wy, cx, cy); }
/** @param {BTNode} node */
export function showTypePicker(node) { ContextMenus.showTypePicker(node); }
/** @param {BTNode} node */
export function showWrapPicker(node) { ContextMenus.showWrapPicker(node); }

// --- Validation ---
/** @returns {Warning[]} */
export function validateDetailed() { return Validation.validateDetailed(state); }

/** @returns {string[]} */
export function validate() { return Validation.validate(state); }

// --- Select all of type ---
/** @param {string} type */
export function selectAllOfType(type) {
  const ids = state.nodes.filter(n => n.type === type).map(n => n.id);
  Canvas.setSelectedIds(ids);
  toast(`Selected ${ids.length} ${type} node${ids.length !== 1 ? "s" : ""}`);
}

// --- Startup: same order as the original single-file app.js ---
initTabs();
selInfoEl.className = "selection-info";

// Init modules
History.init(restoreState);
Canvas.init(canvas, minimap, state, { onChanged, onSelect, onContextMenu: ContextMenus.showContextMenu, onRejectReason: msg => toast(msg), onConnectionContextMenu: ContextMenus.showConnectionContextMenu, onCanvasContextMenu: ContextMenus.showCanvasContextMenu, onConnectEmpty: ContextMenus.showQuickCreate });
Properties.init(propsEl, state, { onChanged });

// Append selection info bar
document.getElementById("main").appendChild(selInfoEl);
initToolbar();

pushHistory();
updateUndoRedoButtons();

ContextMenus.init({
  ctxMenu,
  state,
  callbacks: {
    onChanged, toast, wrapInDecorator, unwrapDecorator, flattenComposite,
    groupIntoSequence, selectAllOfType, extractSubtreeToClipboard, saveAsTemplate,
    openAI, pasteFromClipboard, copyAsImage, createTab, switchTab, renderTabs,
    tabs: () => tabs,
    TEMPLATES,
  },
});
document.addEventListener("mousedown", e => {
  if (!ctxMenu.contains(/** @type {Node} */ (e.target))) ctxMenu.classList.add("hidden");
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") ctxMenu.classList.add("hidden");
});
initPanels();
initDialogs();
initFileIO();
initKeyboardShortcuts();
canvas.addEventListener("contextmenu", e => e.preventDefault());
initPersistence();
initResizers();
showOnboarding();
