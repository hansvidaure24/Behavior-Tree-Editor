// @ts-check
import { NodeTypes } from './nodes.js';
import { History } from './history.js';
import { Serialization } from './serialization.js';
import { Replay } from './replay.js';
import { Storage } from './storage.js';
import { Exports } from './exports.js';
import { Canvas } from './canvas.js';
import { Properties } from './properties.js';
import { AIGen } from './ai-gen.js';
import { ctxMenu, dirty, onChanged, positionCtxMenu, pushHistory, renderCtxItems, setDirty, state, toast, updateWarnings, validate } from './app.js';
import { activeTabId, createTab, renderTabs, switchTab, tabs } from './tab-manager.js';
import { updatePaletteCounts } from './toolbar.js';
import { replayBar } from './panels.js';
import { showChoice } from './dialogs.js';

/** File I/O — import/export, save/load dialogs, File System Access, clipboard, drag-and-drop, auto-save, backups. */

export let fileHandle = null; // File System Access API handle for re-save

/** Pick a .json file and load it; asks whether to merge or replace when the canvas already has nodes. */
export function importFromFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(/** @type {string} */ (reader.result));
        if (!data.nodes || !data.root) { toast("Not a valid behavior tree file"); return; }
        const nodeCount = Object.keys(data.nodes).length;
        if (state.nodes.length > 0) {
          const choice = await showChoice(`Import ${nodeCount} nodes`, [
            { label: "Merge", detail: `add alongside ${state.nodes.length} existing nodes`, value: "merge" },
            { label: "Replace", detail: "overwrite current tree", value: "replace" },
          ]);
          if (!choice) return;
          if (choice === "merge") {
            const idMap = {};
            const newNodes = [];
            for (const [oldId, n] of Object.entries(data.nodes)) idMap[oldId] = Serialization.uid();
            for (const [oldId, n] of Object.entries(data.nodes)) {
              newNodes.push({
                id: idMap[oldId], type: n.type, category: n.category, name: n.name || n.type,
                children: (n.children || []).filter(c => idMap[c]).map(c => idMap[c]),
                parameters: n.parameters || {}, comment: n.comment, color: n.color, disabled: n.disabled, x: 0, y: 0,
              });
            }
            state.nodes.push(...newNodes);
            Canvas.notifyChanged();
            Canvas.triggerSpawn(newNodes.map(n => n.id));
            Canvas.setSelectedIds(newNodes.map(n => n.id));
            onChanged();
            Canvas.animatedAutoLayout();
            Canvas.centerView(true);
            toast(`Merged ${nodeCount} nodes from ${file.name}`);
            return;
          }
        }
        const s = Serialization.fromJSON(data, { nodes: {} });
        state.title = s.title;
        state.description = s.description;
        state.root = s.root;
        state.nodes = s.nodes;
        Canvas.notifyChanged();
        History.clear();
        pushHistory();
        Canvas.autoLayout();
        Canvas.centerView(true);
        Canvas.triggerStaggeredSpawn(state.nodes.map(n => n.id));
        Properties.show([]);
        setDirty(false);
        toast("Imported " + file.name);
      } catch (err) {
        toast("Invalid JSON: " + err.message);
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

const FS_TYPES = [{ description: "Behavior Tree", accept: { "application/json": [".bt.json"] } }];

async function saveToFileSystem() {
  try {
    const handle = await window.showSaveFilePicker({ types: FS_TYPES, suggestedName: (state.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "") || "my-tree") + ".bt.json" });
    const { tree, layout } = Serialization.toJSON(state);
    tree.title = state.title;
    tree.description = state.description;
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify({ tree, layout }, null, 2) + "\n");
    await writable.close();
    fileHandle = handle;
    setDirty(false);
    toast("Saved to disk");
  } catch (e) {
    if (e.name !== "AbortError") toast("Save failed: " + e.message);
  }
}

