import { NodeTypes } from './nodes.js';
import { History } from './history.js';
import { Serialization } from './serialization.js';
import { Replay } from './replay.js';
import { Storage } from './storage.js';
import { Canvas } from './canvas.js';
import { Properties } from './properties.js';
import { AIGen } from './ai-gen.js';
import { groupIntoSequence, onChanged, pushHistory, setDirty, showTypePicker, showWrapPicker, state, toast, unwrapDecorator, updateWarnings, validate } from './app.js';
import { activeTabId, closeTab, tabAddBtn } from './tab-manager.js';
import { saveAsTemplate, togglePalette, toggleProperties, toggleTheme } from './toolbar.js';
import { autoFixWarnings, showWarningsPanel, simulateReplay, toggleHistory, toggleJsonPreview, toggleOutline } from './panels.js';
import { copyAsAscii, copyAsImage, copyAsMermaid, copySelectedToClipboard, copyToClipboard, exportEngineAdapter, exportJSON, exportMarkdown, extractSubtreeToClipboard, importFromFile, pasteFromClipboard, restoreFromBackup } from './file-io.js';

/** Modal dialogs — choice prompt, stats, AI generate, version history, search, find & replace, command palette, help, onboarding. */

export function showChoice(title, options) {
  return new Promise(resolve => {
    const dlg = document.getElementById("choice-dialog");
    const titleEl = document.getElementById("choice-title");
    const optionsEl = document.getElementById("choice-options");
    titleEl.textContent = title;
    optionsEl.innerHTML = "";
    function close(val) { dlg.classList.add("hidden"); resolve(val); }
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.textContent = opt.label;
      btn.style.cssText = "padding:8px 14px;background:#0f3460;color:#e0e0e0;border:1px solid #1a4a8a;border-radius:4px;cursor:pointer;font-size:13px;text-align:left;font-family:inherit;";
      if (opt.detail) {
        const sub = document.createElement("span");
        sub.textContent = " — " + opt.detail;
        sub.style.cssText = "color:#666;font-size:11px;";
        btn.appendChild(sub);
      }
      btn.addEventListener("click", () => close(opt.value));
      optionsEl.appendChild(btn);
    }
    document.getElementById("choice-cancel").onclick = () => close(null);
    dlg.classList.remove("hidden");
  });
}

// --- Statistics dialog ---
export function showStats() {
  if (state.nodes.length === 0) { toast("No nodes yet"); return; }
  const cats = { composite: 0, decorator: 0, leaf: 0 };
  const types = {};
  let conn = 0, maxDepth = 0, paramCount = 0, commentCount = 0, colorCount = 0;
  for (const n of state.nodes) {
    cats[n.category] = (cats[n.category] || 0) + 1;
    types[n.type] = (types[n.type] || 0) + 1;
    conn += n.children.length;
    paramCount += Object.keys(n.parameters).length;
    if (n.comment) commentCount++;
    if (n.color) colorCount++;
  }
  const vis = new Set();
  function wd(id, d) { if (vis.has(id)) return; vis.add(id); if (d > maxDepth) maxDepth = d; const nd = state.nodes.find(x => x.id === id); if (nd) for (const c of nd.children) wd(c, d + 1); }
  if (state.root) wd(state.root, 0);
  const orphans = state.nodes.filter(n => n.id !== state.root && !state.nodes.some(p => p.children.includes(n.id)));
  const warnings = validate();
  const complexity = state.nodes.length <= 10 ? "Simple" : state.nodes.length <= 30 ? "Moderate" : state.nodes.length <= 60 ? "Complex" : "Large";
  const complexColor = state.nodes.length <= 10 ? "#22c55e" : state.nodes.length <= 30 ? "#53a8b6" : state.nodes.length <= 60 ? "#f59e0b" : "#ef4444";

  const content = document.getElementById("stats-content");
  content.innerHTML = `
      <div style="display:flex;gap:20px;margin-bottom:8px;">
        <div style="text-align:center;"><span style="font-size:28px;font-weight:700;color:#e0e0e0;">${state.nodes.length}</span><br><span style="color:#666;">nodes</span></div>
        <div style="text-align:center;"><span style="font-size:28px;font-weight:700;color:#53a8b6;">${conn}</span><br><span style="color:#666;">connections</span></div>
        <div style="text-align:center;"><span style="font-size:28px;font-weight:700;color:#e09f3e;">${maxDepth}</span><br><span style="color:#666;">depth</span></div>
        <div style="text-align:center;"><span style="font-size:28px;font-weight:700;color:${complexColor};">${complexity}</span><br><span style="color:#666;">complexity</span></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;">
        <span><span style="color:#95d5b2;">●</span> Composites: ${cats.composite}</span>
        <span><span style="color:#e09f3e;">●</span> Decorators: ${cats.decorator}</span>
        <span><span style="color:#c77dff;">●</span> Leaves: ${cats.leaf}</span>
        <span>Parameters: ${paramCount}</span>
        <span>Comments: ${commentCount}</span>
        <span>Colored: ${colorCount}</span>
        ${orphans.length ? `<span style="color:#ef4444;">Orphans: ${orphans.length}</span>` : ""}
        ${warnings.length ? `<span style="color:#f59e0b;">Warnings: ${warnings.length}</span>` : ""}
      </div>`;

  const chart = document.getElementById("stats-chart");
  chart.innerHTML = "";
  const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
  const max = sorted[0] ? sorted[0][1] : 1;
  for (const [type, count] of sorted) {
    const c = NodeTypes.colors(NodeTypes.categoryOf(type));
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:3px;";
    const label = document.createElement("span");
    label.style.cssText = "width:80px;text-align:right;font-size:11px;color:#888;";
    label.textContent = `${NodeTypes.ICONS[type] || ""} ${type}`;
    const bar = document.createElement("div");
    bar.style.cssText = `height:14px;border-radius:3px;background:${c.stroke};transition:width 0.3s;`;
    bar.style.width = Math.max(4, (count / max) * 200) + "px";
    const val = document.createElement("span");
    val.style.cssText = "font-size:11px;color:#666;min-width:20px;";
    val.textContent = count;
    row.append(label, bar, val);
    chart.appendChild(row);
  }

  document.getElementById("stats-dialog").classList.remove("hidden");
}

