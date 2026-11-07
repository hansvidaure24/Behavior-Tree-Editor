// @ts-check
import { NodeTypes } from './nodes.js';
import { History } from './history.js';
import { Serialization } from './serialization.js';
import { Replay } from './replay.js';
import { Storage } from './storage.js';
import { Canvas } from './canvas.js';
import { Properties } from './properties.js';
import { _extraOnChanged, onChanged, state, toast, validateDetailed } from './app.js';

/** Side panels — warnings, JSON preview, outline, undo history, blackboard keys, replay bar — and panel resizers. */

export let outlineOpen = false;

export const warningsPanel = document.getElementById("warnings-panel");
const warningsList = document.getElementById("warnings-list");

/** Apply the automatic fixes for current warnings (e.g. remove empty composites/decorators). */
export function autoFixWarnings() {
  let fixes = 0;
  const childSet = new Set();
  for (const n of state.nodes) n.children.forEach(c => childSet.add(c));
  // Remove empty composites/decorators with no children and no parent
  const emptyWrappers = state.nodes.filter(n =>
    NodeTypes.categoryOf(n.type) !== "leaf" && n.children.length === 0 && n.id !== state.root
  );
  for (const n of emptyWrappers) {
    state.nodes = state.nodes.filter(x => x.id !== n.id);
    for (const p of state.nodes) p.children = p.children.filter(c => c !== n.id);
    fixes++;
  }
  // Connect orphans to root
  if (state.root) {
    const rootNode = state.nodes.find(n => n.id === state.root);
    if (rootNode && NodeTypes.maxChildren(rootNode.type) > rootNode.children.length) {
      const childSet2 = new Set();
      for (const n of state.nodes) n.children.forEach(c => childSet2.add(c));
      const orphans = state.nodes.filter(n => n.id !== state.root && !childSet2.has(n.id));
      for (const o of orphans) {
        if (rootNode.children.length < NodeTypes.maxChildren(rootNode.type)) {
          rootNode.children.push(o.id);
          fixes++;
        }
      }
    }
  }
  // Restore missing required params
  const reqDefaults = { repeat: { count: 3 }, cooldown: { duration: 2 }, timeout: { seconds: 5 }, parallel: { policy: "fail_on_one" } };
  for (const n of state.nodes) {
    const defs = reqDefaults[n.type];
    if (defs) {
      for (const [k, v] of Object.entries(defs)) {
        if (n.parameters[k] == null || n.parameters[k] === "") { n.parameters[k] = v; fixes++; }
      }
    }
  }
  // Remove dangling child references
  const nodeIds = new Set(state.nodes.map(n => n.id));
  for (const n of state.nodes) {
    const before = n.children.length;
    n.children = n.children.filter(c => nodeIds.has(c));
    fixes += before - n.children.length;
  }
  // Rename default-named leaves
  for (const n of state.nodes) {
    if (NodeTypes.categoryOf(n.type) === "leaf" && n.name === n.type.charAt(0).toUpperCase() + n.type.slice(1)) {
      const parent = state.nodes.find(p => p.children.includes(n.id));
      if (parent) {
        n.name = `${parent.name} ${n.type === "action" ? "Act" : "Check"} ${parent.children.indexOf(n.id) + 1}`;
        fixes++;
      }
    }
  }
  // Set root if none
  if (!state.root && state.nodes.length > 0) {
    state.root = state.nodes[0].id;
    fixes++;
  }
  if (fixes > 0) {
    onChanged();
    Canvas.animatedAutoLayout();
    toast(`Fixed ${fixes} issue${fixes > 1 ? "s" : ""}`);
  } else {
    toast("Nothing to auto-fix");
  }
  showWarningsPanel();
}

export function showWarningsPanel() {
  const w = validateDetailed();
  warningsList.textContent = "";
  if (w.length === 0) {
    warningsPanel.classList.add("hidden");
    return;
  }
  for (const warn of w) {
    const item = document.createElement("div");
    item.className = "warning-item";
    const dot = document.createElement("span");
    dot.className = "warning-dot";
    const text = document.createElement("span");
    text.textContent = warn.msg;
    text.style.flex = "1";
    item.append(dot, text);
    if (warn.nodeId) {
      item.addEventListener("click", () => Canvas.focusNode(warn.nodeId));
    }
    warningsList.appendChild(item);
  }
  const fixBtn = document.createElement("button");
  fixBtn.textContent = "Auto-fix";
  fixBtn.style.cssText = "margin-top:8px;width:100%;padding:6px;font-size:11px;background:#0f3460;color:#53a8b6;border:1px solid #53a8b644;border-radius:4px;cursor:pointer;";
  fixBtn.addEventListener("click", autoFixWarnings);
  warningsList.appendChild(fixBtn);
  warningsPanel.classList.remove("hidden");
}

