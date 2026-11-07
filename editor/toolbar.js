// @ts-check
import { NodeTypes } from './nodes.js';
import { History } from './history.js';
import { Serialization } from './serialization.js';
import { Canvas } from './canvas.js';
import { Properties } from './properties.js';
import { dirty, onChanged, pushHistory, setDirty, state, toast } from './app.js';
import { openAI } from './dialogs.js';
import { loadTreeByRef, setCurrentFilePath } from './file-io.js';

/** Toolbar buttons, node palette (drag/click-to-add, templates, filter), zoom controls, title editing, theme. */

/** Show how many nodes of each type the tree has next to each palette entry. */
export function updatePaletteCounts() {
  const counts = { composite: 0, leaf: 0, decorator: 0 };
  const typeCounts = {};
  for (const n of state.nodes) {
    counts[n.category] = (counts[n.category] || 0) + 1;
    typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
  }
  document.querySelectorAll(".palette-section").forEach(/** @param {HTMLElement} sec */ sec => {
    const text = sec.textContent.replace(/\s*\(\d+\)/, "");
    const raw = text.toLowerCase().replace(/s$/, "");
    const cat = raw === "leave" ? "leaf" : raw;
    const count = counts[cat] || 0;
    sec.textContent = count > 0 ? `${text} (${count})` : text;
  });
  document.querySelectorAll(".palette-item[data-type]").forEach(/** @param {HTMLElement} el */ el => {
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

// Zoom level display
const zoomLevelEl = document.getElementById("zoom-level");
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

// --- Palette drag ---
const dragGhost = document.createElement("canvas");

// --- Palette click-to-add ---
const shortcutMap = { sequence: "1", selector: "2", action: "3", condition: "4", invert: "5", repeat: "6", cooldown: "7", parallel: "8", guard: "9" };

// --- Template snippets ---
export const TEMPLATES = {
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

// --- User-saved subtree templates ---
function getUserTemplates() { return JSON.parse(localStorage.getItem("bt-user-templates") || "[]"); }
function setUserTemplates(list) { localStorage.setItem("bt-user-templates", JSON.stringify(list)); }

/**
 * Save the subtree under `rootId` as a reusable palette template (localStorage).
 * @param {string} rootId
 */
export function saveAsTemplate(rootId) {
  /** @type {{tree: {nodes: Record<string, any>}, layout: {nodes: Record<string, {x: number, y: number}>}}} */
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

export function togglePalette() {
  const p = document.getElementById("palette");
  const r = document.getElementById("resizer-left");
  const hidden = p.style.display === "none";
  p.style.display = hidden ? "" : "none";
  r.style.display = hidden ? "" : "none";
  toast(hidden ? "Palette visible" : "Palette hidden");
}
export function toggleProperties() {
  const p = document.getElementById("properties");
  const r = document.getElementById("resizer-right");
  const hidden = p.style.display === "none";
  p.style.display = hidden ? "" : "none";
  r.style.display = hidden ? "" : "none";
  toast(hidden ? "Properties visible" : "Properties hidden");
}
// --- Theme toggle ---
export function toggleTheme() {
  document.body.classList.toggle("light");
  const isLight = document.body.classList.contains("light");
  try { localStorage.setItem("bt-editor-theme", isLight ? "light" : "dark"); } catch {}
  toast(isLight ? "Light theme" : "Dark theme");
}

/** Wire toolbar buttons, palette drag/click-to-add, templates, filter, title editing and zoom controls. */
export function initToolbar() {
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
    const btn = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest("[data-example]"));
    if (!btn) return;
    loadTreeByRef("examples", btn.dataset.example).catch(err => toast("Load failed: " + err.message));
  });
  document.getElementById("empty-ai-btn").addEventListener("click", () => openAI());
  dragGhost.width = 120; dragGhost.height = 40;
  dragGhost.style.position = "fixed"; dragGhost.style.left = "-9999px";
  document.body.appendChild(dragGhost);

  document.querySelectorAll(".palette-item").forEach(/** @param {HTMLElement} item */ item => {
    item.addEventListener("dragstart", e => {
      e.dataTransfer.setData("node-type", item.dataset.type);
      e.dataTransfer.setData("node-category", item.dataset.category);
      const type = item.dataset.type;
      const cat = item.dataset.category;
      if (type && cat) {
        const gc = dragGhost.getContext("2d");
        const colors = NodeTypes.colors(cat);
        gc.clearRect(0, 0, 120, 40);
        gc.fillStyle = colors.fill;
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
  document.querySelectorAll(".palette-item:not(.template-item)").forEach(/** @param {HTMLElement} item */ item => {
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
  document.querySelectorAll(".template-item").forEach(/** @param {HTMLElement} item */ item => {
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
  renderUserTemplates();

  // --- Collapsible palette sections ---
  document.querySelectorAll(".palette-section").forEach(/** @param {HTMLElement} sec */ sec => {
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
        next = /** @type {HTMLElement} */ (next.nextElementSibling);
      }
    }

    sec.addEventListener("click", () => {
      setCollapsed(sec, sec.dataset.collapsed !== "1");
    });

    sec.addEventListener("dblclick", () => {
      document.querySelectorAll(".palette-section").forEach(/** @param {HTMLElement} other */ other => {
        setCollapsed(other, other !== sec);
      });
    });
  });

  // --- Palette filter ---
  document.getElementById("palette-filter").addEventListener("input", /** @param {Event & {target: HTMLInputElement}} e */ e => {
    const q = e.target.value.toLowerCase().trim();
    let anyMatch = false;
    document.querySelectorAll(".palette-item").forEach(/** @param {HTMLElement} item */ item => {
      const match = !q || (item.dataset.type && item.dataset.type.includes(q)) || item.textContent.toLowerCase().includes(q);
      item.style.display = match ? "" : "none";
      if (match) anyMatch = true;
    });
    document.querySelectorAll(".palette-section").forEach(/** @param {HTMLElement} sec */ sec => {
      let next = /** @type {HTMLElement} */ (sec.nextElementSibling);
      let anyVisible = false;
      while (next && !next.classList.contains("palette-section")) {
        if (next.style.display !== "none") anyVisible = true;
        next = /** @type {HTMLElement} */ (next.nextElementSibling);
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
  document.getElementById("palette-filter").addEventListener("keydown", /** @param {KeyboardEvent & {target: HTMLInputElement}} e */ e => {
    if (e.key === "Escape") {
      e.target.value = "";
      e.target.dispatchEvent(new Event("input"));
      e.target.blur();
    }
    if (e.key === "Enter") {
      const first = /** @type {HTMLElement} */ (document.querySelector(".palette-item:not(.template-item):not([style*='display: none'])"));
      if (first && first.dataset.type) {
        Canvas.addNodeAtCenter(first.dataset.type);
        const cat = NodeTypes.categoryOf(first.dataset.type);
        if (cat === "leaf") setTimeout(() => { const el = /** @type {HTMLInputElement} */ (document.getElementById("prop-name")); if (el) { el.focus(); el.select(); } }, 50);
        e.target.value = "";
        e.target.dispatchEvent(new Event("input"));
        e.target.blur();
      }
    }
  });
  bindTitleEdit(document.getElementById("tree-title"));
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
    setCurrentFilePath(null);
    setDirty(false);
    try { localStorage.removeItem("bt-editor-autosave"); } catch {}
  });

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
  try {
    const saved = localStorage.getItem("bt-editor-theme");
    if (saved === "light") document.body.classList.add("light");
    else if (!saved && window.matchMedia("(prefers-color-scheme: light)").matches) document.body.classList.add("light");
  } catch {}
  document.getElementById("btn-theme").addEventListener("click", toggleTheme);
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
}