// --- AI Generate ---
const aiDialog = document.getElementById("ai-dialog");
const aiInput = document.getElementById("ai-input");
const aiHints = document.getElementById("ai-hints");

export function openAI() {
  probeOllama();
  aiDialog.classList.remove("hidden");
  aiInput.value = "";
  setTimeout(() => aiInput.focus(), 0);
  aiHints.textContent = "";
  for (const hint of AIGen.getHints()) {
    const chip = document.createElement("span");
    chip.textContent = hint;
    chip.style.cssText = "font-size:11px;padding:3px 8px;background:#0f3460;color:#8888aa;border-radius:10px;cursor:pointer;transition:background 0.1s;";
    chip.addEventListener("mouseenter", () => { chip.style.background = "#1a4a8a"; chip.style.color = "#e0e0e0"; });
    chip.addEventListener("mouseleave", () => { chip.style.background = "#0f3460"; chip.style.color = "#8888aa"; });
    chip.addEventListener("click", () => { aiInput.value = hint; aiInput.focus(); });
    aiHints.appendChild(chip);
  }
}

function applyGenerated(result, desc) {
  if (state.nodes.length > 0 && !confirm("This will replace the current tree. Continue?")) return;
  // Normalize: accept nodes as object or array
  let nodeList = result.nodes;
  if (nodeList && !Array.isArray(nodeList)) {
    nodeList = Object.values(nodeList);
  }
  state.nodes = nodeList;
  state.root = result.root;
  state.title = desc.length > 30 ? desc.slice(0, 30) + "..." : desc;
  Canvas.notifyChanged();
  History.clear();
  pushHistory();
  Canvas.autoLayout();
  Canvas.centerView(true);
  Properties.show([]);
  setDirty(true);
  updateWarnings();
  aiDialog.classList.add("hidden");
  toast("Generated " + nodeList.length + " nodes");
}

let _ollamaAvailable = null;
function probeOllama() {
  if (_ollamaAvailable !== null) return;
  fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) })
    .then(r => r.json()).then(d => {
      _ollamaAvailable = true;
      const models = (d.models || []).map(m => m.name);
      const btn = document.getElementById("btn-ai");
      if (btn) btn.title = "AI Generate (Ollama: " + (models[0] || "ready") + ")";
      const sub = document.getElementById("ai-subtitle");
      if (sub) sub.textContent = "AI powered by Ollama — describe any behavior and it will build the tree.";
    }).catch(() => { _ollamaAvailable = false; });
}

async function doGenerate() {
  const desc = aiInput.value.trim();
  if (!desc) return;
  const btn = document.getElementById("ai-generate");
  btn.disabled = true;

  // Try Ollama directly (no server proxy needed)
  if (_ollamaAvailable) {
    btn.textContent = "Thinking...";
    try {
      const resp = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3",
          prompt: desc,
          system: 'You are a behavior tree generator for game AI. Given a plain English description, return ONLY valid JSON — no markdown, no explanation.\n\nNode types: sequence/selector/parallel (composite), action/condition (leaf), invert/repeat/cooldown/timeout/guard (decorator).\n\nReturn: {"root":"<root_id>","nodes":{"<id>":{"id":"<id>","type":"<type>","category":"<category>","name":"<label>","children":["<child_ids>"],"parameters":{}}}}\n\nRules: IDs are unique 8-char hex. Composites: 2+ children. Decorators: 1 child. Leaves: 0 children. 5-20 nodes typical. Return ONLY JSON.',
          format: "json",
          stream: false,
          options: { temperature: 0.3 },
        }),
      });
      if (resp.ok) {
        const result = await resp.json();
        const tree = JSON.parse(result.response || "{}");
        if (tree.root && tree.nodes) {
          if (Array.isArray(tree.nodes)) tree.nodes = Object.fromEntries(tree.nodes.map(n => [n.id, n]));
          applyGenerated(tree, desc);
          toast("Generated by AI (Ollama)");
          btn.disabled = false;
          btn.textContent = "Generate";
          return;
        }
      }
    } catch (e) { /* Ollama failed, fall through */ }
  }

  // Fall back to Fuse.js template search + built-in patterns
  btn.textContent = "Searching...";
  const result = AIGen.generate(desc);
  btn.disabled = false;
  btn.textContent = "Generate";
  if (!result) {
    toast("No matching templates — try: patrol, chase, attack, guard, boss, or install Ollama for AI generation");
    return;
  }
  applyGenerated(result, desc);
  if (result._matches) toast("Built from: " + result._matches.join(", "));
  else if (result._source === "patterns") toast("Generated from built-in patterns");
}