// --- JSON Preview panel ---
const jsonPanel = document.getElementById("json-panel");
const jsonContent = document.getElementById("json-content");
let jsonPreviewOpen = false;

export function toggleJsonPreview() {
  jsonPreviewOpen = !jsonPreviewOpen;
  if (jsonPreviewOpen) {
    jsonPanel.classList.remove("hidden");
    document.getElementById("btn-json-preview").classList.add("tb-active");
    updateJsonPreview();
  } else {
    jsonPanel.classList.add("hidden");
    document.getElementById("btn-json-preview").classList.remove("tb-active");
  }
}

function highlightJSON(json) {
  return json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"([^"\\]|\\.)*"\s*:/g, m => `<span style="color:#53a8b6">${m.slice(0, -1)}</span>:`)
    .replace(/"([^"\\]|\\.)*"/g, '<span style="color:#95d5b2">$&</span>')
    .replace(/\b(true|false|null)\b/g, '<span style="color:#e09f3e">$&</span>')
    .replace(/(:\s*)(-?\d+\.?\d*)/g, (_, pre, num) => `${pre}<span style="color:#c77dff">${num}</span>`);
}

function updateJsonPreview() {
  if (!jsonPreviewOpen) return;
  const { tree } = Serialization.toJSON(state);
  tree.title = state.title;
  tree.description = state.description;
  const raw = JSON.stringify(tree, null, 2);
  jsonContent.innerHTML = highlightJSON(raw);
}

// --- Tree Outline panel ---
const outlinePanel = document.getElementById("outline-panel");
const outlineContent = document.getElementById("outline-content");
export function toggleOutline() {
  outlineOpen = !outlineOpen;
  if (outlineOpen) {
    outlinePanel.classList.remove("hidden");
    updateOutline();
  } else {
    outlinePanel.classList.add("hidden");
  }
}