async function openFromFileSystem() {
  try {
    const [handle] = await window.showOpenFilePicker({ types: FS_TYPES, multiple: false });
    const file = await handle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);
    // Support both combined {tree,layout} format and plain tree format
    const treeData = data.tree || data;
    const layoutData = data.layout || {};
    if (!treeData.nodes || !treeData.root) { toast("Not a valid behavior tree file"); return; }
    if (dirty && !confirm("You have unsaved changes. Load anyway?")) return;
    const s = Serialization.fromJSON(treeData, layoutData);
    state.title = s.title;
    state.description = s.description;
    state.root = s.root;
    state.nodes = s.nodes;
    Canvas.notifyChanged();
    History.clear();
    pushHistory();
    const hasLayout = layoutData.nodes && Object.keys(layoutData.nodes).length > 0;
    if (!hasLayout) Canvas.autoLayout();
    Canvas.centerView(true);
    Canvas.triggerStaggeredSpawn(state.nodes.map(n => n.id));
    Properties.show([]);
    fileHandle = handle;
    setDirty(false);
    toast("Opened " + file.name);
  } catch (e) {
    if (e.name === "AbortError") return;
    // Fall back to legacy file input
    importFromFile();
  }
}

// --- Export (download JSON) ---
/** Download the tree as .bt.json plus a .bt.layout.json sidecar. */
export function exportJSON() {
  const warnings = validate();
  if (warnings.length > 0 && !confirm("Warnings:\n• " + warnings.join("\n• ") + "\n\nExport anyway?")) return;
  const { tree, layout } = Serialization.toJSON(state);
  tree.title = state.title;
  tree.description = state.description;
  tree.exportedAt = new Date().toISOString();
  tree.editor = "BehaviorTreeEditor";
  tree.nodeCount = Object.keys(tree.nodes).length;
  const nodeMap = {};
  for (const n of state.nodes) nodeMap[n.id] = n;
  function treeDepth(id, vis) {
    if (!id || (vis && vis.has(id))) return 0;
    if (vis) vis.add(id); else vis = new Set([id]);
    const n = nodeMap[id];
    if (!n || n.children.length === 0) return 1;
    let mx = 0;
    for (const c of n.children) mx = Math.max(mx, treeDepth(c, vis));
    return 1 + mx;
  }
  tree.depth = treeDepth(state.root, null);

  // Max breadth and connection count
  let connections = 0;
  const byDepth = {};
  const depthVis = new Set();
  function walkBreadth(id, d) {
    if (!id || depthVis.has(id)) return;
    depthVis.add(id);
    byDepth[d] = (byDepth[d] || 0) + 1;
    const n = nodeMap[id];
    if (n) { connections += n.children.length; for (const cid of n.children) walkBreadth(cid, d + 1); }
  }
  if (state.root) walkBreadth(state.root, 0);
  tree.maxBreadth = Math.max(0, ...Object.values(byDepth));
  tree.connectionCount = connections;

  // Collect blackboard keys referenced by conditions/guards
  const bbKeys = new Set();
  for (const n of state.nodes) { if (n.parameters.key) bbKeys.add(n.parameters.key); }
  if (bbKeys.size > 0) tree.blackboardKeys = [...bbKeys].sort();

  // Collect action/condition names for engine binding
  const actionNames = new Set(), conditionNames = new Set();
  for (const n of state.nodes) {
    if (n.type === "action") actionNames.add(n.name);
    if (n.type === "condition") conditionNames.add(n.name);
  }
  if (actionNames.size > 0) tree.actionNames = [...actionNames].sort();
  if (conditionNames.size > 0) tree.conditionNames = [...conditionNames].sort();

  // Decorator names used
  const decoratorTypes = new Set();
  for (const n of state.nodes) { if (NodeTypes.categoryOf(n.type) === "decorator") decoratorTypes.add(n.type); }
  if (decoratorTypes.size > 0) tree.decoratorTypes = [...decoratorTypes].sort();

  const name = state.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "") || "tree";

  // Download tree
  const treeBlob = new Blob([JSON.stringify(tree, null, 2) + "\n"], { type: "application/json" });
  download(treeBlob, name + ".bt.json");

  // Download layout
  const layoutBlob = new Blob([JSON.stringify(layout, null, 2) + "\n"], { type: "application/json" });
  download(layoutBlob, name + ".bt.layout.json");

  const acts = actionNames.size, conds = conditionNames.size;
  toast(`Exported ${name} — ${tree.nodeCount} nodes, depth ${tree.depth}` + (acts ? `, ${acts} actions` : "") + (conds ? `, ${conds} conditions` : ""));
}

function download(blob, filename) { Exports.download(blob, filename); }