// --- Version History ---
async function showVersionHistory() {
  const name = state.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
  if (!name) { toast("Save the tree first to see version history"); return; }
  const dialog = document.getElementById("version-dialog");
  const list = document.getElementById("version-list");
  list.innerHTML = "Loading...";
  dialog.classList.remove("hidden");
  try {
    const versions = await Storage.listVersions(name);
    list.textContent = "";
    if (versions.length === 0) {
      list.innerHTML = '<p class="hint">No previous versions. Versions are created on each save.</p>';
      return;
    }
    const currentNodes = {};
    for (const n of state.nodes) currentNodes[n.id] = n.name + "|" + n.type;
    for (const v of versions) {
      const item = document.createElement("div");
      item.className = "load-item";
      item.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
      const d = new Date(v.timestamp * 1000);
      const dateStr = d.toLocaleDateString() + " " + d.toLocaleTimeString();
      const label = document.createElement("strong");
      label.style.flex = "1";
      label.textContent = dateStr;
      const meta = document.createElement("span");
      meta.style.cssText = "color:#666;font-size:11px;flex-shrink:0;";
      meta.textContent = (v.nodeCount || 0) + " nodes";
      const diff = document.createElement("span");
      diff.style.cssText = "font-size:10px;width:100%;color:#555;";
      const curCount = state.nodes.length;
      const vCount = v.nodeCount || 0;
      const delta = curCount - vCount;
      diff.textContent = delta > 0 ? `+${delta} nodes since` : delta < 0 ? `${delta} nodes since` : "same size";
      item.append(label, meta, diff);
      const btns = document.createElement("div");
      btns.style.cssText = "display:flex;gap:6px;width:100%;margin-top:4px;";
      const restoreBtn = document.createElement("button");
      restoreBtn.textContent = "Restore";
      restoreBtn.style.cssText = "font-size:10px;padding:3px 10px;background:#0f3460;color:#53a8b6;border:1px solid #53a8b644;border-radius:4px;cursor:pointer;";
      restoreBtn.addEventListener("click", async () => {
        if (!confirm(`Restore version from ${dateStr}? Current tree will be replaced.`)) return;
        try {
          const data = await Storage.loadVersion(name, v.timestamp);
          if (!data) { toast("Version not found"); return; }
          Serialization.fromJSON(state, data.tree, data.layout);
          state.title = data.tree.title || state.title;
          document.getElementById("tree-title").textContent = state.title;
          onChanged();
          Canvas.centerView(true);
          dialog.classList.add("hidden");
          toast(`Restored version from ${dateStr}`);
        } catch (err) { toast("Restore failed: " + err.message); }
      });
      const compareBtn = document.createElement("button");
      compareBtn.textContent = "Compare";
      compareBtn.style.cssText = "font-size:10px;padding:3px 10px;background:#16213e;color:#8888aa;border:1px solid #0f3460;border-radius:4px;cursor:pointer;";
      compareBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        try {
          const data = await Storage.loadVersion(name, v.timestamp);
          if (!data) { diff.textContent = "Version not found"; return; }
          const oldNodes = {};
          for (const [id, n] of Object.entries(data.tree.nodes || {})) oldNodes[id] = n;
          const added = state.nodes.filter(n => !oldNodes[n.id]);
          const removed = Object.values(oldNodes).filter(n => !currentNodes[n.id]);
          const renamed = state.nodes.filter(n => oldNodes[n.id] && oldNodes[n.id].name !== n.name);
          const typeChanged = state.nodes.filter(n => oldNodes[n.id] && oldNodes[n.id].type !== n.type);
          let lines = [];
          if (added.length) lines.push(`+${added.length} added: ${added.slice(0, 5).map(n => n.name).join(", ")}${added.length > 5 ? "…" : ""}`);
          if (removed.length) lines.push(`-${removed.length} removed: ${removed.slice(0, 5).map(n => n.name).join(", ")}${removed.length > 5 ? "…" : ""}`);
          if (renamed.length) lines.push(`~${renamed.length} renamed: ${renamed.slice(0, 3).map(n => oldNodes[n.id].name + " → " + n.name).join(", ")}`);
          if (typeChanged.length) lines.push(`${typeChanged.length} type changed`);
          if (lines.length === 0) lines.push("No structural changes (parameters may differ)");
          diff.innerHTML = "";
          diff.style.color = "#8888aa";
          diff.textContent = lines.join(" · ");
        } catch (err) { diff.textContent = "Compare failed"; }
      });
      btns.append(restoreBtn, compareBtn);
      item.append(btns);
      list.appendChild(item);
    }
  } catch (e) { list.innerHTML = '<p class="hint">Error loading versions</p>'; }
}

