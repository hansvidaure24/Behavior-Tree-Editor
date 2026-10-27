import { NodeTypes } from './nodes.js';
import { History } from './history.js';
import { Serialization } from './serialization.js';
import { Replay } from './replay.js';
import { Storage } from './storage.js';
import { Validation } from './validation.js';
import { Exports } from './exports.js';
import { Canvas } from './canvas.js';
import { Properties } from './properties.js';
import { ContextMenus } from './context-menus.js';
import { AIGen } from './ai-gen.js';

/** Main app — wires everything together. */
{
  function showChoice(title, options) {
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

  let state = { title: "Untitled", description: "", root: "", nodes: [] };
  let dirty = false;
  let fileHandle = null; // File System Access API handle for re-save
  let warningIdx = 0;
  let outlineOpen = false;
  const ctxMenu = document.getElementById("context-menu");

  const canvas = document.getElementById("canvas");
  const minimap = document.getElementById("minimap");
  const propsEl = document.getElementById("props-content");

  // --- Multi-tree tabs ---
  let tabs = [];
  let activeTabId = null;
  let tabCounter = 0;
  const tabBar = document.getElementById("tab-bar");
  const tabAddBtn = document.getElementById("tab-add");

  function newTabId() { return "tab-" + (++tabCounter); }

  function snapshotTab() {
    const { tree, layout } = Serialization.toJSON(state);
    tree.title = state.title;
    tree.description = state.description;
    return { title: state.title, tree, layout, dirty };
  }

  function createTab(title) {
    const id = newTabId();
    tabs.push({ id, title: title || "Untitled", tree: null, layout: null, dirty: false });
    return id;
  }

  function switchTab(id) {
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
      dirty = tab.dirty;
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
      dirty = false;
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

  function closeTab(id) {
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

  function renderTabs() {
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

  // --- Toast ---
  function toast(msg) {
    let el = document.getElementById("toast");
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
  function pushHistory() {
    const { tree, layout } = Serialization.toJSON(state);
    History.push({ tree, layout });
  }

  function setDirty(d) {
    dirty = d;
    const title = state.title || "Untitled";
    const el = document.getElementById("tree-title");
    el.textContent = dirty ? title + " *" : title;
    const countStr = state.nodes.length > 0 ? ` (${state.nodes.length})` : "";
    document.title = (dirty ? "* " : "") + title + countStr + " — BT Editor";
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab) { activeTab.title = title; activeTab.dirty = dirty; renderTabs(); }
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

  function updateUndoRedoButtons() {
    const undoBtn = document.getElementById("btn-undo");
    const redoBtn = document.getElementById("btn-redo");
    undoBtn.disabled = !History.canUndo();
    redoBtn.disabled = !History.canRedo();
    undoBtn.title = History.canUndo() ? `Undo (Ctrl+Z) — ${History.getUndoCount()} step${History.getUndoCount() !== 1 ? "s" : ""}` : "Nothing to undo";
    redoBtn.title = History.canRedo() ? `Redo (Ctrl+Shift+Z) — ${History.getRedoCount()} step${History.getRedoCount() !== 1 ? "s" : ""}` : "Nothing to redo";
  }

  function updatePaletteCounts() {
    const counts = { composite: 0, leaf: 0, decorator: 0 };
    const typeCounts = {};
    for (const n of state.nodes) {
      counts[n.category] = (counts[n.category] || 0) + 1;
      typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
    }
    document.querySelectorAll(".palette-section").forEach(sec => {
      const text = sec.textContent.replace(/\s*\(\d+\)/, "");
      const raw = text.toLowerCase().replace(/s$/, "");
      const cat = raw === "leave" ? "leaf" : raw;
      const count = counts[cat] || 0;
      sec.textContent = count > 0 ? `${text} (${count})` : text;
    });
    document.querySelectorAll(".palette-item[data-type]").forEach(el => {
      const type = el.dataset.type;
      let badge = el.querySelector(".type-count");
      const c = typeCounts[type] || 0;
      if (c > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "type-count";
          el.appendChild(badge);
        }
        badge.textContent = c;
      } else if (badge) {
        badge.remove();
      }
    });
  }

  function updateWarnings() {
    const w = validate();
    const wd = validateDetailed();
    state._warningIds = new Set(wd.filter(x => x.nodeId).map(x => x.nodeId));
    const badge = document.getElementById("warning-badge");
    if (w.length > 0) {
      badge.textContent = w.length + " warning" + (w.length > 1 ? "s" : "");
      badge.title = "Click to cycle through warnings\n" + w.join("\n");
      badge.classList.remove("hidden");
      warningIdx = 0;
    } else {
      badge.classList.add("hidden");
    }
  }

  let _extraOnChanged = [];
  function onChanged() {
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
  selInfoEl.className = "selection-info";
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

  // Init modules
  History.init(restoreState);
  Canvas.init(canvas, minimap, state, { onChanged, onSelect, onContextMenu: ContextMenus.showContextMenu, onRejectReason: msg => toast(msg), onConnectionContextMenu: ContextMenus.showConnectionContextMenu, onCanvasContextMenu: ContextMenus.showCanvasContextMenu, onConnectEmpty: ContextMenus.showQuickCreate });
  Properties.init(propsEl, state, { onChanged });

  // Append selection info bar
  document.getElementById("main").appendChild(selInfoEl);

  // Zoom level display
  const zoomLevelEl = document.getElementById("zoom-level");
  const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
  Canvas.setOnZoomChange(z => { zoomLevelEl.textContent = Math.round(z * 100) + "%"; });
  zoomLevelEl.addEventListener("click", e => {
    if (e.shiftKey) {
      const cur = Canvas.getZoom();
      const next = ZOOM_PRESETS.find(z => z > cur + 0.01) || ZOOM_PRESETS[0];
      Canvas.setZoom(next);
      toast(Math.round(next * 100) + "%");
    } else {
      Canvas.setZoom(1);
      toast("Zoom reset to 100%");
    }
  });

  document.getElementById("empty-examples").addEventListener("click", e => {
    const btn = e.target.closest("[data-example]");
    if (!btn) return;
    loadTreeByRef("examples", btn.dataset.example).catch(err => toast("Load failed: " + err.message));
  });
  document.getElementById("empty-ai-btn").addEventListener("click", () => openAI());

  pushHistory();
  updateUndoRedoButtons();

  // --- Palette drag ---
  const dragGhost = document.createElement("canvas");
  dragGhost.width = 120; dragGhost.height = 40;
  dragGhost.style.position = "fixed"; dragGhost.style.left = "-9999px";
  document.body.appendChild(dragGhost);

  document.querySelectorAll(".palette-item").forEach(item => {
    item.addEventListener("dragstart", e => {
      e.dataTransfer.setData("node-type", item.dataset.type);
      e.dataTransfer.setData("node-category", item.dataset.category);
      const type = item.dataset.type;
      const cat = item.dataset.category;
      if (type && cat) {
        const gc = dragGhost.getContext("2d");
        const colors = NodeTypes.colors(cat);
        gc.clearRect(0, 0, 120, 40);
        gc.fillStyle = colors.bg;
        gc.strokeStyle = colors.stroke;
        gc.lineWidth = 2;
        gc.beginPath(); gc.roundRect(2, 2, 116, 36, 6); gc.fill(); gc.stroke();
        gc.fillStyle = colors.stroke;
        gc.font = "bold 11px -apple-system, sans-serif";
        gc.textAlign = "center"; gc.textBaseline = "middle";
        gc.fillText((NodeTypes.ICONS[type] || "") + " " + type, 60, 20);
        e.dataTransfer.setDragImage(dragGhost, 60, 20);
      }
    });
  });

  // --- Palette click-to-add ---
  const shortcutMap = { sequence: "1", selector: "2", action: "3", condition: "4", invert: "5", repeat: "6", cooldown: "7", parallel: "8", guard: "9" };
  document.querySelectorAll(".palette-item:not(.template-item)").forEach(item => {
    item.addEventListener("click", () => {
      Canvas.addNodeAtCenter(item.dataset.type);
    });
    const key = shortcutMap[item.dataset.type];
    if (key) {
      const badge = document.createElement("span");
      badge.className = "palette-key";
      badge.textContent = key;
      item.appendChild(badge);
    }
  });

  // --- Template snippets ---
  const TEMPLATES = {
    "check-then-act": () => {
      const uid = Serialization.uid;
      const cond = { id: uid(), type: "condition", category: "leaf", name: "Check Condition", children: [], parameters: {}, x: 0, y: 80 };
      const act = { id: uid(), type: "action", category: "leaf", name: "Do Action", children: [], parameters: {}, x: 180, y: 80 };
      const seq = { id: uid(), type: "sequence", category: "composite", name: "Check Then Act", children: [cond.id, act.id], parameters: {}, x: 90, y: 0 };
      return [seq, cond, act];
    },
    "try-fallback": () => {
      const uid = Serialization.uid;
      const primary = { id: uid(), type: "action", category: "leaf", name: "Try Primary", children: [], parameters: {}, x: 0, y: 80 };
      const fallback = { id: uid(), type: "action", category: "leaf", name: "Fallback", children: [], parameters: {}, x: 180, y: 80 };
      const sel = { id: uid(), type: "selector", category: "composite", name: "Try Or Fallback", children: [primary.id, fallback.id], parameters: {}, x: 90, y: 0 };
      return [sel, primary, fallback];
    },
    "cooldown-action": () => {
      const uid = Serialization.uid;
      const act = { id: uid(), type: "action", category: "leaf", name: "Action", children: [], parameters: {}, x: 0, y: 80 };
      const cd = { id: uid(), type: "cooldown", category: "decorator", name: "Cooldown", children: [act.id], parameters: { duration: 2 }, x: 0, y: 0 };
      return [cd, act];
    },
    "guarded-sequence": () => {
      const uid = Serialization.uid;
      const cond = { id: uid(), type: "condition", category: "leaf", name: "Guard Condition", children: [], parameters: {}, x: 0, y: 160 };
      const act = { id: uid(), type: "action", category: "leaf", name: "Guarded Action", children: [], parameters: {}, x: 180, y: 160 };
      const seq = { id: uid(), type: "sequence", category: "composite", name: "Guarded Steps", children: [cond.id, act.id], parameters: {}, x: 90, y: 80 };
      const guard = { id: uid(), type: "guard", category: "decorator", name: "Guard", children: [seq.id], parameters: {}, x: 90, y: 0 };
      return [guard, seq, cond, act];
    },
  };

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

  document.querySelectorAll(".template-item").forEach(item => {
    item.addEventListener("click", () => {
      const tmpl = TEMPLATES[item.dataset.template];
      if (!tmpl) return;
      const nodes = tmpl();
      const offsetX = state.nodes.length > 0 ? (Math.max(...state.nodes.map(n => n.x)) + 250) : 0;
      for (const n of nodes) { n.x += offsetX; }
      state.nodes.push(...nodes);
      if (state.nodes.length === nodes.length) state.root = nodes[0].id;
      Canvas.notifyChanged();
      Canvas.triggerSpawn(nodes.map(n => n.id));
      Canvas.setSelectedIds(nodes.map(n => n.id));
      onChanged();
      Canvas.centerView(true);
      toast("Added template: " + nodes[0].name);
    });
  });

  // --- User-saved subtree templates ---
  function getUserTemplates() { return JSON.parse(localStorage.getItem("bt-user-templates") || "[]"); }
  function setUserTemplates(list) { localStorage.setItem("bt-user-templates", JSON.stringify(list)); }

  function saveAsTemplate(rootId) {
    const { tree, layout } = Canvas.extractSubtree(rootId);
    // Merge layout positions into tree nodes for self-contained templates
    for (const [id, pos] of Object.entries(layout.nodes)) {
      if (tree.nodes[id]) { tree.nodes[id].x = pos.x; tree.nodes[id].y = pos.y; }
    }
    const node = state.nodes.find(n => n.id === rootId);
    const name = prompt("Template name:", node ? node.name : "My Template");
    if (!name) return;
    const templates = getUserTemplates();
    templates.push({ name, tree });
    setUserTemplates(templates);
    renderUserTemplates();
    toast(`Saved template "${name}" (${Object.keys(tree.nodes).length} nodes)`);
  }

  function renderUserTemplates() {
    const list = document.getElementById("user-templates-list");
    const section = document.getElementById("user-templates-section");
    const templates = getUserTemplates();
    list.textContent = "";
    section.style.display = templates.length > 0 ? "" : "none";
    for (let i = 0; i < templates.length; i++) {
      const t = templates[i];
      const item = document.createElement("div");
      item.className = "palette-item template-item";
      item.style.cssText = "background:#1a2340;color:#7dd3e0;border:1px dashed #7dd3e044;cursor:pointer;display:flex;align-items:center;gap:4px;";
      item.title = `${Object.keys(t.tree.nodes).length} nodes — click to add, right-click to delete`;
      const icon = document.createElement("span");
      icon.className = "palette-icon";
      icon.textContent = "⭐";
      const label = document.createElement("span");
      label.style.flex = "1";
      label.textContent = t.name;
      const del = document.createElement("span");
      del.textContent = "×";
      del.style.cssText = "opacity:0.4;cursor:pointer;padding:0 4px;font-size:14px;";
      del.title = "Delete template";
      del.addEventListener("click", ev => {
        ev.stopPropagation();
        const ts = getUserTemplates();
        ts.splice(i, 1);
        setUserTemplates(ts);
        renderUserTemplates();
        toast(`Deleted template "${t.name}"`);
      });
      item.append(icon, label, del);
      item.addEventListener("click", () => {
        const idMap = {};
        const nodes = [];
        for (const [oldId, entry] of Object.entries(t.tree.nodes)) {
          idMap[oldId] = Serialization.uid();
        }
        const offsetX = state.nodes.length > 0 ? Math.max(...state.nodes.map(n => n.x)) + 250 : 0;
        for (const [oldId, entry] of Object.entries(t.tree.nodes)) {
          nodes.push({
            id: idMap[oldId], type: entry.type, category: entry.category, name: entry.name,
            children: (entry.children || []).map(c => idMap[c]).filter(Boolean),
            parameters: { ...(entry.parameters || {}) },
            comment: entry.comment || "", color: entry.color || "", disabled: !!entry.disabled,
            description: entry.description || "",
            x: (entry.x || 0) + offsetX, y: entry.y || 0,
          });
        }
        state.nodes.push(...nodes);
        if (state.nodes.length === nodes.length && t.tree.root) state.root = idMap[t.tree.root] || nodes[0].id;
        Canvas.notifyChanged();
        Canvas.triggerSpawn(nodes.map(n => n.id));
        Canvas.setSelectedIds(nodes.map(n => n.id));
        onChanged();
        Canvas.centerView(true);
        toast(`Added template "${t.name}" (${nodes.length} nodes)`);
      });
      list.appendChild(item);
    }
  }
  renderUserTemplates();

  // --- Collapsible palette sections ---
  document.querySelectorAll(".palette-section").forEach(sec => {
    sec.style.cursor = "pointer";
    sec.style.userSelect = "none";
    const arrow = document.createElement("span");
    arrow.textContent = " ▾";
    arrow.style.cssText = "font-size:9px;opacity:0.5;transition:transform 0.15s;display:inline-block;";
    sec.appendChild(arrow);
    function setCollapsed(section, collapse) {
      section.dataset.collapsed = collapse ? "1" : "0";
      const a = section.querySelector("span");
      if (a) a.style.transform = collapse ? "rotate(-90deg)" : "";
      let next = section.nextElementSibling;
      while (next && !next.classList.contains("palette-section")) {
        next.style.display = collapse ? "none" : "";
        next = next.nextElementSibling;
      }
    }

    sec.addEventListener("click", () => {
      setCollapsed(sec, sec.dataset.collapsed !== "1");
    });

    sec.addEventListener("dblclick", () => {
      document.querySelectorAll(".palette-section").forEach(other => {
        setCollapsed(other, other !== sec);
      });
    });
  });

  // --- Palette filter ---
  document.getElementById("palette-filter").addEventListener("input", e => {
    const q = e.target.value.toLowerCase().trim();
    let anyMatch = false;
    document.querySelectorAll(".palette-item").forEach(item => {
      const match = !q || (item.dataset.type && item.dataset.type.includes(q)) || item.textContent.toLowerCase().includes(q);
      item.style.display = match ? "" : "none";
      if (match) anyMatch = true;
    });
    document.querySelectorAll(".palette-section").forEach(sec => {
      let next = sec.nextElementSibling;
      let anyVisible = false;
      while (next && !next.classList.contains("palette-section")) {
        if (next.style.display !== "none") anyVisible = true;
        next = next.nextElementSibling;
      }
      sec.style.display = anyVisible ? "" : "none";
    });
    let noMatch = document.getElementById("palette-no-match");
    if (!anyMatch && q) {
      if (!noMatch) {
        noMatch = document.createElement("p");
        noMatch.id = "palette-no-match";
        noMatch.className = "hint";
        noMatch.style.cssText = "margin-top:10px;text-align:center;";
        document.getElementById("palette").appendChild(noMatch);
      }
      noMatch.textContent = `No nodes matching "${q}"`;
      noMatch.style.display = "";
    } else if (noMatch) {
      noMatch.style.display = "none";
    }
  });
  document.getElementById("palette-filter").addEventListener("keydown", e => {
    if (e.key === "Escape") {
      e.target.value = "";
      e.target.dispatchEvent(new Event("input"));
      e.target.blur();
    }
    if (e.key === "Enter") {
      const first = document.querySelector(".palette-item:not(.template-item):not([style*='display: none'])");
      if (first && first.dataset.type) {
        Canvas.addNodeAtCenter(first.dataset.type);
        const cat = NodeTypes.categoryOf(first.dataset.type);
        if (cat === "leaf") setTimeout(() => { const el = document.getElementById("prop-name"); if (el) { el.focus(); el.select(); } }, 50);
        e.target.value = "";
        e.target.dispatchEvent(new Event("input"));
        e.target.blur();
      }
    }
  });

  // --- Title editing ---
  function bindTitleEdit(el) {
    el.addEventListener("dblclick", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.value = state.title;
      input.className = "title-edit";
      el.replaceWith(input);
      input.focus();
      input.select();

      function commit() {
        state.title = input.value.trim() || "Untitled";
        const span = document.createElement("span");
        span.id = "tree-title";
        span.textContent = dirty ? state.title + " *" : state.title;
        input.replaceWith(span);
        bindTitleEdit(span);
        if (onChanged) onChanged();
      }
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", e => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") { input.value = state.title; input.blur(); }
      });
    });
  }
  bindTitleEdit(document.getElementById("tree-title"));

  // --- Context menu ---

  function showContextMenu(node, cx, cy) { ContextMenus.showContextMenu(node, cx, cy); }
  function renderCtxItems(items) { ContextMenus.renderCtxItems(items); }
  function positionCtxMenu(cx, cy) { ContextMenus.positionCtxMenu(cx, cy); }
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

  function unwrapDecorator(node) {
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

  function groupIntoSequence() {
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
  function showTypePicker(node) { ContextMenus.showTypePicker(node); }
  function showWrapPicker(node) { ContextMenus.showWrapPicker(node); }

  function importFromFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const data = JSON.parse(reader.result);
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

  document.addEventListener("mousedown", e => {
    if (!ctxMenu.contains(e.target)) ctxMenu.classList.add("hidden");
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") ctxMenu.classList.add("hidden");
  });

  // --- Toolbar ---
  document.getElementById("btn-new").addEventListener("click", () => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    state.title = "Untitled";
    state.description = "";
    state.root = "";
    state.nodes = [];
    Canvas.notifyChanged();
    History.clear();
    pushHistory();
    Properties.show([]);
    setDirty(false);
    try { localStorage.removeItem("bt-editor-autosave"); } catch {}
  });

  function togglePalette() {
    const p = document.getElementById("palette");
    const r = document.getElementById("resizer-left");
    const hidden = p.style.display === "none";
    p.style.display = hidden ? "" : "none";
    r.style.display = hidden ? "" : "none";
    toast(hidden ? "Palette visible" : "Palette hidden");
  }
  function toggleProperties() {
    const p = document.getElementById("properties");
    const r = document.getElementById("resizer-right");
    const hidden = p.style.display === "none";
    p.style.display = hidden ? "" : "none";
    r.style.display = hidden ? "" : "none";
    toast(hidden ? "Properties visible" : "Properties hidden");
  }

  document.getElementById("btn-undo").addEventListener("click", () => History.undo());
  document.getElementById("btn-redo").addEventListener("click", () => History.redo());
  document.getElementById("btn-delete").addEventListener("click", () => Canvas.deleteSelected());
  document.getElementById("btn-layout").addEventListener("click", () => {
    Canvas.animatedAutoLayout();
    Canvas.centerView(true);
  });
  document.getElementById("btn-png").addEventListener("click", () => {
    const dataUrl = Canvas.exportPNG();
    if (!dataUrl) { toast("No nodes to export"); return; }
    const name = state.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "") || "tree";
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = name + ".png";
    a.click();
    toast("PNG exported");
  });
  // --- Theme toggle ---
  function toggleTheme() {
    document.body.classList.toggle("light");
    const isLight = document.body.classList.contains("light");
    try { localStorage.setItem("bt-editor-theme", isLight ? "light" : "dark"); } catch {}
    toast(isLight ? "Light theme" : "Dark theme");
  }
  try {
    const saved = localStorage.getItem("bt-editor-theme");
    if (saved === "light") document.body.classList.add("light");
    else if (!saved && window.matchMedia("(prefers-color-scheme: light)").matches) document.body.classList.add("light");
  } catch {}
  document.getElementById("btn-theme").addEventListener("click", toggleTheme);

  const warningsPanel = document.getElementById("warnings-panel");
  const warningsList = document.getElementById("warnings-list");

  function autoFixWarnings() {
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

  function showWarningsPanel() {
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

  document.getElementById("warning-badge").addEventListener("click", showWarningsPanel);
  document.getElementById("warnings-close").addEventListener("click", () => warningsPanel.classList.add("hidden"));
  document.addEventListener("mousedown", e => {
    if (!warningsPanel.contains(e.target) && e.target !== document.getElementById("warning-badge")) {
      warningsPanel.classList.add("hidden");
    }
  });

  // --- Statistics dialog ---
  function showStats() {
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
  document.getElementById("stats-close").addEventListener("click", () => document.getElementById("stats-dialog").classList.add("hidden"));

  // --- AI Generate ---
  const aiDialog = document.getElementById("ai-dialog");
  const aiInput = document.getElementById("ai-input");
  const aiHints = document.getElementById("ai-hints");

  function openAI() {
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

  document.getElementById("btn-ai").addEventListener("click", openAI);
  document.getElementById("ai-generate").addEventListener("click", doGenerate);
  document.getElementById("ai-cancel").addEventListener("click", () => aiDialog.classList.add("hidden"));
  aiInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doGenerate(); }
    if (e.key === "Escape") aiDialog.classList.add("hidden");
  });
  AIGen.loadTemplates();

  // --- JSON Preview panel ---
  const jsonPanel = document.getElementById("json-panel");
  const jsonContent = document.getElementById("json-content");
  let jsonPreviewOpen = false;

  function toggleJsonPreview() {
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

  document.getElementById("btn-json-preview").addEventListener("click", toggleJsonPreview);
  document.getElementById("json-panel-close").addEventListener("click", toggleJsonPreview);
  _extraOnChanged.push(updateJsonPreview);

  // --- Tree Outline panel ---
  const outlinePanel = document.getElementById("outline-panel");
  const outlineContent = document.getElementById("outline-content");
  function toggleOutline() {
    outlineOpen = !outlineOpen;
    if (outlineOpen) {
      outlinePanel.classList.remove("hidden");
      updateOutline();
    } else {
      outlinePanel.classList.add("hidden");
    }
  }

  function updateOutline() {
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
    const filterQ = document.getElementById("outline-filter").value.toLowerCase().trim();
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
      for (const row of outlineContent.querySelectorAll(".outline-node")) {
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
  outlineFilter.addEventListener("input", updateOutline);
  document.getElementById("outline-close").addEventListener("click", toggleOutline);
  _extraOnChanged.push(updateOutline);

  // --- Undo History panel ---
  let historyOpen = false;
  const historyPanel = document.getElementById("history-panel");
  const historyList = document.getElementById("history-list");

  function toggleHistory() {
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

  document.getElementById("history-close").addEventListener("click", toggleHistory);
  _extraOnChanged.push(updateHistoryPanel);

  // --- Blackboard Key Viewer panel ---
  const bbViewerPanel = document.getElementById("bb-viewer-panel");
  const bbViewerContent = document.getElementById("bb-viewer-content");
  let bbViewerOpen = false;

  function toggleBBViewer() {
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

  document.getElementById("bb-viewer-close").addEventListener("click", toggleBBViewer);
  document.getElementById("btn-bb-viewer").addEventListener("click", toggleBBViewer);
  _extraOnChanged.push(updateBBViewer);

  document.getElementById("btn-svg").addEventListener("click", () => {
    const svg = Canvas.exportSVG();
    if (!svg) { toast("No nodes to export"); return; }
    const name = state.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "") || "tree";
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name + ".svg";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("SVG exported");
  });

  document.getElementById("btn-zoom-in").addEventListener("click", () => Canvas.zoomBy(1.25));
  document.getElementById("btn-zoom-out").addEventListener("click", () => Canvas.zoomBy(0.8));
  document.getElementById("btn-zoom-fit").addEventListener("click", () => Canvas.centerView(true));

  // --- Validation ---
  function validateDetailed() { return Validation.validateDetailed(state); }

  function validate() { return Validation.validate(state); }

  // --- Export (download JSON) ---
  function exportJSON() {
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

  document.getElementById("btn-export").addEventListener("click", e => {
    const btn = e.currentTarget;
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

  function download(blob, filename) { Exports.download(blob, filename); }

  // --- Save dialog ---
  document.getElementById("btn-save").addEventListener("click", () => {
    document.getElementById("save-filename").value = state.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "") || "my-tree";
    document.getElementById("save-dialog").classList.remove("hidden");
    setTimeout(() => document.getElementById("save-filename").select(), 0);
  });

  document.getElementById("save-confirm").addEventListener("click", async () => {
    const filename = document.getElementById("save-filename").value.trim();
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

  document.getElementById("save-filename").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("save-confirm").click();
    if (e.key === "Escape") document.getElementById("save-cancel").click();
  });

  // --- Load dialog ---
  async function loadTreeByRef(dir, name) {
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

      list.querySelectorAll(".load-item[data-dir]").forEach(item => {
        item.addEventListener("click", (e) => {
          if (e.target.tagName === "BUTTON") return;
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

  const loadFilter = document.getElementById("load-filter");
  loadFilter.addEventListener("input", () => {
    const q = loadFilter.value.toLowerCase().trim();
    document.querySelectorAll("#load-list .load-item[data-name]").forEach(item => {
      item.style.display = !q || item.dataset.name.toLowerCase().includes(q) ? "" : "none";
    });
  });
  loadFilter.addEventListener("keydown", e => {
    if (e.key === "Escape") { loadFilter.value = ""; loadFilter.dispatchEvent(new Event("input")); }
    if (e.key === "Enter") {
      const visible = document.querySelector("#load-list .load-item[data-name]:not([style*='display: none'])");
      if (visible) visible.click();
    }
  });

  // --- Open Folder ---
  const folderBtn = document.getElementById("btn-folder");
  if ("showDirectoryPicker" in window) {
    folderBtn.addEventListener("click", async () => {
      const handle = await Storage.openDirectory();
      if (handle) toast("Folder: " + Storage.getDirectoryName());
    });
  } else {
    folderBtn.style.display = "none";
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
  document.getElementById("version-cancel").addEventListener("click", () => document.getElementById("version-dialog").classList.add("hidden"));

  // --- Replay ---
  const replayBar = document.getElementById("replay-bar");
  const replaySlider = document.getElementById("replay-slider");
  const replayTickLabel = document.getElementById("replay-tick-label");
  const bbPanel = document.getElementById("blackboard-panel");
  const bbContent = document.getElementById("blackboard-content");

  function updateReplayUI() {
    if (!Replay.isActive()) return;
    const tick = Replay.getCurrentTick();
    const total = Replay.getTickCount();
    replaySlider.max = total - 1;
    replaySlider.value = tick;
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

  Replay.init(updateReplayUI);

  function closeReplay() {
    Replay.unload();
    replayBar.classList.add("hidden");
    bbPanel.classList.add("hidden");
    document.getElementById("btn-replay").classList.remove("replay-active");
    Canvas.notifyChanged();
    Properties.show(Canvas.getSelectedIds());
    toast("Replay closed");
  }

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

      list.querySelectorAll(".load-item").forEach(item => {
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
    Replay.setSpeed(parseFloat(e.target.value));
  });

  // --- Simulate Replay ---
  function simulateReplay() {
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

  // --- Extract subtree to clipboard ---
  function extractSubtreeToClipboard(id) {
    const { tree } = Canvas.extractSubtree(id);
    const node = state.nodes.find(n => n.id === id);
    tree.title = node ? node.name + " (subtree)" : "Subtree";
    navigator.clipboard.writeText(JSON.stringify(tree, null, 2)).then(() => {
      toast("Subtree copied to clipboard (" + Object.keys(tree.nodes).length + " nodes)");
    });
  }

  // --- Select all of type ---
  function selectAllOfType(type) {
    const ids = state.nodes.filter(n => n.type === type).map(n => n.id);
    Canvas.setSelectedIds(ids);
    toast(`Selected ${ids.length} ${type} node${ids.length !== 1 ? "s" : ""}`);
  }

  // --- Copy selected nodes to clipboard ---
  function copySelectedToClipboard() {
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
  function copyToClipboard() {
    const { tree } = Serialization.toJSON(state);
    tree.title = state.title;
    tree.description = state.description;
    navigator.clipboard.writeText(JSON.stringify(tree, null, 2)).then(() => toast("JSON copied to clipboard"));
  }

  function copyAsImage() {
    Canvas.exportPNGBlob().then(blob => {
      if (!blob) { toast("Nothing to copy"); return; }
      navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
        () => toast("Image copied to clipboard"),
        () => toast("Clipboard write failed — try Export PNG instead")
      );
    });
  }

  // --- Paste tree from clipboard (Ctrl+V) ---
  function pasteFromClipboard() {
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

  // --- Search / Find node (Ctrl+F) ---
  const searchDialog = document.getElementById("search-dialog");
  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");

  function openSearch() {
    searchDialog.classList.remove("hidden");
    searchInput.value = "";
    searchResults.textContent = "";
    setTimeout(() => searchInput.focus(), 0);
  }

  const searchCount = document.getElementById("search-count");
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

  // --- Find & Replace (Ctrl+H) ---
  const replaceDialog = document.getElementById("replace-dialog");
  const replaceFind = document.getElementById("replace-find");
  const replaceWith = document.getElementById("replace-with");
  const replacePreview = document.getElementById("replace-preview");

  function openReplace() {
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

  function exportEngineAdapter(engine) { Exports.engineAdapter(state, engine, toast); }
  function copyAsMermaid() { Exports.mermaid(state, toast); }
  function copyAsAscii() { Exports.ascii(state, toast); }
  function exportMarkdown() { Exports.markdown(state, toast); }

  function openCmdPalette() {
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

  // Warn before leaving with unsaved changes
  window.addEventListener("beforeunload", e => {
    if (dirty || tabs.some(t => t.dirty)) { e.preventDefault(); e.returnValue = ""; }
  });

  // --- Keyboard shortcuts ---
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;

    // Tab shortcuts
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "T") {
      e.preventDefault();
      tabAddBtn.click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "w") {
      e.preventDefault();
      closeTab(activeTabId);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "PageDown") {
      e.preventDefault();
      const idx = tabs.findIndex(t => t.id === activeTabId);
      if (idx < tabs.length - 1) switchTab(tabs[idx + 1].id);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "PageUp") {
      e.preventDefault();
      const idx = tabs.findIndex(t => t.id === activeTabId);
      if (idx > 0) switchTab(tabs[idx - 1].id);
      return;
    }

    if (e.key === "Escape" && !Replay.isActive()) {
      if (Canvas.cancelConnectMode()) return;
      if (Canvas.isIsolated()) { Canvas.exitIsolation(); Canvas.centerView(true); toast("Exited isolation"); return; }
      const anyDialogOpen = [...document.querySelectorAll(".dialog")].some(d => !d.classList.contains("hidden"));
      if (!anyDialogOpen) {
        Canvas.setSelectedIds([]);
      }
    }

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !Replay.isActive()) {
      e.preventDefault();
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const parent = state.nodes.find(n => n.id === sel[0]);
        if (parent && NodeTypes.maxChildren(parent.type) > 0 && parent.children.length < NodeTypes.maxChildren(parent.type)) {
          Canvas.addNodeAtCenter("action");
          const newSel = Canvas.getSelectedIds();
          if (newSel.length === 1) {
            setTimeout(() => { const el = document.getElementById("prop-name"); if (el) { el.focus(); el.select(); } }, 50);
          }
        } else { toast("Can't add child here"); }
      } else { Canvas.addNodeAtCenter("action"); }
    }

    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !Replay.isActive()) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const node = state.nodes.find(n => n.id === sel[0]);
        if (node && node.children.length > 0) {
          Canvas.isolateSubtree(sel[0]);
          Canvas.zoomToSubtree(sel[0]);
          toast("Isolated: " + node.name + " — Esc to exit");
        }
      }
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      Canvas.deleteSelected();
    }

    if (e.key === "F2") {
      e.preventDefault();
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const el = document.getElementById("prop-name");
        if (el) { el.focus(); el.select(); }
      } else if (sel.length > 1) {
        const prefix = prompt("Rename " + sel.length + " nodes — enter prefix:");
        if (prefix && prefix.trim()) {
          const p = prefix.trim();
          const nodes = state.nodes.filter(n => sel.includes(n.id));
          nodes.forEach((n, i) => { n.name = nodes.length > 1 ? `${p} ${i + 1}` : p; });
          onChanged();
          Properties.show(sel);
          toast("Renamed " + nodes.length + " nodes");
        }
      }
    }

    if (e.key === "Tab" && state.nodes.length > 0) {
      e.preventDefault();
      // Build depth-first order from root
      const order = [];
      const visited = new Set();
      const nodeById = {};
      for (const n of state.nodes) nodeById[n.id] = n;
      function dfs(id) {
        if (!id || visited.has(id)) return;
        visited.add(id);
        order.push(id);
        const n = nodeById[id];
        if (n) for (const cid of n.children) dfs(cid);
      }
      if (state.root) dfs(state.root);
      for (const n of state.nodes) { if (!visited.has(n.id)) { visited.add(n.id); order.push(n.id); } }

      const sel = Canvas.getSelectedIds();
      const curIdx = sel.length === 1 ? order.indexOf(sel[0]) : -1;
      const nextIdx = e.shiftKey
        ? (curIdx <= 0 ? order.length - 1 : curIdx - 1)
        : (curIdx + 1) % order.length;
      Canvas.focusNode(order[nextIdx]);
    }

    // Ctrl+Shift+Down: select all descendants
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "ArrowDown" && !Replay.isActive()) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        e.preventDefault();
        const desc = new Set([sel[0]]);
        const q = [sel[0]];
        while (q.length) {
          const cur = q.shift();
          const n = state.nodes.find(nd => nd.id === cur);
          if (n) for (const cid of n.children) { if (!desc.has(cid)) { desc.add(cid); q.push(cid); } }
        }
        Canvas.setSelectedIds([...desc]);
        toast(`Selected ${desc.size} nodes (subtree)`);
      }
    }

    // Ctrl+Arrow nudge selected nodes
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key) && !Replay.isActive()) {
      const step = 15;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      e.preventDefault();
      Canvas.nudgeSelected(dx, dy);
    }

    // Arrow key node navigation (select parent/child/sibling)
    if (e.key === "ArrowUp" && !e.ctrlKey && !e.metaKey && !Replay.isActive()) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const parent = state.nodes.find(n => n.children.includes(sel[0]));
        if (parent) { e.preventDefault(); Canvas.focusNode(parent.id); }
      }
    }
    if (e.key === "ArrowDown" && !e.ctrlKey && !e.metaKey && !Replay.isActive()) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const node = state.nodes.find(n => n.id === sel[0]);
        if (node && node.children.length > 0) { e.preventDefault(); Canvas.focusNode(node.children[0]); }
      }
    }
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.shiftKey && !e.ctrlKey && !e.metaKey && !Replay.isActive()) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const parent = state.nodes.find(n => n.children.includes(sel[0]));
        if (parent && parent.children.length > 1) {
          const idx = parent.children.indexOf(sel[0]);
          const swap = e.key === "ArrowLeft" ? idx - 1 : idx + 1;
          if (swap >= 0 && swap < parent.children.length) {
            e.preventDefault();
            [parent.children[idx], parent.children[swap]] = [parent.children[swap], parent.children[idx]];
            onChanged();
            toast(`Moved to position ${swap + 1}/${parent.children.length}`);
          }
        }
      }
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.ctrlKey && !e.metaKey && !Replay.isActive()) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const parent = state.nodes.find(n => n.children.includes(sel[0]));
        if (parent) {
          const idx = parent.children.indexOf(sel[0]);
          const next = e.key === "ArrowLeft" ? idx - 1 : idx + 1;
          if (next >= 0 && next < parent.children.length) { e.preventDefault(); Canvas.focusNode(parent.children[next]); }
        }
      }
    }

    // Replay shortcuts
    if (Replay.isActive()) {
      if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const sel = Canvas.getSelectedIds();
        if (sel.length === 1) {
          const dir = e.key === "ArrowRight" ? 1 : -1;
          const t = Replay.findStatusChange(sel[0], dir);
          Replay.setTick(t);
          updateReplayUI();
          const s = Replay.getNodeStatus(sel[0]);
          toast(`Status change: ${s || "none"} (tick ${t})`);
        } else {
          toast("Select a node to jump to its status change");
        }
        return;
      }
      if (e.key === "ArrowLeft") { e.preventDefault(); Replay.stepBack(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); Replay.stepForward(); return; }
      if (e.key === " ") { e.preventDefault(); Replay.isPlaying() ? Replay.pause() : Replay.play(); updateReplayUI(); return; }
      if (e.key === "Escape") {
        const anyDialogOpen = [...document.querySelectorAll(".dialog")].some(d => !d.classList.contains("hidden"));
        if (!anyDialogOpen) { closeReplay(); return; }
      }
      if (e.key === "h" && !e.ctrlKey && !e.metaKey) {
        const on = Canvas.toggleHeatmap();
        toast(on ? "Heatmap ON — brighter = more visited" : "Heatmap OFF");
        return;
      }
    }

    if (e.key === "Home") {
      e.preventDefault();
      const sel = Canvas.getSelectedIds();
      if (sel.length > 0) Canvas.zoomToSelection();
      else Canvas.centerView(true);
    }

    if (e.key === "p" && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const parentOf = {};
        for (const n of state.nodes) for (const cid of n.children) parentOf[cid] = n.id;
        const pathIds = new Set();
        let cur = sel[0];
        while (cur) { pathIds.add(cur); cur = parentOf[cur]; }
        const composites = state.nodes.filter(n => n.children.length > 0);
        for (const n of composites) {
          if (pathIds.has(n.id)) {
            if (Canvas.isCollapsed(n.id)) Canvas.toggleCollapse(n.id);
          } else {
            if (!Canvas.isCollapsed(n.id)) Canvas.toggleCollapse(n.id);
          }
        }
        Canvas.focusNode(sel[0]);
        toast("Showing path to " + (state.nodes.find(n => n.id === sel[0]) || {}).name);
      }
    }

    if (e.key === "b" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const on = Canvas.toggleBookmark(sel[0]);
        toast(on ? "Bookmarked" : "Bookmark removed");
      } else toast("Select one node to bookmark");
    }

    if (e.key === "B" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const marks = Canvas.getBookmarks();
      if (marks.length === 0) { toast("No bookmarks"); }
      else {
        const sel = Canvas.getSelectedIds();
        const cur = marks.indexOf(sel[0]);
        const next = marks[(cur + 1) % marks.length];
        Canvas.setSelectedIds([next]);
        Canvas.focusNode(next);
        const n = state.nodes.find(nd => nd.id === next);
        toast("Bookmark: " + (n ? n.name : next));
      }
    }

    if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const pf = document.getElementById("palette-filter");
      const pal = document.getElementById("palette");
      if (pal.style.display === "none") togglePalette();
      pf.focus();
      pf.select();
      return;
    }

    if (e.key === "g") {
      const on = Canvas.toggleSnap();
      toast(on ? "Snap to grid ON" : "Snap to grid OFF");
    }

    if (e.key === "j" && !e.ctrlKey && !e.metaKey) {
      toggleJsonPreview();
    }

    if (e.key === "?") {
      document.getElementById("help-dialog").classList.toggle("hidden");
    }

    // Shift+symbol to change selected node's type (maps to Shift+1-9)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey) {
      const shiftMap = { "!": "sequence", "@": "selector", "#": "action", "$": "condition", "%": "invert", "^": "repeat", "&": "cooldown", "*": "parallel", "(": "guard" };
      if (shiftMap[e.key]) {
        const sel = Canvas.getSelectedIds();
        if (sel.length >= 1) {
          const type = shiftMap[e.key];
          const cat = NodeTypes.categoryOf(type);
          const nodes = sel.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
          for (const n of nodes) {
            n.type = type;
            n.category = cat;
            const max = NodeTypes.maxChildren(type);
            if (n.children.length > max) n.children.length = max;
          }
          onChanged();
          Properties.show(sel);
          toast(`Changed ${nodes.length > 1 ? nodes.length + " nodes" : nodes[0].name} to ${type}`);
        }
      }
    }

    // Number keys for quick node creation (no modifier)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const quickMap = { "1": "sequence", "2": "selector", "3": "action", "4": "condition", "5": "invert", "6": "repeat", "7": "cooldown", "8": "parallel", "9": "guard" };
      if (quickMap[e.key]) {
        Canvas.addNodeAtCenter(quickMap[e.key]);
        // Immediately open inline rename for leaf nodes
        const cat = NodeTypes.categoryOf(quickMap[e.key]);
        if (cat === "leaf") {
          setTimeout(() => {
            const sel = Canvas.getSelectedIds();
            if (sel.length === 1) {
              const el = document.getElementById("prop-name");
              if (el) { el.focus(); el.select(); }
            }
          }, 50);
        }
      }
    }

    if (e.key === "n" && !e.ctrlKey && !e.metaKey) {
      const w = validateDetailed();
      if (w.length > 0) {
        if (warningsPanel.classList.contains("hidden")) showWarningsPanel();
        warningIdx = warningIdx % w.length;
        const warn = w[warningIdx];
        toast(`(${warningIdx + 1}/${w.length}) ${warn.msg}`);
        if (warn.nodeId) Canvas.focusNode(warn.nodeId);
        warningIdx = (warningIdx + 1) % w.length;
      }
    }

    if (e.key === "q" && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const n = state.nodes.find(nd => nd.id === sel[0]);
        if (n) {
          const cat = NodeTypes.categoryOf(n.type);
          const typesInCat = NodeTypes.allTypes().filter(t => NodeTypes.categoryOf(t) === cat);
          if (typesInCat.length > 1) {
            const idx = typesInCat.indexOf(n.type);
            const next = typesInCat[(idx + 1) % typesInCat.length];
            n.type = next;
            n.category = cat;
            const max = NodeTypes.maxChildren(next);
            if (n.children.length > max) n.children.length = max;
            onChanged();
            Properties.show(sel);
            toast(`→ ${next}`);
          }
        }
      }
    }

    if (e.key === "i" && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const n = state.nodes.find(nd => nd.id === sel[0]);
        if (n) {
          const parent = state.nodes.find(p => p.children.includes(n.id));
          const params = Object.entries(n.parameters);
          const lines = [`${n.name} (${n.type})`];
          if (parent) lines.push(`Parent: ${parent.name}`);
          if (n.children.length > 0) lines.push(`Children: ${n.children.length}`);
          if (params.length > 0) lines.push(params.map(([k, v]) => `${k}=${v}`).join(", "));
          if (n.comment) lines.push(`"${n.comment}"`);
          if (n.color) lines.push(`Color: ${NodeTypes.NODE_COLOR_LABELS[NodeTypes.NODE_COLORS.indexOf(n.color)] || n.color}`);
          toast(lines.join(" · "));
        }
      }
    }

    if (e.key === "f" && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length > 0) Canvas.zoomToSelection();
      else Canvas.centerView(true);
    }

    if (e.key === "r" && !e.ctrlKey && !e.metaKey) {
      Canvas.focusRoot();
    }

    if (e.key === "o" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const on = Canvas.toggleExecOrder();
      toast(on ? "Execution order ON" : "Execution order OFF");
    }

    if (e.key === "." && !e.ctrlKey && !e.metaKey) {
      const on = Canvas.toggleFlowDots();
      toast(on ? "Flow animation ON" : "Flow animation OFF");
    }

    if (e.key === "z" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const node = state.nodes.find(n => n.id === sel[0]);
        if (node && node.children.length > 0) { Canvas.zoomToSubtree(sel[0]); toast("Zoom to subtree"); }
        else toast("Select a node with children");
      } else if (sel.length > 1) { Canvas.zoomToSelection(); }
    }

    if (e.key === "=" || e.key === "+") { Canvas.zoomBy(1.2); }
    if (e.key === "-" || e.key === "_") { Canvas.zoomBy(0.8); }

    if (e.key === "c" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) { Canvas.toggleCollapse(sel[0]); }
    }

    if (e.key === "C" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const composites = state.nodes.filter(n => n.children.length > 0);
      const anyCollapsed = composites.some(n => Canvas.isCollapsed(n.id));
      for (const n of composites) {
        if (anyCollapsed && Canvas.isCollapsed(n.id)) Canvas.toggleCollapse(n.id);
        else if (!anyCollapsed) Canvas.toggleCollapse(n.id);
      }
      toast(anyCollapsed ? "All expanded" : "All collapsed");
    }

    if (e.key === "A" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const parent = state.nodes.find(n => n.children.includes(sel[0]));
        if (parent) {
          Canvas.setSelectedIds(parent.children);
          toast(`Selected ${parent.children.length} siblings`);
        }
      }
    }

    if (e.key === "s" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) { Canvas.selectSubtree(sel[0]); }
    }
    if (e.key === "S" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const n = state.nodes.find(nd => nd.id === sel[0]);
        if (n && n.children.length > 0) {
          Canvas.setSelectedIds(n.children);
          toast(`Selected ${n.children.length} children`);
        }
      }
    }

    if (e.key === "l" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      Canvas.animatedAutoLayout();
      Canvas.centerView(true);
      toast("Auto-layout applied");
    }
    if (e.key === "L" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const locked = Canvas.toggleLock();
      toast(locked ? "Positions locked — nodes can't be dragged" : "Positions unlocked");
    }

    if (e.key === "D" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const node = state.nodes.find(n => n.id === sel[0]);
        if (node && node.children.length > 0) { Canvas.copySubtreeOf(sel[0]); toast("Duplicated subtree"); }
        else if (node) { Canvas.copySelected(); toast("Duplicated node"); }
      }
    } else if (e.key === "d" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length > 0) { Canvas.copySelected(); toast("Duplicated " + sel.length + " node" + (sel.length > 1 ? "s" : "")); }
    }

    if (e.key === "w" && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const node = state.nodes.find(n => n.id === sel[0]);
        if (node) showWrapPicker(node);
      }
    }

    if (e.key === "u" && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const node = state.nodes.find(n => n.id === sel[0]);
        if (node && node.children.length === 1 && NodeTypes.categoryOf(node.type) !== "leaf") unwrapDecorator(node);
      }
    }

    if (e.key === "t" && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const node = state.nodes.find(n => n.id === sel[0]);
        if (node) showTypePicker(node);
      }
    }

    if (e.key === "e" && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        const node = state.nodes.find(n => n.id === sel[0]);
        if (node && node.children.length > 0) extractSubtreeToClipboard(sel[0]);
        else if (node) toast("Node has no subtree to extract");
      }
    }

    if (e.key === "X" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 2) {
        const a = state.nodes.find(n => n.id === sel[0]);
        const b = state.nodes.find(n => n.id === sel[1]);
        if (a && b) {
          [a.x, b.x] = [b.x, a.x];
          [a.y, b.y] = [b.y, a.y];
          onChanged();
          toast(`Swapped ${a.name} ↔ ${b.name}`);
        }
      } else {
        toast("Select exactly 2 nodes to swap");
      }
    }

    if (e.key === "P" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        Canvas.enterReparentMode(sel[0]);
        toast("Reparent mode — click new parent (Esc to cancel)");
      } else {
        toast("Select one node to reparent");
      }
    }

    if (e.key === "x" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length > 0) {
        let disconnected = 0;
        const selSet = new Set(sel);
        for (const n of state.nodes) {
          if (selSet.has(n.id)) continue;
          const before = n.children.length;
          n.children = n.children.filter(c => !selSet.has(c));
          disconnected += before - n.children.length;
        }
        if (disconnected > 0) {
          onChanged();
          toast(`Disconnected ${disconnected} connection${disconnected !== 1 ? "s" : ""}`);
        } else {
          toast("No parent connections to remove");
        }
      }
    }

    if (e.key === "k" && !e.ctrlKey && !e.metaKey) {
      const sel = Canvas.getSelectedIds();
      if (sel.length === 1) {
        if (Canvas.enterConnectMode(sel[0])) {
          toast("Click a node to connect as child (Esc to cancel)");
        } else {
          toast("This node can't have more children");
        }
      }
    }

    if (e.key === "m" && !e.ctrlKey && !e.metaKey) {
      const mc = document.getElementById("minimap-container");
      mc.style.display = mc.style.display === "none" ? "" : "none";
      toast(mc.style.display === "none" ? "Minimap hidden" : "Minimap visible");
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); History.undo(); }
      if (e.key === "z" && e.shiftKey) { e.preventDefault(); History.redo(); }
      if (e.key === "y") { e.preventDefault(); History.redo(); }
      if (e.key === "s" && e.shiftKey) {
        e.preventDefault();
        document.getElementById("save-filename").value = "";
        document.getElementById("save-dialog").classList.remove("hidden");
        setTimeout(() => document.getElementById("save-filename").focus(), 0);
      } else if (e.key === "s") {
        e.preventDefault();
        if (fileHandle) {
          // Re-save silently to the known file handle
          (async () => {
            try {
              const { tree, layout } = Serialization.toJSON(state);
              tree.title = state.title;
              tree.description = state.description;
              const writable = await fileHandle.createWritable();
              await writable.write(JSON.stringify({ tree, layout }, null, 2) + "\n");
              await writable.close();
              setDirty(false);
              toast("Saved");
            } catch (err) {
              if (err.name !== "AbortError") toast("Save failed: " + err.message);
            }
          })();
        } else {
          document.getElementById("btn-save").click();
        }
      }
      if (e.key === "d" && !e.shiftKey) { e.preventDefault(); const sel = Canvas.getSelectedIds(); if (sel.length > 0) { Canvas.copySelected(); toast("Duplicated " + sel.length + " node" + (sel.length > 1 ? "s" : "")); } }
      if (e.key === "a" && e.shiftKey) {
        e.preventDefault();
        const sel = Canvas.getSelectedIds();
        if (sel.length === 1) {
          const node = state.nodes.find(n => n.id === sel[0]);
          if (node) { selectAllOfType(node.type); return; }
        }
      }
      if (e.key === "a" && !e.shiftKey) { e.preventDefault(); Canvas.setSelectedIds(state.nodes.map(n => n.id)); }
      if (e.key === "0") { e.preventDefault(); Canvas.centerView(true); }
      if (e.key === "1") { e.preventDefault(); Canvas.zoomToSelection(); }
      if (e.key === "e" && e.shiftKey) {
        e.preventDefault();
        const sel = Canvas.getSelectedIds();
        if (sel.length === 1) {
          const { tree } = Canvas.extractSubtree(sel[0]);
          const node = state.nodes.find(n => n.id === sel[0]);
          tree.title = node ? node.name : "Subtree";
          tree.exportedAt = new Date().toISOString();
          tree.editor = "BehaviorTreeEditor";
          tree.nodeCount = Object.keys(tree.nodes).length;
          const name = tree.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "") || "subtree";
          const blob = new Blob([JSON.stringify(tree, null, 2) + "\n"], { type: "application/json" });
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + ".bt.json"; a.click(); URL.revokeObjectURL(a.href);
          toast("Exported subtree: " + name);
        } else {
          toast("Select one node to export its subtree");
        }
      } else if (e.key === "e" && !e.shiftKey) { e.preventDefault(); exportJSON(); }
      if (e.key === "f") { e.preventDefault(); openSearch(); }
      if (e.key === "h") { e.preventDefault(); openReplace(); }
      if (e.key === "p") { e.preventDefault(); openCmdPalette(); }
      if (e.key === "c" && e.shiftKey) {
        e.preventDefault();
        const sel = Canvas.getSelectedIds();
        if (sel.length === 1) {
          const path = [];
          let cur = sel[0];
          const visited = new Set();
          while (cur && !visited.has(cur)) {
            visited.add(cur);
            const n = state.nodes.find(nd => nd.id === cur);
            if (!n) break;
            path.unshift(n.name);
            const parent = state.nodes.find(p => p.children.includes(cur));
            cur = parent ? parent.id : null;
          }
          const pathStr = path.join(" > ");
          navigator.clipboard.writeText(pathStr).then(() => toast("Copied path: " + pathStr));
        } else if (sel.length > 0) { copySelectedToClipboard(); }
        else { copyToClipboard(); }
      }
      if (e.key === "v" && !e.shiftKey) { e.preventDefault(); pasteFromClipboard(); }
      if (e.key === "o" && !e.shiftKey) { e.preventDefault(); importFromFile(); }
      if (e.key === "o" && e.shiftKey) { e.preventDefault(); toggleOutline(); }
      if (e.key === "k" && e.shiftKey) { e.preventDefault(); toggleBBViewer(); }
      if (e.key === "i" && e.shiftKey) { e.preventDefault(); showStats(); }
      if (e.key === "g" && e.shiftKey) { e.preventDefault(); groupIntoSequence(); }
      if (e.key === "l" && e.shiftKey) { e.preventDefault(); const s = Canvas.cycleConnectionStyle(); toast("Connections: " + s); }
      if (e.key === "d" && e.shiftKey) {
        e.preventDefault();
        const sel = Canvas.getSelectedIds();
        const nodes = sel.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
        if (nodes.length > 0) {
          const anyEnabled = nodes.some(n => !n.disabled);
          for (const n of nodes) n.disabled = anyEnabled;
          onChanged();
          toast(anyEnabled ? "Disabled" : "Enabled");
        }
      }
      if (e.key === "n" && !e.shiftKey) { e.preventDefault(); document.getElementById("btn-new").click(); }
      if (e.key === "b") { e.preventDefault(); togglePalette(); }
      if (e.key === "\\") { e.preventDefault(); toggleProperties(); }
      if (e.key === "/") {
        e.preventDefault();
        const sel = Canvas.getSelectedIds();
        if (sel.length >= 1) {
          const nodes = sel.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
          const current = nodes[0].comment || "";
          const input = prompt(sel.length > 1 ? `Comment for ${sel.length} nodes:` : "Comment:", current);
          if (input !== null) {
            for (const n of nodes) n.comment = input;
            onChanged();
            Properties.show(sel);
            toast(input ? "Comment set" : "Comment cleared");
          }
        }
      }
      if (e.key === "g") {
        e.preventDefault();
        const sel = Canvas.getSelectedIds();
        if (sel.length > 0) {
          const selNodes = sel.map(id => state.nodes.find(n => n.id === id)).filter(Boolean);
          const cur = NodeTypes.NODE_COLORS.indexOf(selNodes[0].color || null);
          const next = (cur + 1) % NodeTypes.NODE_COLORS.length;
          const c = NodeTypes.NODE_COLORS[next];
          for (const n of selNodes) n.color = c;
          onChanged();
          toast(c ? NodeTypes.NODE_COLOR_LABELS[next] : "Default color");
        }
      }
    }
  });

  canvas.addEventListener("contextmenu", e => e.preventDefault());

  // --- File drag-and-drop import ---
  const dropOverlay = document.getElementById("drop-overlay");
  let dragCounter = 0;

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
          const data = JSON.parse(reader.result);

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
                try { loadTree(JSON.parse(lr.result)); } catch { loadTree(null); }
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

  const autoSaveIndicator = document.getElementById("autosave-indicator");

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

  setInterval(() => {
    if (!lastAutoSaveTs) return;
    const ago = Math.floor((Date.now() - lastAutoSaveTs) / 1000);
    if (ago < 10) autoSaveIndicator.textContent = "saved just now";
    else if (ago < 60) autoSaveIndicator.textContent = `saved ${ago}s ago`;
    else autoSaveIndicator.textContent = `saved ${Math.floor(ago / 60)}m ago`;
  }, 10000);

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

  setInterval(backupSnapshot, 60000);

  async function restoreFromBackup() {
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
  initResizer("resizer-left", "palette", "left");
  initResizer("resizer-right", "properties", "right");

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