// --- Load dialog ---
/**
 * @param {string} dir "examples", "folder" (open project folder) or anything else for IndexedDB saves
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function loadTreeByRef(dir, name) {
  if (dirty && !confirm("You have unsaved changes. Load anyway?")) return;
  const data = await Storage.loadTree(dir, name);
  if (!data) { toast("Tree not found"); return; }
  const s = Serialization.fromJSON(data.tree, data.layout);
  state.title = s.title;
  state.description = s.description;
  state.root = s.root;
  state.nodes = s.nodes;
  Canvas.notifyChanged();
  History.clear();
  pushHistory();
  const hasLayout = data.layout && Object.keys(data.layout.nodes || {}).length > 0;
  if (!hasLayout) Canvas.autoLayout();
  Canvas.centerView(true);
  Canvas.triggerStaggeredSpawn(state.nodes.map(n => n.id));
  Properties.show([]);
  setDirty(false);
  addRecent(dir, name);
  document.getElementById("load-dialog").classList.add("hidden");
  toast("Loaded " + name);
}

const loadFilter = /** @type {HTMLInputElement} */ (document.getElementById("load-filter"));

// --- Open Folder ---
const folderBtn = document.getElementById("btn-folder");

// --- Extract subtree to clipboard ---
/** @param {string} id */
export function extractSubtreeToClipboard(id) {
  const { tree } = Canvas.extractSubtree(id);
  const node = state.nodes.find(n => n.id === id);
  tree.title = node ? node.name + " (subtree)" : "Subtree";
  navigator.clipboard.writeText(JSON.stringify(tree, null, 2)).then(() => {
    toast("Subtree copied to clipboard (" + Object.keys(tree.nodes).length + " nodes)");
  });
}

// --- Copy selected nodes to clipboard ---
export function copySelectedToClipboard() {
  const sel = new Set(Canvas.getSelectedIds());
  if (sel.size === 0) { toast("Nothing selected"); return; }
  const nodes = {};
  let root = "";
  for (const n of state.nodes) {
    if (!sel.has(n.id)) continue;
    nodes[n.id] = {
      id: n.id, type: n.type, category: n.category, name: n.name,
      children: n.children.filter(c => sel.has(c)),
      parameters: { ...n.parameters },
    };
    if (n.comment) nodes[n.id].comment = n.comment;
    if (n.color) nodes[n.id].color = n.color;
    if (n.disabled) nodes[n.id].disabled = true;
    if (!root && n.id === state.root) root = n.id;
  }
  if (!root) root = Object.keys(nodes)[0];
  const tree = { version: "1.0", title: state.title + " (selection)", root, nodes };
  navigator.clipboard.writeText(JSON.stringify(tree, null, 2)).then(() =>
    toast(`Copied ${sel.size} node${sel.size > 1 ? "s" : ""} to clipboard`)
  );
}

// --- Copy tree JSON to clipboard ---
export function copyToClipboard() {
  const { tree } = Serialization.toJSON(state);
  tree.title = state.title;
  tree.description = state.description;
  navigator.clipboard.writeText(JSON.stringify(tree, null, 2)).then(() => toast("JSON copied to clipboard"));
}

export function copyAsImage() {
  Canvas.exportPNGBlob().then(blob => {
    if (!blob) { toast("Nothing to copy"); return; }
    navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
      () => toast("Image copied to clipboard"),
      () => toast("Clipboard write failed — try Export PNG instead")
    );
  });
}