// --- Search / Find node (Ctrl+F) ---
const searchDialog = document.getElementById("search-dialog");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");

export function openSearch() {
  searchDialog.classList.remove("hidden");
  searchInput.value = "";
  searchResults.textContent = "";
  setTimeout(() => searchInput.focus(), 0);
}

const searchCount = document.getElementById("search-count");

// --- Find & Replace (Ctrl+H) ---
const replaceDialog = document.getElementById("replace-dialog");
const replaceFind = document.getElementById("replace-find");
const replaceWith = document.getElementById("replace-with");
const replacePreview = document.getElementById("replace-preview");

export function openReplace() {
  replaceDialog.classList.remove("hidden");
  replaceFind.value = "";
  replaceWith.value = "";
  replacePreview.textContent = "";
  setTimeout(() => replaceFind.focus(), 0);
}

function updateReplacePreview() {
  const q = replaceFind.value;
  replacePreview.textContent = "";
  if (!q) { Canvas.setSearchFilter(null); return; }
  const matches = state.nodes.filter(n => n.name.includes(q));
  Canvas.setSearchFilter(matches.length > 0 ? new Set(matches.map(n => n.id)) : null);
  if (matches.length === 0) {
    replacePreview.textContent = "No matches";
    return;
  }
  const rep = replaceWith.value;
  for (const n of matches.slice(0, 10)) {
    const div = document.createElement("div");
    div.style.cssText = "padding:2px 0;display:flex;gap:6px;align-items:center;";
    const before = document.createElement("span");
    before.style.cssText = "text-decoration:line-through;color:#ef4444;";
    before.textContent = n.name;
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    arrow.style.color = "#666";
    const after = document.createElement("span");
    after.style.color = "#22c55e";
    after.textContent = n.name.split(q).join(rep);
    div.append(before, arrow, after);
    replacePreview.appendChild(div);
  }
  if (matches.length > 10) {
    const more = document.createElement("div");
    more.style.cssText = "color:#666;padding:2px 0;";
    more.textContent = `...and ${matches.length - 10} more`;
    replacePreview.appendChild(more);
  }
}

// --- Command palette (Ctrl+P) ---
const cmdPalette = document.getElementById("cmd-palette");
const cmdInput = document.getElementById("cmd-input");
const cmdResults = document.getElementById("cmd-results");