export function updateOutline() {
  if (!outlineOpen) return;
  outlineContent.textContent = "";
  if (state.nodes.length === 0) { outlineContent.innerHTML = '<div style="padding:8px;color:#555;font-size:11px;">Empty tree</div>'; return; }
  const nodeById = {};
  for (const n of state.nodes) nodeById[n.id] = n;
  const sel = new Set(Canvas.getSelectedIds());
  const visited = new Set();
  const ancestorPath = new Set();
  if (sel.size === 1) {
    let cur = [...sel][0];
    const ap = new Set();
    while (cur && !ap.has(cur)) {
      ap.add(cur);
      const p = state.nodes.find(pp => pp.children.includes(cur));
      if (p) { ancestorPath.add(p.id); cur = p.id; } else break;
    }
  }

  function renderNode(id, depth) {
    if (visited.has(id)) return;
    visited.add(id);
    const n = nodeById[id];
    if (!n) return;
    const row = document.createElement("div");
    row.className = "outline-node" + (sel.has(n.id) ? " selected" : "") + (ancestorPath.has(n.id) ? " ancestor-path" : "");
    row.style.paddingLeft = (8 + depth * 16) + "px";
    const icon = document.createElement("span");
    icon.className = "on-icon";
    icon.textContent = NodeTypes.ICONS[n.type] || "·";
    const name = document.createElement("span");
    name.className = "on-name";
    name.textContent = n.name;
    if (n.disabled) name.style.textDecoration = "line-through";
    if (n.disabled) name.style.opacity = "0.5";
    const type = document.createElement("span");
    type.className = "on-type";
    type.textContent = n.type;
    if (state._warningIds && state._warningIds.has(n.id)) {
      const warn = document.createElement("span");
      warn.textContent = "⚠";
      warn.style.cssText = "color:#f59e0b;font-size:10px;margin-left:4px;flex-shrink:0;";
      warn.title = "Has warnings";
      row.append(icon, name, warn, type);
    } else {
      row.append(icon, name, type);
    }
    row.dataset.nodeId = n.id;
    row.draggable = true;
    row.addEventListener("dragstart", e => {
      e.dataTransfer.setData("outline-node-id", n.id);
      row.style.opacity = "0.4";
    });
    row.addEventListener("dragend", () => { row.style.opacity = ""; });
    row.addEventListener("dragover", e => {
      e.preventDefault();
      row.style.borderBottom = "2px solid #53a8b6";
    });
    row.addEventListener("dragleave", () => { row.style.borderBottom = ""; });
    row.addEventListener("drop", e => {
      e.preventDefault();
      row.style.borderBottom = "";
      const dragId = e.dataTransfer.getData("outline-node-id");
      const dropId = n.id;
      if (dragId === dropId) return;
      const dragParent = state.nodes.find(p => p.children.includes(dragId));
      const dropParent = state.nodes.find(p => p.children.includes(dropId));
      if (dragParent && dropParent && dragParent.id === dropParent.id) {
        const ci = dragParent.children;
        const from = ci.indexOf(dragId), to = ci.indexOf(dropId);
        if (from >= 0 && to >= 0) {
          ci.splice(from, 1);
          ci.splice(ci.indexOf(dropId) + 1, 0, dragId);
          onChanged();
          updateOutline();
          toast("Reordered");
        }
      } else if (dragParent && dropParent) {
        dragParent.children = dragParent.children.filter(c => c !== dragId);
        const dropIdx = dropParent.children.indexOf(dropId);
        dropParent.children.splice(dropIdx + 1, 0, dragId);
        onChanged();
        updateOutline();
        toast("Moved to " + dropParent.name);
      }
    });
    row.addEventListener("click", () => {
      Canvas.focusNode(n.id);
      setTimeout(updateOutline, 50);
    });
    outlineContent.appendChild(row);
    for (const cid of n.children) renderNode(cid, depth + 1);
  }

  if (state.root && nodeById[state.root]) {
    renderNode(state.root, 0);
  }
  // Orphans
  for (const n of state.nodes) {
    if (!visited.has(n.id)) renderNode(n.id, 0);
  }
  // Apply filter
  const filterQ = /** @type {HTMLInputElement} */ (document.getElementById("outline-filter")).value.toLowerCase().trim();
  if (filterQ) {
    const matchIds = new Set();
    for (const n of state.nodes) {
      if (n.name.toLowerCase().includes(filterQ) || n.type.toLowerCase().includes(filterQ)) matchIds.add(n.id);
    }
    const ancestorIds = new Set();
    function markAncestors(id) {
      const parent = state.nodes.find(p => p.children.includes(id));
      if (parent && !matchIds.has(parent.id)) { ancestorIds.add(parent.id); markAncestors(parent.id); }
    }
    for (const id of matchIds) markAncestors(id);
    for (const row of /** @type {NodeListOf<HTMLElement>} */ (outlineContent.querySelectorAll(".outline-node"))) {
      const nid = row.dataset.nodeId;
      if (matchIds.has(nid)) { row.classList.remove("filter-hidden", "ancestor"); }
      else if (ancestorIds.has(nid)) { row.classList.remove("filter-hidden"); row.classList.add("ancestor"); }
      else { row.classList.add("filter-hidden"); }
    }
  }
  // Auto-scroll to selected node
  const selRow = outlineContent.querySelector(".outline-node.selected:not(.filter-hidden)");
  if (selRow) selRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

const outlineFilter = document.getElementById("outline-filter");

// --- Undo History panel ---
let historyOpen = false;
const historyPanel = document.getElementById("history-panel");
const historyList = document.getElementById("history-list");

export function toggleHistory() {
  historyOpen = !historyOpen;
  if (historyOpen) { historyPanel.classList.remove("hidden"); updateHistoryPanel(); }
  else historyPanel.classList.add("hidden");
}

function updateHistoryPanel() {
  if (!historyOpen) return;
  historyList.textContent = "";
  const entries = History.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const row = document.createElement("div");
    row.className = "history-item" + (e.current ? " current" : "") + (e.index > History.getIndex() ? " future" : "");
    row.textContent = `${e.index}. ${e.summary}`;
    row.addEventListener("click", () => {
      History.jumpTo(e.index);
      updateHistoryPanel();
    });
    historyList.appendChild(row);
  }
  const currentEl = historyList.querySelector(".current");
  if (currentEl) currentEl.scrollIntoView({ block: "nearest" });
}

// --- Blackboard Key Viewer panel ---
const bbViewerPanel = document.getElementById("bb-viewer-panel");
const bbViewerContent = document.getElementById("bb-viewer-content");
let bbViewerOpen = false;

export function toggleBBViewer() {
  bbViewerOpen = !bbViewerOpen;
  if (bbViewerOpen) { bbViewerPanel.classList.remove("hidden"); updateBBViewer(); }
  else bbViewerPanel.classList.add("hidden");
}