// --- Paste tree from clipboard (Ctrl+V) ---
/** Paste JSON nodes, a whole tree, or an indented text outline. */
export function pasteFromClipboard() {
  navigator.clipboard.readText().then(text => {
    try {
      const data = JSON.parse(text);
      if (!data.nodes || !data.root) { toast("Clipboard doesn't contain a valid tree"); return; }
      const nodeCount = Object.keys(data.nodes).length;
      if (state.nodes.length === 0) {
        // Empty canvas — replace
        const s = Serialization.fromJSON(data, { nodes: {} });
        state.title = s.title;
        state.description = s.description;
        state.root = s.root;
        state.nodes = s.nodes;
        Canvas.notifyChanged();
        History.clear();
        pushHistory();
        Canvas.autoLayout();
        Canvas.centerView(true);
        Properties.show([]);
        setDirty(true);
        toast("Pasted " + (data.title || "tree") + " (" + nodeCount + " nodes)");
      } else {
        // Non-empty canvas — merge as subtree with new IDs
        const idMap = {};
        const newNodes = [];
        for (const [oldId, n] of Object.entries(data.nodes)) {
          const newId = Serialization.uid();
          idMap[oldId] = newId;
        }
        for (const [oldId, n] of Object.entries(data.nodes)) {
          newNodes.push({
            id: idMap[oldId],
            type: n.type,
            category: n.category,
            name: n.name || n.type,
            children: (n.children || []).filter(c => idMap[c]).map(c => idMap[c]),
            parameters: n.parameters || {},
            comment: n.comment || undefined,
            color: n.color || undefined,
            x: n.x || 0,
            y: n.y || 0,
          });
        }
        // Offset pasted nodes to avoid overlap
        const maxX = Math.max(0, ...state.nodes.map(n => n.x + NodeTypes.NODE_W));
        const minPastedX = Math.min(...newNodes.map(n => n.x));
        const offsetX = maxX - minPastedX + 80;
        for (const n of newNodes) n.x += offsetX;
        state.nodes.push(...newNodes);
        // Auto-connect to selected parent if possible
        const sel = Canvas.getSelectedIds();
        const pastedRoot = idMap[data.root];
        if (sel.length === 1 && pastedRoot) {
          const parent = state.nodes.find(n => n.id === sel[0]);
          if (parent && NodeTypes.maxChildren(parent.type) > 0 && parent.children.length < NodeTypes.maxChildren(parent.type)) {
            parent.children.push(pastedRoot);
          }
        }
        Canvas.notifyChanged();
        Canvas.triggerSpawn(newNodes.map(n => n.id));
        Canvas.setSelectedIds(newNodes.map(n => n.id));
        onChanged();
        Canvas.animatedAutoLayout();
        Canvas.centerView(true);
        const connMsg = sel.length === 1 ? " (connected to selected)" : "";
        toast("Merged " + nodeCount + " nodes from clipboard" + connMsg);
      }
    } catch {
      pasteAsTextOutline(text);
    }
  }).catch(() => toast("Clipboard access denied"));
}

function pasteAsTextOutline(text) {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length === 0 || lines.length > 200) { toast("Nothing to paste"); return; }
  const nodes = [];
  const stack = []; // {node, indent}
  const typeHints = { "?" : "selector", "→": "sequence", "∥": "parallel", "!": "invert", "↻": "repeat", "⏱": "cooldown" };
  for (const line of lines) {
    const stripped = line.replace(/^[\s\-\*•]+/, "");
    if (!stripped) continue;
    const indent = line.length - line.replace(/^[\s\-\*•]+/, "").length;
    let type = "action", name = stripped;
    for (const [icon, t] of Object.entries(typeHints)) {
      if (stripped.startsWith(icon + " ")) { type = t; name = stripped.slice(icon.length + 1).trim(); break; }
    }
    if (/^(sequence|selector|parallel)\b/i.test(name)) { type = name.split(/\s/)[0].toLowerCase(); name = name.replace(/^(sequence|selector|parallel)\s*/i, "") || type; }
    if (/^(check|if |has |is |can )/i.test(name)) type = "condition";
    const cat = NodeTypes.categoryOf(type);
    const node = { id: Serialization.uid(), type, category: cat, name, children: [], parameters: {}, x: 0, y: 0 };
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length > 0) {
      const parent = stack[stack.length - 1].node;
      if (NodeTypes.maxChildren(parent.type) === 0) parent.type = "sequence";
      if (parent.children.length < NodeTypes.maxChildren(parent.type)) parent.children.push(node.id);
    }
    stack.push({ node, indent });
    nodes.push(node);
  }
  if (nodes.length === 0) { toast("Could not parse text as tree"); return; }
  if (nodes.length > 1 && nodes.filter(n => !nodes.some(p => p.children.includes(n.id))).length > 1) {
    const root = { id: Serialization.uid(), type: "selector", category: "composite", name: "Root", children: [], parameters: {}, x: 0, y: 0 };
    for (const n of nodes) { if (!nodes.some(p => p.children.includes(n.id))) root.children.push(n.id); }
    nodes.unshift(root);
  }
  const maxX = state.nodes.length > 0 ? Math.max(0, ...state.nodes.map(n => n.x + NodeTypes.NODE_W)) + 80 : 0;
  for (const n of nodes) n.x += maxX;
  state.nodes.push(...nodes);
  if (state.nodes.length === nodes.length) state.root = nodes[0].id;
  Canvas.notifyChanged();
  Canvas.triggerSpawn(nodes.map(n => n.id));
  Canvas.setSelectedIds(nodes.map(n => n.id));
  onChanged();
  Canvas.animatedAutoLayout();
  Canvas.centerView(true);
  toast(`Pasted ${nodes.length} nodes from text outline`);
}