function getCommands() {
  return [
    { label: "New Tree", action: () => document.getElementById("btn-new").click() },
    { label: "New Tab (Ctrl+Shift+T)", action: () => tabAddBtn.click() },
    { label: "Close Tab (Ctrl+W)", action: () => closeTab(activeTabId) },
    { label: "Save", action: () => document.getElementById("btn-save").click() },
    { label: "Load", action: () => document.getElementById("btn-load").click() },
    { label: "Export JSON + Layout", action: () => exportJSON() },
    { label: "Undo", action: () => History.undo() },
    { label: "Redo", action: () => History.redo() },
    { label: "Auto Layout", action: () => { Canvas.animatedAutoLayout(); Canvas.centerView(true); } },
    { label: "Delete Selected", action: () => Canvas.deleteSelected() },
    { label: "Duplicate Selected", action: () => Canvas.copySelected() },
    { label: "Group into Sequence (Ctrl+Shift+G)", action: () => groupIntoSequence() },
    { label: "Select All", action: () => Canvas.setSelectedIds(state.nodes.map(n => n.id)) },
    { label: "Invert Selection", action: () => { const sel = new Set(Canvas.getSelectedIds()); const inv = state.nodes.filter(n => !sel.has(n.id)).map(n => n.id); Canvas.setSelectedIds(inv); toast(`Selected ${inv.length} nodes`); }},
    { label: "Select All Leaves", action: () => { const ids = state.nodes.filter(n => n.category === "leaf").map(n => n.id); Canvas.setSelectedIds(ids); toast(`Selected ${ids.length} leaves`); }},
    { label: "Select All Composites", action: () => { const ids = state.nodes.filter(n => n.category === "composite").map(n => n.id); Canvas.setSelectedIds(ids); toast(`Selected ${ids.length} composites`); }},
    { label: "Select Orphans", action: () => { const ids = state.nodes.filter(n => n.id !== state.root && !state.nodes.some(p => p.children.includes(n.id))).map(n => n.id); if (ids.length) { Canvas.setSelectedIds(ids); toast(`Selected ${ids.length} orphan${ids.length > 1 ? "s" : ""}`); } else toast("No orphans"); }},
    { label: "Fit All in View", action: () => Canvas.centerView(true) },
    { label: "Zoom to Selection", action: () => Canvas.zoomToSelection() },
    { label: "Focus Root", action: () => Canvas.focusRoot() },
    { label: "Find Node", action: () => openSearch() },
    { label: "Find & Replace (Ctrl+H)", action: () => openReplace() },
    { label: "Copy JSON to Clipboard", action: () => copyToClipboard() },
    { label: "Copy Selected Nodes to Clipboard", action: () => copySelectedToClipboard() },
    { label: "Toggle Snap to Grid", action: () => { const on = Canvas.toggleSnap(); toast(on ? "Snap ON" : "Snap OFF"); } },
    { label: "Load Replay", action: () => document.getElementById("btn-replay").click() },
    { label: "Simulate Replay (from current tree)", action: () => simulateReplay() },
    { label: "Export PNG", action: () => document.getElementById("btn-png").click() },
    { label: "Export SVG", action: () => document.getElementById("btn-svg").click() },
    { label: "Paste Tree from Clipboard", action: () => pasteFromClipboard() },
    { label: "Toggle Theme (Light/Dark)", action: () => toggleTheme() },
    { label: "Help / Shortcuts", action: () => document.getElementById("help-dialog").classList.toggle("hidden") },
    { label: "Align Left", action: () => Canvas.alignSelected("left") },
    { label: "Align Right", action: () => Canvas.alignSelected("right") },
    { label: "Align Center Horizontal", action: () => Canvas.alignSelected("center-h") },
    { label: "Align Top", action: () => Canvas.alignSelected("top") },
    { label: "Align Bottom", action: () => Canvas.alignSelected("bottom") },
    { label: "Align Center Vertical", action: () => Canvas.alignSelected("center-v") },
    { label: "Distribute Horizontally", action: () => Canvas.alignSelected("distribute-h") },
    { label: "Distribute Vertically", action: () => Canvas.alignSelected("distribute-v") },
    { label: "Duplicate Subtree", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length === 1) Canvas.copySubtreeOf(sel[0]); else toast("Select one node"); } },
    { label: "AI Generate Tree", action: () => openAI() },
    { label: "Toggle JSON Preview", action: () => toggleJsonPreview() },
    { label: "Import from File (Ctrl+O)", action: () => importFromFile() },
    { label: "Toggle Minimap", action: () => { const mc = document.getElementById("minimap-container"); mc.style.display = mc.style.display === "none" ? "" : "none"; } },
    { label: "Extract Subtree to Clipboard (E)", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length === 1) extractSubtreeToClipboard(sel[0]); else toast("Select one node"); }},
    { label: "Wrap in Decorator (W)", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length === 1) { const n = state.nodes.find(nd => nd.id === sel[0]); if (n) showWrapPicker(n); } else toast("Select one node"); }},
    { label: "Unwrap / Flatten (U)", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length === 1) { const n = state.nodes.find(nd => nd.id === sel[0]); if (n && n.children.length === 1 && NodeTypes.categoryOf(n.type) !== "leaf") unwrapDecorator(n); else toast("Select a node with exactly 1 child"); } else toast("Select one node"); }},
    { label: "Disconnect from Parent (X)", action: () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" })); }},
    { label: "Connect to... (K)", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length === 1) { if (!Canvas.enterConnectMode(sel[0])) toast("Can't add more children"); } else toast("Select one node first"); }},
    { label: "Center on Selection (Home)", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length > 0) Canvas.zoomToSelection(); else Canvas.centerView(true); }},
    { label: "Focus Path to Selected (P)", action: () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "p" })); }},
    { label: "Change Node Type (T)", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length === 1) { const n = state.nodes.find(nd => nd.id === sel[0]); if (n) showTypePicker(n); } else toast("Select one node"); }},
    { label: "Save As (Ctrl+Shift+S)", action: () => { document.getElementById("save-filename").value = ""; document.getElementById("save-dialog").classList.remove("hidden"); setTimeout(() => document.getElementById("save-filename").focus(), 0); }},
    { label: "Show Warnings", action: () => showWarningsPanel() },
    { label: "Auto-fix Warnings", action: () => autoFixWarnings() },
    { label: "Tree Statistics (Ctrl+Shift+I)", action: () => showStats() },
    { label: "Toggle Position Lock (Shift+L)", action: () => { const locked = Canvas.toggleLock(); toast(locked ? "Positions locked" : "Positions unlocked"); }},
    { label: "Cycle Connection Style (Ctrl+Shift+L)", action: () => { const s = Canvas.cycleConnectionStyle(); toast("Connections: " + s); }},
    { label: "Toggle Execution Order (O)", action: () => { const on = Canvas.toggleExecOrder(); toast(on ? "Execution order ON" : "Execution order OFF"); }},
    { label: "Toggle Flow Animation (.)", action: () => { const on = Canvas.toggleFlowDots(); toast(on ? "Flow animation ON" : "Flow animation OFF"); }},
    { label: "Add Child Node (Ctrl+Enter)", action: () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true })); }},
    { label: "Toggle Bookmark (B)", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length === 1) { const on = Canvas.toggleBookmark(sel[0]); toast(on ? "Bookmarked" : "Bookmark removed"); } else toast("Select one node"); }},
    { label: "Next Bookmark (Shift+B)", action: () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "B", shiftKey: true })); }},
    { label: "Zoom to Subtree (Z)", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length === 1) Canvas.zoomToSubtree(sel[0]); else toast("Select one node"); }},
    { label: "Reparent Selected (Shift+P)", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length === 1) { Canvas.enterReparentMode(sel[0]); toast("Click new parent"); } else toast("Select one node"); }},
    { label: "Toggle Replay Heatmap (H)", action: () => { if (Replay.isActive()) { const on = Canvas.toggleHeatmap(); toast(on ? "Heatmap ON" : "Heatmap OFF"); } else toast("Load a replay first"); }},
    { label: "Toggle Tree Outline (Ctrl+Shift+O)", action: () => toggleOutline() },
    { label: "Copy Node Path (Ctrl+Shift+C)", action: () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, shiftKey: true })); }},
    { label: "Copy as Image to Clipboard", action: () => copyAsImage() },
    { label: "Copy as Mermaid Diagram", action: () => copyAsMermaid() },
    { label: "Copy as ASCII Tree", action: () => copyAsAscii() },
    { label: "Version History", action: () => showVersionHistory() },
    { label: "Save Selection as Template", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length === 1) saveAsTemplate(sel[0]); else toast("Select one root node"); } },
    { label: "Undo History Panel", action: () => toggleHistory() },
    { label: "Isolate Subtree (Enter)", action: () => { const sel = Canvas.getSelectedIds(); if (sel.length === 1) { const n = state.nodes.find(x => x.id === sel[0]); if (n && n.children.length > 0) { Canvas.isolateSubtree(sel[0]); Canvas.zoomToSubtree(sel[0]); toast("Isolated: " + n.name); } else toast("Select a node with children"); } else toast("Select one node"); } },
    { label: "Exit Isolation (Esc)", action: () => { if (Canvas.isIsolated()) { Canvas.exitIsolation(); Canvas.centerView(true); toast("Exited isolation"); } else toast("Not in isolation mode"); } },
    { label: "Collapse All Subtrees", action: () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "C", shiftKey: true })); }},
    { label: "Focus Palette Search (/)", action: () => { const pal = document.getElementById("palette"); if (pal.style.display === "none") togglePalette(); const pf = document.getElementById("palette-filter"); pf.focus(); pf.select(); }},
    { label: "Toggle Palette Panel (Ctrl+B)", action: () => togglePalette() },
    { label: "Toggle Properties Panel (Ctrl+\\)", action: () => toggleProperties() },
    { label: "Restore from Backup", action: () => restoreFromBackup() },
    { label: "Toggle Disable Selected (Ctrl+Shift+D)", action: () => {
      const sel = Canvas.getSelectedIds();
      const nodes = sel.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
      if (nodes.length > 0) { const any = nodes.some(n => !n.disabled); for (const n of nodes) n.disabled = any; onChanged(); toast(any ? "Disabled" : "Enabled"); }
    }},
    { label: "Duplicate Entire Tree", action: () => {
      if (state.nodes.length === 0) { toast("Nothing to duplicate"); return; }
      const idMap = {};
      const copies = state.nodes.map(n => {
        const newId = Serialization.uid();
        idMap[n.id] = newId;
        return { ...n, id: newId, children: [...n.children], parameters: { ...n.parameters } };
      });
      for (const c of copies) c.children = c.children.map(cid => idMap[cid] || cid);
      state.title = state.title + " (copy)";
      state.root = idMap[state.root] || "";
      state.nodes = copies;
      Canvas.notifyChanged();
      History.clear();
      pushHistory();
      Canvas.centerView(true);
      Properties.show([]);
      setDirty(true);
      document.getElementById("tree-title").textContent = state.title;
      toast("Tree duplicated");
    }},
    { label: "Export Unity C# Adapter", action: () => exportEngineAdapter("unity") },
    { label: "Export Unreal C++ Adapter", action: () => exportEngineAdapter("unreal") },
    { label: "Export Godot GDScript Adapter", action: () => exportEngineAdapter("godot") },
    { label: "Export as Markdown Documentation", action: () => exportMarkdown() },
  ];
}

