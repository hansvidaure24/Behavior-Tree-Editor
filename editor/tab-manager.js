import { History } from './history.js';
import { Serialization } from './serialization.js';
import { Canvas } from './canvas.js';
import { Properties } from './properties.js';
import { dirty, pushHistory, setDirty, setDirtyFlag, state, toast, updateUndoRedoButtons, updateWarnings } from './app.js';

/** Tab bar — several open trees, each kept as a serialized snapshot while inactive. */

// --- Multi-tree tabs ---
export let tabs = [];
export let activeTabId = null;
let tabCounter = 0;
const tabBar = document.getElementById("tab-bar");
export const tabAddBtn = document.getElementById("tab-add");

function newTabId() { return "tab-" + (++tabCounter); }

function snapshotTab() {
  const { tree, layout } = Serialization.toJSON(state);
  tree.title = state.title;
  tree.description = state.description;
  return { title: state.title, tree, layout, dirty };
}

export function createTab(title) {
  const id = newTabId();
  tabs.push({ id, title: title || "Untitled", tree: null, layout: null, dirty: false });
  return id;
}

export function switchTab(id) {
  if (activeTabId === id) return;
  // Save current tab state
  if (activeTabId) {
    const cur = tabs.find(t => t.id === activeTabId);
    if (cur) {
      const snap = snapshotTab();
      cur.tree = snap.tree;
      cur.layout = snap.layout;
      cur.title = snap.title;
      cur.dirty = snap.dirty;
    }
  }
  activeTabId = id;
  const tab = tabs.find(t => t.id === id);
  if (tab && tab.tree) {
    const s = Serialization.fromJSON(tab.tree, tab.layout || { version: "1.0", nodes: {} });
    state.title = tab.title || s.title;
    state.description = s.description;
    state.root = s.root;
    state.nodes = s.nodes;
    setDirtyFlag(tab.dirty);
    Canvas.notifyChanged();
    Canvas.exitIsolation();
    Canvas.centerView(true);
    History.clear();
    pushHistory();
    setDirty(dirty);
    updateUndoRedoButtons();
    updateWarnings();
    document.getElementById("tree-title").textContent = state.title + (dirty ? " *" : "");
  } else {
    // New empty tab
    state.title = tab ? tab.title : "Untitled";
    state.description = "";
    state.root = "";
    state.nodes = [];
    setDirtyFlag(false);
    Canvas.notifyChanged();
    Canvas.exitIsolation();
    Canvas.centerView(true);
    History.clear();
    pushHistory();
    setDirty(false);
  }
  Properties.show([]);
  renderTabs();
}

export function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  const tab = tabs[idx];
  const isDirty = id === activeTabId ? dirty : tab.dirty;
  if (isDirty && !confirm(`"${tab.title}" has unsaved changes. Close anyway?`)) return;
  if (tabs.length === 1) {
    tabs[0].tree = null;
    tabs[0].layout = null;
    tabs[0].title = "Untitled";
    tabs[0].dirty = false;
    switchTab(tabs[0].id);
    return;
  }
  tabs.splice(idx, 1);
  if (activeTabId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    switchTab(next.id);
  }
  renderTabs();
}

export function renderTabs() {
  tabBar.querySelectorAll(".tab-item").forEach(el => el.remove());
  for (const tab of tabs) {
    const el = document.createElement("div");
    el.className = "tab-item" + (tab.id === activeTabId ? " active" : "");
    const label = document.createElement("span");
    label.textContent = tab.title || "Untitled";
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";
    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "×";
    close.addEventListener("click", ev => { ev.stopPropagation(); closeTab(tab.id); });
    const nodeCount = tab.tree ? Object.keys(tab.tree.nodes || {}).length : (tab.id === activeTabId ? state.nodes.length : 0);
    if (nodeCount > 0 && tab.id !== activeTabId) {
      const count = document.createElement("span");
      count.className = "tab-count";
      count.textContent = nodeCount;
      el.append(label, count);
    } else {
      el.append(label);
    }
    if (tab.dirty && tab.id !== activeTabId) {
      const dot = document.createElement("span");
      dot.className = "tab-dirty";
      dot.textContent = "●";
      el.append(dot);
    }
    el.append(close);
    el.addEventListener("click", () => switchTab(tab.id));
    el.addEventListener("dblclick", () => {
      const name = prompt("Rename tab:", tab.title);
      if (name) { tab.title = name; if (tab.id === activeTabId) { state.title = name; setDirty(dirty); } renderTabs(); }
    });
    el.draggable = true;
    el.dataset.tabId = tab.id;
    el.addEventListener("dragstart", ev => {
      ev.dataTransfer.setData("tab-id", String(tab.id));
      ev.dataTransfer.effectAllowed = "move";
      el.classList.add("tab-dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("tab-dragging"));
    el.addEventListener("dragover", ev => {
      if (ev.dataTransfer.types.includes("tab-id")) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; el.classList.add("tab-dragover"); }
    });
    el.addEventListener("dragleave", () => el.classList.remove("tab-dragover"));
    el.addEventListener("drop", ev => {
      ev.preventDefault();
      el.classList.remove("tab-dragover");
      const fromId = parseInt(ev.dataTransfer.getData("tab-id"));
      const toId = tab.id;
      if (fromId === toId) return;
      const fromIdx = tabs.findIndex(t => t.id === fromId);
      const toIdx = tabs.findIndex(t => t.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = tabs.splice(fromIdx, 1);
      tabs.splice(toIdx, 0, moved);
      renderTabs();
    });
    tabBar.insertBefore(el, tabAddBtn);
  }
}

export function initTabs() {

  tabAddBtn.addEventListener("click", () => {
    const id = createTab("Untitled");
    switchTab(id);
    renderTabs();
    toast("New tab");
  });

  // Init first tab
  const firstTabId = createTab("Untitled");
  activeTabId = firstTabId;
  renderTabs();
}