/** @param {"unity" | "unreal" | "godot"} engine */
export function exportEngineAdapter(engine) { Exports.engineAdapter(state, engine, toast); }
export function copyAsMermaid() { Exports.mermaid(state, toast); }
export function copyAsAscii() { Exports.ascii(state, toast); }
export function exportMarkdown() { Exports.markdown(state, toast); }

// --- File drag-and-drop import ---
const dropOverlay = document.getElementById("drop-overlay");
let dragCounter = 0;

// --- Recent files ---
const RECENT_KEY = "bt-editor-recent";

function addRecent(dir, name) {
  try {
    let recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    recent = recent.filter(r => !(r.dir === dir && r.name === name));
    recent.unshift({ dir, name, ts: Date.now() });
    if (recent.length > 5) recent.length = 5;
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {}
}

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}

// --- localStorage auto-save ---
const STORAGE_KEY = "bt-editor-autosave";

const autoSaveIndicator = /** @type {HTMLElement & {_t?: any}} */ (document.getElementById("autosave-indicator"));

let lastAutoSaveTs = 0;

function autoSave() {
  const { tree, layout } = Serialization.toJSON(state);
  tree.title = state.title;
  tree.description = state.description;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tree, layout, ts: Date.now() }));
    // Save all tabs
    const curTab = tabs.find(t => t.id === activeTabId);
    if (curTab) { curTab.tree = tree; curTab.layout = layout; curTab.title = state.title; curTab.dirty = dirty; }
    const tabData = tabs.map(t => ({ title: t.title, tree: t.tree, layout: t.layout, dirty: t.dirty, active: t.id === activeTabId }));
    localStorage.setItem("bt-editor-tabs", JSON.stringify(tabData));
    if (dirty && state.nodes.length > 0) {
      lastAutoSaveTs = Date.now();
      autoSaveIndicator.textContent = "saved just now";
      autoSaveIndicator.classList.add("persistent");
      autoSaveIndicator.classList.add("flash");
      clearTimeout(autoSaveIndicator._t);
      autoSaveIndicator._t = setTimeout(() => autoSaveIndicator.classList.remove("flash"), 1500);
    }
  } catch { /* quota exceeded — ignore */ }
}

function autoRestore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved.tree || !saved.tree.nodes || Object.keys(saved.tree.nodes).length === 0) return false;
    const s = Serialization.fromJSON(saved.tree, saved.layout);
    state.title = s.title;
    state.description = s.description;
    state.root = s.root;
    state.nodes = s.nodes;
    Canvas.notifyChanged();
    History.clear();
    pushHistory();
    Canvas.centerView(true);
    Properties.show([]);
    return true;
  } catch { return false; }
}

// --- Periodic backup snapshots (keep last 3) ---
const BACKUP_KEY = "bt-editor-backups";
let lastBackupHash = "";

function backupSnapshot() {
  if (state.nodes.length === 0) return;
  const { tree, layout } = Serialization.toJSON(state);
  tree.title = state.title;
  const hash = JSON.stringify(tree.nodes);
  if (hash === lastBackupHash) return;
  lastBackupHash = hash;
  try {
    const backups = JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
    backups.unshift({ tree, layout, ts: Date.now(), title: state.title, nodeCount: state.nodes.length });
    if (backups.length > 3) backups.length = 3;
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backups));
  } catch { /* quota */ }
}