function updateBBViewer() {
  if (!bbViewerOpen) return;
  bbViewerContent.textContent = "";
  // Group nodes by blackboard key
  const keyMap = new Map(); // key -> [{node, op, value}]
  for (const n of state.nodes) {
    const k = n.parameters && n.parameters.key;
    if (!k) continue;
    if (!keyMap.has(k)) keyMap.set(k, []);
    keyMap.get(k).push(n);
  }
  if (keyMap.size === 0) {
    bbViewerContent.innerHTML = '<div class="bbv-empty">No blackboard keys in this tree.</div>';
    return;
  }
  for (const [key, nodes] of [...keyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const group = document.createElement("div");
    group.className = "bbv-key-group";
    const keyRow = document.createElement("div");
    keyRow.className = "bbv-key-name";
    keyRow.textContent = key;
    keyRow.title = "Select all nodes using this key";
    keyRow.addEventListener("click", () => {
      Canvas.setSelectedIds(nodes.map(n => n.id));
    });
    group.appendChild(keyRow);
    for (const n of nodes) {
      const row = document.createElement("div");
      row.className = "bbv-node-row";
      const icon = document.createElement("span");
      icon.className = "bbv-node-icon";
      icon.textContent = NodeTypes.ICONS[n.type] || "·";
      const name = document.createElement("span");
      name.className = "bbv-node-name";
      name.textContent = n.name;
      const op = document.createElement("span");
      op.className = "bbv-op";
      const parts = [];
      if (n.parameters.op) parts.push(n.parameters.op);
      if (n.parameters.value !== undefined && n.parameters.value !== "") parts.push(n.parameters.value);
      if (parts.length) op.textContent = parts.join(" ");
      row.append(icon, name, op);
      row.addEventListener("click", () => Canvas.focusNode(n.id));
      group.appendChild(row);
    }
    bbViewerContent.appendChild(group);
  }
}

// --- Replay ---
export const replayBar = document.getElementById("replay-bar");
const replaySlider = /** @type {HTMLInputElement} */ (document.getElementById("replay-slider"));
const replayTickLabel = document.getElementById("replay-tick-label");
const bbPanel = document.getElementById("blackboard-panel");
const bbContent = document.getElementById("blackboard-content");

/** Sync the replay bar, blackboard panel and canvas with the current replay tick. */
export function updateReplayUI() {
  if (!Replay.isActive()) return;
  const tick = Replay.getCurrentTick();
  const total = Replay.getTickCount();
  replaySlider.max = String(total - 1);
  replaySlider.value = String(tick);
  replayTickLabel.textContent = `${tick} / ${total - 1}`;
  document.getElementById("replay-play").textContent = Replay.isPlaying() ? "⏸" : "▶";

  // Blackboard with diff highlighting
  const bb = Replay.getBlackboard();
  const prevTick = tick > 0 ? Replay.getData().ticks[tick - 1] : null;
  const prevBb = prevTick ? prevTick.blackboard || {} : {};
  const keys = Object.keys(bb);
  if (keys.length > 0) {
    bbContent.textContent = "";
    for (const k of keys) {
      const keyEl = document.createElement("span");
      keyEl.className = "bb-key";
      keyEl.textContent = k;
      const valEl = document.createElement("span");
      const changed = JSON.stringify(bb[k]) !== JSON.stringify(prevBb[k]);
      valEl.className = changed ? "bb-val bb-changed" : "bb-val";
      valEl.textContent = JSON.stringify(bb[k]);
      bbContent.append(keyEl, valEl);
    }
    bbPanel.classList.remove("hidden");
  } else {
    bbPanel.classList.add("hidden");
  }

  Canvas.notifyChanged();
  Properties.show(Canvas.getSelectedIds());
}

export function closeReplay() {
  Replay.unload();
  replayBar.classList.add("hidden");
  bbPanel.classList.add("hidden");
  document.getElementById("btn-replay").classList.remove("replay-active");
  Canvas.notifyChanged();
  Properties.show(Canvas.getSelectedIds());
  toast("Replay closed");
}

// --- Simulate Replay ---
/** Run the tree in a simple in-editor simulation and load the result as a replay. */
export function simulateReplay() {
  if (state.nodes.length === 0 || !state.root) { toast("Need a tree with a root to simulate"); return; }
  const nodeById = {};
  for (const n of state.nodes) nodeById[n.id] = n;
  const TICKS = 80;
  const ticks = [];

  // Scenario phases: each condition gets a wave pattern offset by its position in the tree
  const conditionOrder = [];
  const visited = new Set();
  function indexConditions(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const n = nodeById[id];
    if (!n) return;
    if (n.type === "condition") conditionOrder.push(id);
    for (const cid of n.children) indexConditions(cid);
  }
  indexConditions(state.root);

  // Each condition follows a wave: true for a stretch, false for a stretch
  // Earlier conditions in the tree flip first (creating cascading behavior changes)
  const condWaves = {};
  for (let i = 0; i < conditionOrder.length; i++) {
    const period = 12 + i * 5;
    const duty = 0.5 + (i % 3) * 0.15;
    condWaves[conditionOrder[i]] = { period, duty, offset: i * 4 };
  }

  // Track running actions for multi-tick continuity
  const runningUntil = {};

  for (let t = 0; t < TICKS; t++) {
    const nodes = {};
    const bb = { tick: t };

    // Build blackboard from condition results
    const condResults = {};

    function walk(id, canRun) {
      const n = nodeById[id];
      if (!n) return "failure";
      if (n.disabled) { nodes[id] = { status: "skipped" }; return "failure"; }
      const cat = NodeTypes.categoryOf(n.type);

      if (cat === "leaf") {
        if (!canRun) { nodes[id] = { status: "skipped" }; return "skipped"; }
        if (n.type === "condition") {
          const wave = condWaves[id];
          let pass;
          if (wave) {
            const pos = (t + wave.offset) % wave.period;
            pass = pos < wave.period * wave.duty;
          } else {
            pass = t % 4 !== 0;
          }
          condResults[id] = pass;
          if (n.parameters.key) bb[n.parameters.key] = pass;
          nodes[id] = { status: pass ? "success" : "failure" };
          return pass ? "success" : "failure";
        }
        // Actions: run for 2-4 ticks then succeed, occasional failure
        if (runningUntil[id] && t < runningUntil[id]) {
          nodes[id] = { status: "running" };
          return "running";
        }
        const hash = (id.charCodeAt(0) * 31 + t * 7) % 20;
        if (hash < 2) {
          nodes[id] = { status: "failure" };
          return "failure";
        }
        const dur = 2 + (id.charCodeAt(0) % 3);
        runningUntil[id] = t + dur;
        nodes[id] = { status: "running" };
        return "running";
      }

      if (cat === "decorator") {
        if (n.type === "invert") {
          const r = walk(n.children[0], canRun);
          const inv = r === "success" ? "failure" : r === "failure" ? "success" : r;
          nodes[id] = { status: inv };
          return inv;
        }
        if (n.children.length > 0) {
          const r = walk(n.children[0], canRun);
          nodes[id] = { status: r };
          return r;
        }
        nodes[id] = { status: "success" };
        return "success";
      }

      if (n.type === "sequence") {
        let result = "success";
        for (const cid of n.children) {
          const r = walk(cid, canRun && result === "success");
          if (r === "failure") { result = "failure"; canRun = false; }
          else if (r === "running") { result = "running"; canRun = false; }
        }
        nodes[id] = { status: result };
        return result;
      }
      if (n.type === "selector") {
        let result = "failure";
        for (const cid of n.children) {
          const r = walk(cid, canRun && result === "failure");
          if (r === "success") { result = "success"; canRun = false; }
          else if (r === "running") { result = "running"; canRun = false; }
        }
        nodes[id] = { status: result };
        return result;
      }
      if (n.type === "parallel") {
        let anyFail = false, anyRun = false;
        for (const cid of n.children) {
          const r = walk(cid, canRun);
          if (r === "failure") anyFail = true;
          if (r === "running") anyRun = true;
        }
        const s = anyFail ? "failure" : anyRun ? "running" : "success";
        nodes[id] = { status: s };
        return s;
      }
      nodes[id] = { status: "success" };
      return "success";
    }

    walk(state.root, true);
    ticks.push({ tick: t, timestamp: t * 0.016, nodes, blackboard: bb });
  }

  const data = {
    version: "1.0",
    treeTitle: state.title,
    agentId: "Simulated_Agent",
    ticks,
  };
  Replay.load(data);
  replayBar.classList.remove("hidden");
  document.getElementById("btn-replay").classList.add("replay-active");
  document.getElementById("replay-dialog").classList.add("hidden");
  toast(`Simulated replay: ${TICKS} ticks`);
  updateReplayUI();
}

// --- Resizable panels ---
function initResizer(resizerId, panelId, side) {
  const resizer = document.getElementById(resizerId);
  const panel = document.getElementById(panelId);
  let startX, startW;
  function onDown(e) {
    e.preventDefault();
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    resizer.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  function onMove(e) {
    const dx = e.clientX - startX;
    const newW = Math.max(120, Math.min(400, startW + (side === "left" ? dx : -dx)));
    panel.style.width = newW + "px";
    panel.style.minWidth = newW + "px";
  }
  function onUp() {
    resizer.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  resizer.addEventListener("mousedown", onDown);
}

export function initPanels() {

  document.getElementById("warning-badge").addEventListener("click", showWarningsPanel);
  document.getElementById("warnings-close").addEventListener("click", () => warningsPanel.classList.add("hidden"));
  document.addEventListener("mousedown", e => {
    if (!warningsPanel.contains(/** @type {Node} */ (e.target)) && e.target !== document.getElementById("warning-badge")) {
      warningsPanel.classList.add("hidden");
    }
  });

  document.getElementById("btn-json-preview").addEventListener("click", toggleJsonPreview);
  document.getElementById("json-panel-close").addEventListener("click", toggleJsonPreview);
  _extraOnChanged.push(updateJsonPreview);
  outlineFilter.addEventListener("input", updateOutline);
  document.getElementById("outline-close").addEventListener("click", toggleOutline);
  _extraOnChanged.push(updateOutline);

  document.getElementById("history-close").addEventListener("click", toggleHistory);
  _extraOnChanged.push(updateHistoryPanel);

  document.getElementById("bb-viewer-close").addEventListener("click", toggleBBViewer);
  document.getElementById("btn-bb-viewer").addEventListener("click", toggleBBViewer);
  _extraOnChanged.push(updateBBViewer);

  Replay.init(updateReplayUI);

  document.getElementById("btn-replay").addEventListener("click", async () => {
    const list = document.getElementById("replay-list");
    list.innerHTML = "Loading...";
    document.getElementById("replay-dialog").classList.remove("hidden");

    try {
      const replays = await Storage.listReplays();
      if (replays.length === 0) {
        list.innerHTML = "<p class='hint'>No replay files found. Click <strong>Simulate</strong> to generate one from the current tree, or record in Unity.</p>";
        return;
      }
      list.textContent = "";
      for (const r of replays) {
        const item = document.createElement("div");
        item.className = "load-item";
        item.dataset.dir = r.dir;
        item.dataset.name = r.name;
        const strong = document.createElement("strong");
        strong.textContent = r.name;
        const span = document.createElement("span");
        span.style.cssText = "color:#666;font-size:11px;";
        span.textContent = r.dir;
        item.append(strong, " ", span);
        list.appendChild(item);
      }

      list.querySelectorAll(".load-item").forEach(/** @param {HTMLElement} item */ item => {
        item.addEventListener("click", async () => {
          try {
            const data = await Storage.loadReplay(item.dataset.dir, item.dataset.name);
            if (!data) { toast("Replay not found"); return; }
            Replay.load(data);
            replayBar.classList.remove("hidden");
            document.getElementById("btn-replay").classList.add("replay-active");
            document.getElementById("replay-dialog").classList.add("hidden");
            toast(`Replay loaded: ${data.agentId || item.dataset.name} (${data.ticks.length} ticks)`);
          } catch (err) {
            toast("Replay load failed: " + err.message);
          }
        });
      });
    } catch (e) {
      list.innerHTML = "<p>Error loading replay list</p>";
    }
  });

  document.getElementById("replay-cancel").addEventListener("click", () => {
    document.getElementById("replay-dialog").classList.add("hidden");
  });
  document.getElementById("replay-simulate").addEventListener("click", simulateReplay);

  replaySlider.addEventListener("input", () => {
    Replay.setTick(parseInt(replaySlider.value));
  });

  document.getElementById("replay-play").addEventListener("click", () => {
    Replay.isPlaying() ? Replay.pause() : Replay.play();
    updateReplayUI();
  });

  document.getElementById("replay-step-back").addEventListener("click", () => Replay.stepBack());
  document.getElementById("replay-step-fwd").addEventListener("click", () => Replay.stepForward());
  document.getElementById("replay-close").addEventListener("click", closeReplay);

  document.getElementById("replay-speed").addEventListener("change", e => {
    Replay.setSpeed(parseFloat(/** @type {HTMLSelectElement} */ (e.target).value));
  });
}

export function initResizers() {
  initResizer("resizer-left", "palette", "left");
  initResizer("resizer-right", "properties", "right");
}