export function openCmdPalette() {
  cmdPalette.classList.remove("hidden");
  cmdInput.value = "";
  cmdResults.textContent = "";
  renderCmdResults("");
  setTimeout(() => cmdInput.focus(), 0);
}

function fuzzyScore(query, text) {
  const q = query.toLowerCase(), t = text.toLowerCase();
  if (t.includes(q)) return 1000 - t.indexOf(q);
  let qi = 0, score = 0, consecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) { qi++; consecutive++; score += consecutive * 2 + (ti === 0 || t[ti - 1] === " " ? 5 : 0); }
    else consecutive = 0;
  }
  return qi === q.length ? score : 0;
}

const recentCmds = JSON.parse(localStorage.getItem("bt-recent-cmds") || "[]");

function trackCmd(label) {
  const idx = recentCmds.indexOf(label);
  if (idx >= 0) recentCmds.splice(idx, 1);
  recentCmds.unshift(label);
  if (recentCmds.length > 5) recentCmds.length = 5;
  localStorage.setItem("bt-recent-cmds", JSON.stringify(recentCmds));
}

function renderCmdResults(q) {
  cmdResults.textContent = "";
  const cmds = getCommands();
  let entries;
  if (q) {
    const scored = cmds.map(c => ({ cmd: c, score: fuzzyScore(q, c.label) })).filter(s => s.score > 0);
    scored.sort((a, b) => b.score - a.score);
    entries = scored.slice(0, 10).map(s => s.cmd);
    if (q.length >= 2) {
      const ql = q.toLowerCase();
      const nodeMatches = state.nodes.filter(n => fuzzyScore(ql, n.name) > 0 || fuzzyScore(ql, n.type) > 0 || (n.comment && fuzzyScore(ql, n.comment) > 0)).slice(0, 5);
      for (const n of nodeMatches) {
        const icon = NodeTypes.ICONS[n.type] || "";
        entries.push({ label: `Go to: ${icon} ${n.name}`, action: () => Canvas.focusNode(n.id) });
      }
    }
  } else {
    const recent = recentCmds.map(l => cmds.find(c => c.label === l)).filter(Boolean);
    const rest = cmds.filter(c => !recentCmds.includes(c.label));
    entries = [...recent, ...rest].slice(0, 12);
    if (recent.length > 0) {
      const hdr = document.createElement("div");
      hdr.textContent = "Recent";
      hdr.style.cssText = "font-size:10px;color:#53a8b6;text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px 2px;";
      cmdResults.appendChild(hdr);
    }
  }

  for (let i = 0; i < Math.min(entries.length, 15); i++) {
    const c = entries[i];
    const item = document.createElement("div");
    item.className = "load-item";
    item.textContent = c.label;
    if (i === 0) item.classList.add("cmd-active");
    item.addEventListener("click", () => { cmdPalette.classList.add("hidden"); trackCmd(c.label); c.action(); });
    cmdResults.appendChild(item);
  }
}