/** @returns {Promise<void>} */
export async function restoreFromBackup() {
  try {
    const backups = JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
    if (backups.length === 0) { toast("No backups available"); return; }
    const options = backups.map((b, i) => {
      const ago = Math.floor((Date.now() - b.ts) / 60000);
      const when = ago < 1 ? "just now" : ago < 60 ? `${ago}m ago` : `${Math.floor(ago / 60)}h ago`;
      return { label: b.title || "Untitled", detail: `${b.nodeCount} nodes, ${when}`, value: i };
    });
    const idx = await showChoice("Restore Backup", options);
    if (idx === null) return;
    const b = backups[idx];
    const s = Serialization.fromJSON(b.tree, b.layout);
    state.title = s.title; state.description = s.description;
    state.root = s.root; state.nodes = s.nodes;
    Canvas.notifyChanged(); History.clear(); pushHistory();
    Canvas.centerView(true); Properties.show([]);
    setDirty(true); updateWarnings(); updatePaletteCounts();
    toast("Restored backup: " + (b.title || "Untitled"));
  } catch { toast("Failed to restore backup"); }
}

export function initFileIO() {

  document.getElementById("btn-export").addEventListener("click", e => {
    const btn = /** @type {HTMLElement} */ (e.currentTarget);
    const rect = btn.getBoundingClientRect();
    const items = [
      ...("showSaveFilePicker" in window ? [{ label: "💾 Save to Disk", action: saveToFileSystem }, { sep: true }] : []),
      { label: "📄 Export JSON + Layout", action: exportJSON },
      { sep: true },
      { label: "🖼 Export PNG", action: () => document.getElementById("btn-png").click() },
      { label: "📐 Export SVG", action: () => document.getElementById("btn-svg").click() },
      { sep: true },
      { label: "🎮 Unity C# Adapter", action: () => exportEngineAdapter("unity") },
      { label: "🎮 Unreal C++ Adapter", action: () => exportEngineAdapter("unreal") },
      { label: "🎮 Godot GDScript Adapter", action: () => exportEngineAdapter("godot") },
      { sep: true },
      { label: "📝 Export Markdown Docs", action: () => exportMarkdown() },
      { sep: true },
      { label: "📋 Copy JSON to Clipboard", action: () => copyToClipboard() },
      { label: "📋 Copy as Image", action: () => copyAsImage() },
      { label: "📋 Copy as Mermaid", action: () => copyAsMermaid() },
      { label: "📋 Copy as ASCII Tree", action: () => copyAsAscii() },
    ];
    ctxMenu.textContent = "";
    renderCtxItems(items);
    positionCtxMenu(rect.left, rect.bottom + 4);
  });

  // --- Save dialog ---
  document.getElementById("btn-save").addEventListener("click", () => {
    /** @type {HTMLInputElement} */ (document.getElementById("save-filename")).value = state.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "") || "my-tree";
    document.getElementById("save-dialog").classList.remove("hidden");
    setTimeout(() => /** @type {HTMLInputElement} */ (document.getElementById("save-filename")).select(), 0);
  });

  document.getElementById("save-confirm").addEventListener("click", async () => {
    const filename = /** @type {HTMLInputElement} */ (document.getElementById("save-filename")).value.trim();
    if (!filename) return;
    const warnings = validate();
    if (warnings.length > 0 && !confirm("Warnings:\n• " + warnings.join("\n• ") + "\n\nSave anyway?")) return;
    const { tree, layout } = Serialization.toJSON(state);
    tree.title = state.title;
    tree.description = state.description;

    try {
      await Storage.saveTree(filename, tree, layout);
      document.getElementById("save-dialog").classList.add("hidden");
      setDirty(false);
      addRecent("local", filename);
      toast("Saved as " + filename);
    } catch (e) {
      toast("Save failed: " + e.message);
    }
  });

  document.getElementById("save-cancel").addEventListener("click", () => {
    document.getElementById("save-dialog").classList.add("hidden");
  });

  /** @type {HTMLInputElement} */ (document.getElementById("save-filename")).addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("save-confirm").click();
    if (e.key === "Escape") document.getElementById("save-cancel").click();
  });

  document.getElementById("btn-load").addEventListener("click", async () => {
    const list = document.getElementById("load-list");
    list.innerHTML = "Loading...";
    loadFilter.value = "";
    document.getElementById("load-dialog").classList.remove("hidden");
    setTimeout(() => loadFilter.focus(), 0);

    if ("showOpenFilePicker" in window) {
      const diskBtn = document.getElementById("load-from-disk-btn") || (() => {
        const btn = document.createElement("button");
        btn.id = "load-from-disk-btn";
        btn.textContent = "Open from Disk...";
        btn.style.cssText = "margin:0 0 10px 0;padding:6px 12px;background:#1a3a5c;color:#e0e0e0;border:1px solid #2a5a8c;border-radius:4px;cursor:pointer;width:100%;font-size:13px;";
        btn.addEventListener("click", () => { document.getElementById("load-dialog").classList.add("hidden"); openFromFileSystem(); });
        list.parentElement.insertBefore(btn, list);
        return btn;
      })();
      diskBtn; // ensure it's referenced
    }

    try {
      const trees = await Storage.listTrees();
      if (trees.length === 0) { list.innerHTML = "<p class='hint'>No saved trees. Drag nodes onto the canvas to start.</p>"; return; }
      list.textContent = "";

      // Recent files section
      const recent = getRecent();
      const recentMatches = recent.filter(r => trees.some(t => t.dir === r.dir && t.name === r.name));
      if (recentMatches.length > 0) {
        const header = document.createElement("div");
        header.style.cssText = "font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#555;margin:4px 0 6px 4px;";
        header.textContent = "Recent";
        list.appendChild(header);
        for (const r of recentMatches) {
          const item = document.createElement("div");
          item.className = "load-item";
          const strong = document.createElement("strong");
          strong.textContent = r.name;
          item.appendChild(strong);
          item.addEventListener("click", () => loadTreeByRef(r.dir, r.name).catch(err => toast("Load failed: " + err.message)));
          list.appendChild(item);
        }
        const sep = document.createElement("div");
        sep.style.cssText = "height:1px;background:#0f3460;margin:8px 0;";
        list.appendChild(sep);
        const allHeader = document.createElement("div");
        allHeader.style.cssText = "font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#555;margin:4px 0 6px 4px;";
        allHeader.textContent = "All Trees";
        list.appendChild(allHeader);
      }

      for (const t of trees) {
        const item = document.createElement("div");
        item.className = "load-item";
        item.style.cssText = "display:flex;align-items:center;gap:8px;";
        item.dataset.dir = t.dir;
        item.dataset.name = t.name;
        const strong = document.createElement("strong");
        strong.style.flex = "1";
        strong.textContent = t.name;
        const span = document.createElement("span");
        span.style.cssText = "color:#666;font-size:11px;flex-shrink:0;";
        span.textContent = (t.nodeCount != null ? t.nodeCount + " nodes · " : "") + t.dir;
        item.append(strong, span);
        if (t.dir === "local" || t.dir === "folder") {
          const del = document.createElement("button");
          del.textContent = "×";
          del.title = "Delete";
          del.style.cssText = "background:#5c1a1a;color:#ef4444;border:none;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:12px;flex-shrink:0;";
          del.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            if (!confirm(`Delete "${t.name}"?`)) return;
            try {
              await Storage.deleteTree(t.name);
              item.remove();
              toast(`Deleted ${t.name}`);
            } catch (err) { toast("Delete failed: " + err.message); }
          });
          item.appendChild(del);
        }
        list.appendChild(item);
      }

      list.querySelectorAll(".load-item[data-dir]").forEach(/** @param {HTMLElement} item */ item => {
        item.addEventListener("click", (e) => {
          if (/** @type {HTMLElement} */ (e.target).tagName === "BUTTON") return;
          loadTreeByRef(item.dataset.dir, item.dataset.name).catch(err => toast("Load failed: " + err.message));
        });
      });
    } catch (e) {
      list.innerHTML = "<p>Error loading tree list</p>";
    }
  });

  document.getElementById("load-cancel").addEventListener("click", () => {
    document.getElementById("load-dialog").classList.add("hidden");
  });
  loadFilter.addEventListener("input", () => {
    const q = loadFilter.value.toLowerCase().trim();
    document.querySelectorAll("#load-list .load-item[data-name]").forEach(/** @param {HTMLElement} item */ item => {
      item.style.display = !q || item.dataset.name.toLowerCase().includes(q) ? "" : "none";
    });
  });
  loadFilter.addEventListener("keydown", e => {
    if (e.key === "Escape") { loadFilter.value = ""; loadFilter.dispatchEvent(new Event("input")); }
    if (e.key === "Enter") {
      const visible = /** @type {HTMLElement} */ (document.querySelector("#load-list .load-item[data-name]:not([style*='display: none'])"));
      if (visible) visible.click();
    }
  });
  if ("showDirectoryPicker" in window) {
    folderBtn.addEventListener("click", async () => {
      const handle = await Storage.openDirectory();
      if (handle) toast("Folder: " + Storage.getDirectoryName());
    });
  } else {
    folderBtn.style.display = "none";
  }
  // Warn before leaving with unsaved changes
  window.addEventListener("beforeunload", e => {
    if (dirty || tabs.some(t => t.dirty)) { e.preventDefault(); e.returnValue = ""; }
  });

  document.body.addEventListener("dragenter", e => {
    if (e.dataTransfer.types.includes("Files")) {
      dragCounter++;
      dropOverlay.classList.add("active");
    }
  });
  document.body.addEventListener("dragleave", () => {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove("active"); }
  });
  document.body.addEventListener("dragover", e => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });

  document.body.addEventListener("drop", e => {
    dragCounter = 0;
    dropOverlay.classList.remove("active");
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    e.preventDefault();

    for (const file of files) {
      if (!file.name.endsWith(".json")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(/** @type {string} */ (reader.result));

          if (file.name.endsWith(".replay.json") || (data.ticks && Array.isArray(data.ticks))) {
            Replay.load(data);
            replayBar.classList.remove("hidden");
            document.getElementById("btn-replay").classList.add("replay-active");
            toast(`Replay loaded: ${data.agentId || file.name} (${data.ticks.length} ticks)`);
            return;
          }

          if (data.nodes && data.root !== undefined) {
            const layoutFile = files.find(f => f.name === file.name.replace(".bt.json", ".bt.layout.json"));
            const loadTree = (layoutData) => {
              const s = Serialization.fromJSON(data, layoutData || { nodes: {} });
              state.title = s.title;
              state.description = s.description;
              state.root = s.root;
              state.nodes = s.nodes;
              Canvas.notifyChanged();
              History.clear();
              pushHistory();
              if (!layoutData) Canvas.autoLayout();
              Canvas.centerView(true);
              Canvas.triggerStaggeredSpawn(state.nodes.map(n => n.id));
              Properties.show([]);
              setDirty(false);
              toast("Loaded " + file.name);
            };

            if (layoutFile) {
              const lr = new FileReader();
              lr.onload = () => {
                try { loadTree(JSON.parse(/** @type {string} */ (lr.result))); } catch { loadTree(null); }
              };
              lr.readAsText(layoutFile);
            } else {
              loadTree(null);
            }
          }
        } catch (err) {
          toast("Invalid JSON: " + err.message);
        }
      };
      reader.readAsText(file);
    }
  });
}

