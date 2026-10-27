import { NodeTypes } from './nodes.js';
import { Replay } from './replay.js';

/** Property panel — shows/edits selected node. */
export const Properties = (() => {
  let container;
  let state = null;
  let onChanged = null;

  function init(el, editorState, callbacks) {
    container = el;
    state = editorState;
    onChanged = callbacks.onChanged;
  }

  function show(selectedIds) {
    if (selectedIds.length !== 1) {
      if (selectedIds.length > 1) {
        const selNodes = state.nodes.filter(n => selectedIds.includes(n.id));
        const types = {};
        for (const n of selNodes) types[n.type] = (types[n.type] || 0) + 1;
        const breakdown = Object.entries(types).map(([t, c]) => `${c} ${t}`).join(", ");
        let html = `<p class="hint" style="font-style:normal;"><strong>${selectedIds.length}</strong> nodes selected</p>
          <p style="font-size:11px;color:#666;margin-top:6px;">${breakdown}</p>`;
        // Batch color
        html += `<label style="margin-top:12px; font-weight:bold; font-size:12px; color:#a0a0c0;">Batch Color</label>`;
        html += `<div id="batch-color" style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;">`;
        for (let i = 0; i < NodeTypes.NODE_COLORS.length; i++) {
          const col = NodeTypes.NODE_COLORS[i];
          const bg = col || (document.body.classList.contains("light") ? "#d0d6e2" : "#0f3460");
          html += `<div class="color-swatch" data-idx="${i}" title="${NodeTypes.NODE_COLOR_LABELS[i]}" style="width:20px;height:20px;border-radius:4px;background:${bg};cursor:pointer;border:2px solid transparent;transition:border-color 0.1s;"></div>`;
        }
        html += `</div>`;

        // Batch rename
        html += `<label style="margin-top:14px; font-weight:bold; font-size:12px; color:#a0a0c0;">Batch Rename</label>`;
        html += `<div style="display:flex;gap:4px;margin-top:4px;">`;
        html += `<input type="text" id="batch-prefix" placeholder="prefix..." spellcheck="false" style="flex:1;font-size:11px;">`;
        html += `<input type="text" id="batch-suffix" placeholder="suffix..." spellcheck="false" style="flex:1;font-size:11px;">`;
        html += `<button id="batch-rename-go" style="padding:4px 8px;font-size:11px;background:#0f3460;color:#53a8b6;border:1px solid #53a8b644;border-radius:3px;cursor:pointer;">Apply</button>`;
        html += `</div>`;

        // Batch disable
        const disabledCount = selNodes.filter(n => n.disabled).length;
        const allDisabled = disabledCount === selNodes.length;
        html += `<label style="margin-top:12px;"><input type="checkbox" id="batch-disabled" ${allDisabled ? "checked" : ""} ${disabledCount > 0 && !allDisabled ? 'style="opacity:0.5"' : ""}> Disabled${disabledCount > 0 && !allDisabled ? ` (${disabledCount}/${selNodes.length})` : ""}</label>`;

        // Bulk parameter editing when all selected share the same type
        const uniqueTypes = Object.keys(types);
        if (uniqueTypes.length === 1) {
          const sharedType = uniqueTypes[0];
          const sharedParams = NodeTypes.suggestedParams(sharedType);
          const currentParams = Object.keys(selNodes[0].parameters);
          const allParams = [...new Set([...currentParams, ...sharedParams])];
          if (allParams.length > 0) {
            html += `<label style="margin-top:14px; font-weight:bold; font-size:12px; color:#a0a0c0;">Batch Parameters (${sharedType})</label>`;
            for (const key of allParams) {
              const vals = selNodes.map(n => n.parameters[key]);
              const allSame = vals.every(v => JSON.stringify(v) === JSON.stringify(vals[0]));
              const display = allSame && vals[0] != null ? String(vals[0]) : "";
              const placeholder = allSame ? (vals[0] == null ? "not set" : "") : "mixed";
              html += `<div class="param-row"><input type="text" class="batch-param-key" value="${esc(key)}" disabled style="opacity:0.6;flex:1;"><input type="text" class="batch-param-val" data-key="${esc(key)}" value="${esc(display)}" placeholder="${placeholder}" spellcheck="false" style="flex:1;"></div>`;
            }
          }
        }

        container.innerHTML = html;
        const batchDisabledEl = container.querySelector("#batch-disabled");
        if (batchDisabledEl) {
          batchDisabledEl.addEventListener("change", () => {
            for (const n of selNodes) n.disabled = batchDisabledEl.checked;
            if (onChanged) onChanged();
            show(selectedIds);
          });
        }

        container.querySelectorAll("#batch-color .color-swatch").forEach(el => {
          el.addEventListener("click", () => {
            const idx = parseInt(el.dataset.idx);
            const c = NodeTypes.NODE_COLORS[idx];
            for (const n of selNodes) { if (c) n.color = c; else delete n.color; }
            if (onChanged) onChanged();
            show(selectedIds);
          });
        });

        const batchRenameBtn = container.querySelector("#batch-rename-go");
        if (batchRenameBtn) {
          batchRenameBtn.addEventListener("click", () => {
            const prefix = container.querySelector("#batch-prefix").value;
            const suffix = container.querySelector("#batch-suffix").value;
            if (!prefix && !suffix) return;
            for (const n of selNodes) n.name = prefix + n.name + suffix;
            if (onChanged) onChanged();
            show(selectedIds);
          });
        }

        container.querySelectorAll(".batch-param-val").forEach(input => {
          input.addEventListener("change", () => {
            const key = input.dataset.key;
            const val = parseVal(input.value);
            for (const n of selNodes) {
              if (input.value === "") delete n.parameters[key];
              else n.parameters[key] = val;
            }
            if (onChanged) onChanged();
          });
        });
      } else {
        // Show tree-level info when nothing selected
        const composites = state.nodes.filter(n => NodeTypes.categoryOf(n.type) === "composite").length;
        const decorators = state.nodes.filter(n => NodeTypes.categoryOf(n.type) === "decorator").length;
        const leaves = state.nodes.filter(n => NodeTypes.categoryOf(n.type) === "leaf").length;
        const childSet = new Set();
        for (const n of state.nodes) n.children.forEach(c => childSet.add(c));
        const orphans = state.nodes.filter(n => n.id !== state.root && !childSet.has(n.id)).length;
        const depth = calcDepth(state.root);
        let connections = 0;
        for (const n of state.nodes) connections += n.children.length;
        let maxBreadth = 0;
        const byDepth = {};
        const bVis = new Set();
        function walkBreadth(id, d) {
          if (!id || bVis.has(id)) return;
          bVis.add(id);
          byDepth[d] = (byDepth[d] || 0) + 1;
          const nd = state.nodes.find(n => n.id === id);
          if (nd) for (const cid of nd.children) walkBreadth(cid, d + 1);
        }
        if (state.root) walkBreadth(state.root, 0);
        for (const d in byDepth) maxBreadth = Math.max(maxBreadth, byDepth[d]);

        container.innerHTML = `
          <label>Description
            <textarea id="prop-desc" rows="3" spellcheck="false" class="prop-textarea">${esc(state.description || "")}</textarea>
          </label>
          <div style="font-size:11px;color:#666;margin-top:10px;line-height:1.8;">
            <span style="color:#888;font-weight:600;">${state.nodes.length}</span> nodes · <span style="color:#53a8b6;">${connections}</span> connections · ${state.nodes.length <= 10 ? "simple" : state.nodes.length <= 30 ? "moderate" : "complex"}<br>
            <span style="color:#95d5b2;">${composites}</span> composites ·
            <span style="color:#e09f3e;">${decorators}</span> decorators ·
            <span style="color:#c77dff;">${leaves}</span> leaves<br>
            Depth: <span style="color:#888;font-weight:600;">${depth}</span> · Max breadth: <span style="color:#888;font-weight:600;">${maxBreadth}</span>${orphans > 0 ? `<br><span style="color:#ff6b6b;">${orphans} orphan${orphans > 1 ? "s" : ""}</span>` : ""}
          </div>
          <p style="font-size:11px;color:#555;margin-top:6px;">Root: ${state.root ? esc((state.nodes.find(n => n.id === state.root) || {}).name || state.root) : "none"}</p>
          ${(() => {
            const keys = new Set();
            for (const n of state.nodes) { if (n.parameters.key) keys.add(n.parameters.key); }
            return keys.size > 0 ? `<div style="margin-top:10px;"><label style="font-weight:bold;font-size:12px;color:#a0a0c0;">Blackboard Keys</label><div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px;">${[...keys].map(k => `<span class="bb-key-tag" style="font-size:10px;padding:2px 6px;border-radius:8px;">${esc(k)}</span>`).join("")}</div></div>` : "";
          })()}
          ${(() => {
            if (!state.root || state.nodes.length < 2) return "";
            const nb = {};
            function wbr(id, d) { nb[d] = (nb[d] || 0) + 1; const nd = state.nodes.find(n => n.id === id); if (nd) for (const cid of nd.children) wbr(cid, d + 1); }
            wbr(state.root, 0);
            const maxB = Math.max(1, ...Object.values(nb));
            let bars = "";
            for (const [d, c] of Object.entries(nb).sort((a, b) => a[0] - b[0])) {
              const pct = Math.round(c / maxB * 100);
              bars += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;"><span style="width:16px;text-align:right;font-size:10px;color:#666;">d${d}</span><div style="height:10px;width:${pct}%;background:linear-gradient(90deg,#53a8b6,#53a8b644);border-radius:3px;min-width:4px;"></div><span style="font-size:10px;color:#888;">${c}</span></div>`;
            }
            return `<div style="margin-top:10px;"><label style="font-weight:bold;font-size:12px;color:#a0a0c0;">Shape</label><div style="margin-top:4px;">${bars}</div></div>`;
          })()}
          ${(() => {
            const actions = state.nodes.filter(n => n.type === "action").map(n => n.name);
            const conditions = state.nodes.filter(n => n.type === "condition").map(n => n.name);
            let html = "";
            if (actions.length > 0) {
              html += `<div style="margin-top:10px;"><label style="font-weight:bold;font-size:12px;color:#a0a0c0;">Actions (${actions.length})</label><div style="margin-top:4px;font-size:10px;color:#c77dff;line-height:1.6;">${[...new Set(actions)].sort().map(a => esc(a)).join(" · ")}</div></div>`;
            }
            if (conditions.length > 0) {
              html += `<div style="margin-top:8px;"><label style="font-weight:bold;font-size:12px;color:#a0a0c0;">Conditions (${conditions.length})</label><div style="margin-top:4px;font-size:10px;color:#c77dff;line-height:1.6;">${[...new Set(conditions)].sort().map(c => esc(c)).join(" · ")}</div></div>`;
            }
            return html;
          })()}
        `;
        const descEl = container.querySelector("#prop-desc");
        if (descEl) {
          descEl.addEventListener("input", () => { state.description = descEl.value; });
          descEl.addEventListener("change", () => { if (onChanged) onChanged(); });
        }
      }
      return;
    }

    const node = state.nodes.find(n => n.id === selectedIds[0]);
    if (!node) { container.innerHTML = '<p class="hint">Select a node to edit</p>'; return; }

    // During replay, show node debug info
    if (typeof Replay !== "undefined" && Replay.isActive()) {
      const status = Replay.getNodeStatus(node.id);
      const color = Replay.getStatusColor(node.id);
      let html = `<label>Name</label><p style="font-size:14px;font-weight:600;margin:2px 0 8px;">${esc(node.name)}</p>`;
      html += `<label>Type</label><p style="font-size:12px;color:#888;margin:2px 0 8px;">${node.type} (${node.category})</p>`;
      html += `<label>Status</label><p style="font-size:14px;font-weight:700;margin:2px 0 8px;color:${color || '#555'};">${status || "not executed"}</p>`;
      html += `<label>Tick</label><p style="font-size:12px;color:#888;margin:2px 0 12px;">${Replay.getCurrentTick()} / ${Replay.getTickCount() - 1}</p>`;

      // Status timeline sparkline
      const data = Replay.getData();
      if (data) {
        const statusColors = Replay.STATUS_COLORS;
        html += `<label>Timeline</label><div class="status-timeline">`;
        const total = data.ticks.length;
        for (let i = 0; i < total; i++) {
          const frame = data.ticks[i];
          const ns = frame.nodes[node.id];
          const c = ns ? statusColors[ns.status] || "#333" : "#222";
          const active = i === Replay.getCurrentTick();
          html += `<div class="st-tick${active ? " st-active" : ""}" style="background:${c}" data-tick="${i}" title="Tick ${i}: ${ns ? ns.status : "skip"}"></div>`;
        }
        html += `</div>`;
      }

      container.innerHTML = html;

      container.querySelectorAll(".st-tick").forEach(el => {
        el.addEventListener("click", () => Replay.setTick(parseInt(el.dataset.tick)));
      });
      return;
    }

    const types = NodeTypes.allTypes();
    const isRoot = state.root === node.id;
    const hasParent = state.nodes.some(n => n.children.includes(node.id));

    let html = `
      <label>Name
        <input type="text" id="prop-name" value="${esc(node.name)}" spellcheck="false">
      </label>
      <label>Type
        <select id="prop-type">
          ${types.map(t => `<option value="${t}" ${t === node.type ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </label>
      <label>Category <input type="text" value="${node.category}" disabled></label>
      ${NodeTypes.DESCRIPTIONS[node.type] ? `<p style="font-size:11px;color:#555;margin-top:4px;font-style:italic;">${NodeTypes.DESCRIPTIONS[node.type]}</p>` : ""}
      <label>ID <input type="text" value="${node.id}" disabled></label>
      <label style="margin-top:10px;">
        <input type="checkbox" id="prop-root" ${isRoot ? "checked" : ""}> Root node
      </label>
      <label style="margin-top:6px;">
        <input type="checkbox" id="prop-disabled" ${node.disabled ? "checked" : ""}> Disabled
      </label>
    `;

    // Connection info
    const childCount = node.children.length;
    const maxC = NodeTypes.maxChildren(node.type);
    if (maxC > 0) {
      html += `<p style="font-size:11px;color:#666;margin-top:4px;">Children: ${childCount}${maxC < Infinity ? " / " + maxC : ""}</p>`;
    }
    if (hasParent) {
      const parent = state.nodes.find(n => n.children.includes(node.id));
      const sibIdx = parent.children.indexOf(node.id);
      const sibTotal = parent.children.length;
      const sibLabel = sibTotal > 1 ? ` · child ${sibIdx + 1} of ${sibTotal}` : "";
      html += `<p style="font-size:11px;color:#666;">Parent: ${esc(parent.name)}${sibLabel}</p>`;
    }
    // Subtree stats
    if (node.children.length > 0) {
      const subtreeCount = countDescendants(node.id);
      const subtreeDepth = calcDepth(node.id) - 1;
      html += `<p style="font-size:11px;color:#555;margin-top:2px;">Subtree: ${subtreeCount} node${subtreeCount !== 1 ? "s" : ""}, depth ${subtreeDepth}</p>`;
    }

    // Child order (for composites with 2+ children)
    if (node.children.length > 1) {
      html += `<label style="margin-top:14px; font-weight:bold; font-size:12px; color:#a0a0c0;">Children Order</label>`;
      html += `<div class="child-order">`;
      for (let i = 0; i < node.children.length; i++) {
        const child = state.nodes.find(n => n.id === node.children[i]);
        const cname = child ? esc(child.name) : node.children[i];
        const cicon = child ? (NodeTypes.ICONS[child.type] || "") : "";
        html += `<div class="child-order-row" data-idx="${i}">`;
        html += `<span style="flex:1;font-size:12px;">${cicon} ${cname}</span>`;
        html += `<button class="child-up" data-idx="${i}" ${i === 0 ? "disabled" : ""} title="Move up" style="padding:2px 6px;font-size:11px;">&#9650;</button>`;
        html += `<button class="child-down" data-idx="${i}" ${i === node.children.length - 1 ? "disabled" : ""} title="Move down" style="padding:2px 6px;font-size:11px;">&#9660;</button>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    if (!isRoot) {
      html += `<button id="set-root-btn" style="margin-top:8px;background:#4a3728;color:#e09f3e;border:1px solid #e09f3e44;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:11px;width:100%;transition:background 0.1s;">Set as Root Node</button>`;
    }

    // Color picker
    html += `<label style="margin-top:14px; font-weight:bold; font-size:12px; color:#a0a0c0;">Color</label>`;
    html += `<div id="color-picker" style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;">`;
    for (let i = 0; i < NodeTypes.NODE_COLORS.length; i++) {
      const col = NodeTypes.NODE_COLORS[i];
      const active = (node.color || null) === col;
      const bg = col || (document.body.classList.contains("light") ? "#d0d6e2" : "#0f3460");
      html += `<div class="color-swatch" data-idx="${i}" title="${NodeTypes.NODE_COLOR_LABELS[i]}" style="width:20px;height:20px;border-radius:4px;background:${bg};cursor:pointer;border:2px solid ${active ? "#fff" : "transparent"};transition:border-color 0.1s;"></div>`;
    }
    html += `</div>`;

    html += `<label style="margin-top:14px; font-weight:bold; font-size:12px; color:#a0a0c0;">Parameters</label>`;

    const KNOWN_SELECTS = {
      policy: ["fail_on_one", "succeed_on_one", "succeed_on_all"],
      op: ["eq", "ne", "lt", "gt", "le", "ge"],
    };

    const params = Object.entries(node.parameters);
    for (const [key, val] of params) {
      let valInput;
      if (KNOWN_SELECTS[key]) {
        const opts = KNOWN_SELECTS[key].map(o => `<option value="${o}" ${o === String(val) ? "selected" : ""}>${o}</option>`).join("");
        valInput = `<select class="param-val">${opts}</select>`;
      } else if (typeof val === "number") {
        valInput = `<input type="number" class="param-val" value="${val}" step="any" spellcheck="false">`;
      } else if (typeof val === "boolean") {
        valInput = `<select class="param-val"><option value="true" ${val ? "selected" : ""}>true</option><option value="false" ${!val ? "selected" : ""}>false</option></select>`;
      } else {
        valInput = `<input type="text" class="param-val" value="${esc(String(val))}" placeholder="value" spellcheck="false">`;
      }
      html += `
        <div class="param-row">
          <input type="text" class="param-key" value="${esc(key)}" placeholder="key" spellcheck="false">
          ${valInput}
          <button class="param-del" data-key="${esc(key)}">×</button>
        </div>`;
    }
    html += '<button class="add-param">+ Parameter</button>';
    const suggestions = NodeTypes.suggestedParams(node.type).filter(k => !node.parameters.hasOwnProperty(k));
    if (suggestions.length > 0) {
      html += `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px;">`;
      for (const s of suggestions) {
        html += `<span class="suggest-param" data-key="${esc(s)}" style="font-size:10px;padding:2px 8px;background:#0f346033;color:#53a8b6;border:1px dashed #53a8b644;border-radius:10px;cursor:pointer;transition:background 0.1s;" title="Add '${esc(s)}' parameter">+ ${esc(s)}</span>`;
      }
      html += `</div>`;
    }

    html += `<label style="margin-top:14px; font-weight:bold; font-size:12px; color:#a0a0c0;">Comment</label>`;
    html += `<textarea id="prop-comment" rows="2" spellcheck="false" placeholder="Add a note..." class="prop-textarea">${esc(node.comment || "")}</textarea>`;

    html += `<label style="margin-top:14px; font-weight:bold; font-size:12px; color:#a0a0c0;">Description</label>`;
    html += `<textarea id="prop-description" rows="2" spellcheck="false" placeholder="What does this ${node.type} do? (exported with JSON)" class="prop-textarea" style="font-size:11px;">${esc(node.description || "")}</textarea>`;

    container.innerHTML = html;

    // --- Bind events ---

    // Name: update live as you type
    const nameInput = container.querySelector("#prop-name");
    nameInput.addEventListener("input", e => {
      node.name = e.target.value;
      if (onChanged) onChanged();
    });

    container.querySelector("#prop-type").addEventListener("change", e => {
      node.type = e.target.value;
      node.category = NodeTypes.categoryOf(node.type);
      const max = NodeTypes.maxChildren(node.type);
      if (node.children.length > max) node.children.length = max;
      if (onChanged) onChanged();
      show(selectedIds);
    });

    container.querySelector("#prop-root").addEventListener("change", e => {
      if (e.target.checked) state.root = node.id;
      if (onChanged) onChanged();
    });

    container.querySelector("#prop-disabled").addEventListener("change", e => {
      node.disabled = e.target.checked;
      if (onChanged) onChanged();
    });

    const setRootBtn = container.querySelector("#set-root-btn");
    if (setRootBtn) {
      setRootBtn.addEventListener("click", () => {
        state.root = node.id;
        if (onChanged) onChanged();
        show(selectedIds);
      });
    }

    const commentEl = container.querySelector("#prop-comment");
    if (commentEl) {
      commentEl.addEventListener("input", () => { node.comment = commentEl.value; });
      commentEl.addEventListener("change", () => { if (onChanged) onChanged(); });
    }

    const descEl = container.querySelector("#prop-description");
    if (descEl) {
      descEl.addEventListener("input", () => { node.description = descEl.value || undefined; });
      descEl.addEventListener("change", () => { if (onChanged) onChanged(); });
    }

    container.querySelectorAll(".color-swatch").forEach(el => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.dataset.idx);
        const c = NodeTypes.NODE_COLORS[idx];
        if (c) node.color = c; else delete node.color;
        if (onChanged) onChanged();
        show(selectedIds);
      });
    });

    container.querySelectorAll(".child-up").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.idx);
        if (i > 0) { [node.children[i - 1], node.children[i]] = [node.children[i], node.children[i - 1]]; }
        if (onChanged) onChanged();
        show(selectedIds);
      });
    });
    container.querySelectorAll(".child-down").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.idx);
        if (i < node.children.length - 1) { [node.children[i], node.children[i + 1]] = [node.children[i + 1], node.children[i]]; }
        if (onChanged) onChanged();
        show(selectedIds);
      });
    });

    container.querySelectorAll(".param-del").forEach(btn => {
      btn.addEventListener("click", () => {
        delete node.parameters[btn.dataset.key];
        if (onChanged) onChanged();
        show(selectedIds);
      });
    });

    container.querySelectorAll(".param-row").forEach(row => {
      const keyInput = row.querySelector(".param-key");
      const valInput = row.querySelector(".param-val");
      const origKey = keyInput.value;

      function updateParam() {
        const newKey = keyInput.value.trim();
        const newVal = parseVal(valInput.value);
        if (origKey !== newKey) delete node.parameters[origKey];
        if (newKey) node.parameters[newKey] = newVal;
        if (onChanged) onChanged();
      }
      keyInput.addEventListener("change", updateParam);
      valInput.addEventListener("change", updateParam);
      if (valInput.type === "number") valInput.addEventListener("input", updateParam);
    });

    container.querySelector(".add-param").addEventListener("click", () => {
      let key = "key";
      let i = 1;
      while (node.parameters.hasOwnProperty(key)) key = "key" + (i++);
      node.parameters[key] = "";
      if (onChanged) onChanged();
      show(selectedIds);
      setTimeout(() => {
        const rows = container.querySelectorAll(".param-key");
        const last = rows[rows.length - 1];
        if (last) { last.focus(); last.select(); }
      }, 0);
    });

    container.querySelectorAll(".suggest-param").forEach(el => {
      el.addEventListener("click", () => {
        node.parameters[el.dataset.key] = "";
        if (onChanged) onChanged();
        show(selectedIds);
      });
    });
  }

  function countDescendants(rootId) {
    const nodeById = {};
    for (const n of state.nodes) nodeById[n.id] = n;
    const visited = new Set();
    function walk(id) {
      if (!id || visited.has(id)) return 0;
      visited.add(id);
      const n = nodeById[id];
      if (!n) return 0;
      let count = 0;
      for (const cid of n.children) count += 1 + walk(cid);
      return count;
    }
    return walk(rootId);
  }

  function calcDepth(rootId) {
    const nodeById = {};
    for (const n of state.nodes) nodeById[n.id] = n;
    const visited = new Set();
    function walk(id) {
      if (!id || visited.has(id)) return 0;
      visited.add(id);
      const n = nodeById[id];
      if (!n || n.children.length === 0) return 1;
      let max = 0;
      for (const cid of n.children) max = Math.max(max, walk(cid));
      return 1 + max;
    }
    return walk(rootId);
  }

  function parseVal(s) {
    if (s === "true") return true;
    if (s === "false") return false;
    const n = Number(s);
    if (!isNaN(n) && s.trim() !== "") return n;
    return s;
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function setState(s) { state = s; }

  return { init, show, setState };
})();