export function initDialogs() {
  document.getElementById("stats-close").addEventListener("click", () => document.getElementById("stats-dialog").classList.add("hidden"));

  document.getElementById("btn-ai").addEventListener("click", openAI);
  document.getElementById("ai-generate").addEventListener("click", doGenerate);
  document.getElementById("ai-cancel").addEventListener("click", () => aiDialog.classList.add("hidden"));
  aiInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doGenerate(); }
    if (e.key === "Escape") aiDialog.classList.add("hidden");
  });
  AIGen.loadTemplates();
  document.getElementById("version-cancel").addEventListener("click", () => document.getElementById("version-dialog").classList.add("hidden"));
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.toLowerCase().trim();
    searchResults.textContent = "";
    searchCount.textContent = "";
    if (!q) { Canvas.setSearchFilter(null); return; }
    const matches = [];
    for (const n of state.nodes) {
      let reason = "";
      if (n.name.toLowerCase().includes(q)) reason = "name";
      else if (n.type.toLowerCase().includes(q)) reason = "type";
      else if (n.description && n.description.toLowerCase().includes(q)) reason = "description";
      else if (n.comment && n.comment.toLowerCase().includes(q)) reason = "comment";
      else {
        const pm = Object.entries(n.parameters).find(([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q));
        if (pm) reason = pm[0] + "=" + pm[1];
      }
      if (reason) matches.push({ node: n, reason });
    }
    Canvas.setSearchFilter(new Set(matches.map(m => m.node.id)));
    searchCount.textContent = matches.length > 0 ? (matches.length > 20 ? `${matches.length} (showing 20)` : `${matches.length} found`) : "";
    for (const { node: n, reason } of matches.slice(0, 20)) {
      const item = document.createElement("div");
      item.className = "load-item";
      item.style.display = "flex";
      item.style.alignItems = "center";
      item.style.gap = "8px";
      const icon = NodeTypes.ICONS[n.type] || "";
      const c = NodeTypes.colors(n.category);
      const dot = document.createElement("span");
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${c.stroke};flex-shrink:0;`;
      const strong = document.createElement("strong");
      strong.style.flex = "1";
      strong.textContent = `${icon} ${n.name}`;
      const meta = document.createElement("span");
      meta.style.cssText = "color:#53a8b6;font-size:10px;flex-shrink:0;opacity:0.7;";
      meta.textContent = reason === "name" ? "" : reason;
      const span = document.createElement("span");
      span.style.cssText = "color:#666;font-size:11px;flex-shrink:0;";
      span.textContent = n.type;
      item.append(dot, strong, meta, span);
      item.addEventListener("click", () => {
        Canvas.setSearchFilter(null);
        Canvas.focusNode(n.id);
        searchDialog.classList.add("hidden");
      });
      searchResults.appendChild(item);
    }
    if (matches.length === 0) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "No matching nodes";
      searchResults.appendChild(p);
    }
  });

  searchInput.addEventListener("keydown", e => {
    if (e.key === "Escape") { searchDialog.classList.add("hidden"); Canvas.setSearchFilter(null); return; }
    const items = searchResults.querySelectorAll(".load-item");
    const active = searchResults.querySelector(".cmd-active");
    const idx = [...items].indexOf(active);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (active) active.classList.remove("cmd-active");
      const next = items[Math.min(idx + 1, items.length - 1)];
      if (next) { next.classList.add("cmd-active"); next.scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (active) active.classList.remove("cmd-active");
      const prev = items[Math.max(idx - 1, 0)];
      if (prev) { prev.classList.add("cmd-active"); prev.scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "Enter") {
      const sel = searchResults.querySelector(".cmd-active") || items[0];
      if (sel) sel.click();
    }
  });

  replaceFind.addEventListener("input", updateReplacePreview);
  replaceWith.addEventListener("input", updateReplacePreview);

  document.getElementById("replace-all").addEventListener("click", () => {
    const q = replaceFind.value;
    const rep = replaceWith.value;
    if (!q) return;
    const matches = state.nodes.filter(n => n.name.includes(q));
    if (matches.length === 0) { toast("No matches"); return; }
    for (const n of matches) n.name = n.name.split(q).join(rep);
    Canvas.setSearchFilter(null);
    onChanged();
    Properties.show(Canvas.getSelectedIds());
    replaceDialog.classList.add("hidden");
    toast(`Replaced in ${matches.length} node${matches.length !== 1 ? "s" : ""}`);
  });

  document.getElementById("replace-cancel").addEventListener("click", () => { Canvas.setSearchFilter(null); replaceDialog.classList.add("hidden"); });
  replaceFind.addEventListener("keydown", e => {
    if (e.key === "Escape") { Canvas.setSearchFilter(null); replaceDialog.classList.add("hidden"); }
    if (e.key === "Enter") replaceWith.focus();
  });
  replaceWith.addEventListener("keydown", e => {
    if (e.key === "Escape") { Canvas.setSearchFilter(null); replaceDialog.classList.add("hidden"); }
    if (e.key === "Enter") document.getElementById("replace-all").click();
  });

  cmdInput.addEventListener("input", () => renderCmdResults(cmdInput.value));
  cmdInput.addEventListener("keydown", e => {
    if (e.key === "Escape") { cmdPalette.classList.add("hidden"); return; }
    const items = cmdResults.querySelectorAll(".load-item");
    const active = cmdResults.querySelector(".cmd-active");
    const idx = [...items].indexOf(active);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (active) active.classList.remove("cmd-active");
      const next = items[Math.min(idx + 1, items.length - 1)];
      if (next) { next.classList.add("cmd-active"); next.scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (active) active.classList.remove("cmd-active");
      const prev = items[Math.max(idx - 1, 0)];
      if (prev) { prev.classList.add("cmd-active"); prev.scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "Enter") {
      const sel = cmdResults.querySelector(".cmd-active") || items[0];
      if (sel) sel.click();
    }
  });

  // --- Help overlay ---
  document.getElementById("btn-help").addEventListener("click", () => {
    document.getElementById("help-dialog").classList.toggle("hidden");
  });

  // Escape closes any dialog
  window.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      document.querySelectorAll(".dialog").forEach(d => d.classList.add("hidden"));
    }
  });
}

export function showOnboarding() {
  // --- First-run onboarding ---
  if (!localStorage.getItem("bt-onboarded")) {
    const ob = document.createElement("div");
    ob.id = "onboarding";
    ob.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;cursor:pointer;";
    ob.innerHTML = `<div style="background:#16213e;border:1px solid #0f3460;border-radius:12px;padding:32px 40px;max-width:420px;color:#e0e0e0;font-family:-apple-system,sans-serif;pointer-events:none;">
      <h2 style="margin:0 0 16px;color:#53a8b6;font-size:20px;">Welcome to Behavior Tree Editor</h2>
      <div style="font-size:13px;line-height:1.7;color:#aaa;">
        <p style="margin:0 0 10px;"><strong style="color:#e0e0e0;">Drag</strong> nodes from the left palette onto the canvas</p>
        <p style="margin:0 0 10px;"><strong style="color:#e0e0e0;">Connect</strong> by dragging from an output port to a node</p>
        <p style="margin:0 0 10px;"><strong style="color:#e0e0e0;">1-5</strong> quick-add: Sequence, Selector, Action, Condition, Invert</p>
        <p style="margin:0 0 10px;"><strong style="color:#e0e0e0;">Ctrl+P</strong> command palette — search all commands</p>
        <p style="margin:0 0 10px;"><strong style="color:#e0e0e0;">?</strong> full shortcut reference</p>
        <p style="margin:0 0 10px;"><strong style="color:#e0e0e0;">Ctrl+S</strong> save · <strong style="color:#e0e0e0;">Ctrl+E</strong> export JSON</p>
      </div>
      <p style="margin:16px 0 0;text-align:center;color:#555;font-size:11px;">Click anywhere to start</p>
    </div>`;
    document.body.appendChild(ob);
    function dismissOnboard() {
      ob.remove();
      localStorage.setItem("bt-onboarded", "1");
    }
    ob.addEventListener("click", dismissOnboard);
    document.addEventListener("keydown", function onKey() { dismissOnboard(); document.removeEventListener("keydown", onKey); }, { once: true });
  }
}