/** Restore tabs/auto-save from the last session and start the auto-save and backup timers. */
export function initPersistence() {

  setInterval(() => {
    if (!lastAutoSaveTs) return;
    const ago = Math.floor((Date.now() - lastAutoSaveTs) / 1000);
    if (ago < 10) autoSaveIndicator.textContent = "saved just now";
    else if (ago < 60) autoSaveIndicator.textContent = `saved ${ago}s ago`;
    else autoSaveIndicator.textContent = `saved ${Math.floor(ago / 60)}m ago`;
  }, 10000);

  // Restore tabs from previous session
  try {
    const savedTabs = JSON.parse(localStorage.getItem("bt-editor-tabs") || "null");
    if (savedTabs && savedTabs.length > 0) {
      tabs.length = 0;
      let activeIdx = 0;
      for (let i = 0; i < savedTabs.length; i++) {
        const st = savedTabs[i];
        const id = createTab(st.title || "Untitled");
        const tab = tabs.find(t => t.id === id);
        if (tab) { tab.tree = st.tree; tab.layout = st.layout; tab.dirty = st.dirty; }
        if (st.active) activeIdx = i;
      }
      switchTab(tabs[activeIdx].id);
      renderTabs();
      toast("Restored " + tabs.length + " tab" + (tabs.length > 1 ? "s" : ""));
    } else if (autoRestore()) {
      toast("Restored from auto-save");
    }
  } catch {
    if (autoRestore()) {
      toast("Restored from auto-save");
    }
  }

  document.getElementById("empty-examples").classList.toggle("hidden", state.nodes.length > 0);

  Storage.init().then(() => AIGen.loadTemplates()).catch(() => {});

  // Offline/online notifications
  window.addEventListener("offline", () => toast("Offline — changes saved locally"));
  window.addEventListener("online", () => toast("Back online"));

  setInterval(autoSave, 5000);

  setInterval(backupSnapshot, 60000);
}
