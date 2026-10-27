import { NodeTypes } from './nodes.js';
import { Serialization } from './serialization.js';
import { Canvas } from './canvas.js';
import { Properties } from './properties.js';

/** Context menu module — extracted from app.js */
export const ContextMenus = (() => {
  let _ctxMenu, _state, _cb;

  function init({ ctxMenu, state, callbacks }) {
    _ctxMenu = ctxMenu;
    _state = state;
    _cb = callbacks;
  }

  function renderCtxItems(items) {
    for (const item of items) {
      if (item.sep) {
        const div = document.createElement("div");
        div.className = "ctx-sep";
        _ctxMenu.appendChild(div);
        continue;
      }
      const div = document.createElement("div");
      div.className = "ctx-item" + (item.danger ? " danger" : "");
      if (item.hint) {
        div.style.display = "flex";
        div.style.justifyContent = "space-between";
        div.style.alignItems = "center";
        const label = document.createElement("span");
        label.textContent = item.label;
        const hint = document.createElement("span");
        hint.textContent = item.hint;
        hint.style.cssText = "font-size:10px;color:#666;margin-left:16px;";
        div.append(label, hint);
      } else {
        div.textContent = item.label;
      }
      if (item.disabled) { div.style.opacity = "0.4"; div.style.pointerEvents = "none"; }
      else div.addEventListener("click", () => { _ctxMenu.classList.add("hidden"); item.action(); });
      _ctxMenu.appendChild(div);
    }
  }

  function positionCtxMenu(cx, cy) {
    _ctxMenu.classList.remove("hidden");
    const mw = _ctxMenu.offsetWidth, mh = _ctxMenu.offsetHeight;
    _ctxMenu.style.left = Math.min(cx, window.innerWidth - mw - 8) + "px";
    _ctxMenu.style.top = Math.min(cy, window.innerHeight - mh - 8) + "px";
  }

  function showContextMenu(node, cx, cy) {
    _ctxMenu.textContent = "";
    const sel = Canvas.getSelectedIds();
    const multiSel = sel.length > 1 && sel.includes(node.id);

    let items;
    if (multiSel) {
      items = [
        { label: `${sel.length} nodes selected`, disabled: true },
        { label: "Duplicate All", action: () => Canvas.copySelected() },
        { label: "Group into Sequence", hint: "Ctrl+Shift+G", action: () => _cb.groupIntoSequence() },
        { sep: true },
        { label: "Align Left", action: () => Canvas.alignSelected("left") },
        { label: "Align Center", action: () => Canvas.alignSelected("center-h") },
        { label: "Align Top", action: () => Canvas.alignSelected("top") },
        { label: "Distribute H", action: () => Canvas.alignSelected("distribute-h") },
        { label: "Distribute V", action: () => Canvas.alignSelected("distribute-v") },
        { sep: true },
        { label: "Invert Selection", action: () => { const inv = _state.nodes.filter(n => !sel.includes(n.id)).map(n => n.id); Canvas.setSelectedIds(inv); _cb.toast(`Selected ${inv.length} nodes`); }},
        { label: "Disconnect from Parents", action: () => {
          const selSet = new Set(sel);
          for (const n of _state.nodes) {
            if (!selSet.has(n.id)) {
              const before = n.children.length;
              n.children = n.children.filter(c => !selSet.has(c));
              if (n.children.length < before) _cb.onChanged();
            }
          }
          _cb.toast("Disconnected from parents");
        }},
        { label: (() => { const nodes = sel.map(id => _state.nodes.find(n => n.id === id)).filter(Boolean); return nodes.some(n => !n.disabled) ? "Disable All" : "Enable All"; })(),
          action: () => { const nodes = sel.map(id => _state.nodes.find(n => n.id === id)).filter(Boolean); const anyEnabled = nodes.some(n => !n.disabled); for (const n of nodes) n.disabled = anyEnabled; _cb.onChanged(); _cb.toast(anyEnabled ? "Disabled" : "Enabled"); }},
        { label: "Delete All", action: () => Canvas.deleteSelected(), danger: true },
      ];
    } else {
      const isRoot = _state.root === node.id;
      const hasChildren = node.children.length > 0;
      items = [
        { label: "Rename", hint: "F2", action: () => { Canvas.focusNode(node.id); setTimeout(() => { const el = document.getElementById("prop-name"); if (el) { el.focus(); el.select(); } }, 0); }},
        { label: isRoot ? "Root node" : "Set as Root", action: () => { _state.root = node.id; _cb.onChanged(); }, disabled: isRoot },
        { label: "Duplicate", hint: "D", action: () => { Canvas.setSelectedIds([node.id]); Canvas.copySelected(); }},
      ];
      if (hasChildren) {
        const collapsed = Canvas.isCollapsed(node.id);
        items.push({ label: collapsed ? "Expand Subtree" : "Collapse Subtree", hint: "C", action: () => Canvas.toggleCollapse(node.id) });
        items.push({ label: "Select Subtree", hint: "S", action: () => Canvas.selectSubtree(node.id) });
        items.push({ label: "Duplicate Subtree", hint: "Shift+D", action: () => Canvas.copySubtreeOf(node.id) });
        items.push({ label: "Extract Subtree to Clipboard", hint: "E", action: () => _cb.extractSubtreeToClipboard(node.id) });
        items.push({ label: "Save Subtree as Template…", action: () => _cb.saveAsTemplate(node.id) });
        items.push({ label: "Zoom to Subtree", hint: "Z", action: () => Canvas.zoomToSubtree(node.id) });
        items.push({ label: "Isolate Subtree", hint: "Enter", action: () => { Canvas.isolateSubtree(node.id); Canvas.zoomToSubtree(node.id); _cb.toast("Isolated: " + node.name); } });
        items.push({ label: "Open Subtree in New Tab", action: () => {
          const { tree, layout } = Canvas.extractSubtree(node.id);
          tree.title = node.name;
          const id = _cb.createTab(node.name);
          const tab = _cb.tabs().find(t => t.id === id);
          if (tab) { tab.tree = tree; tab.layout = layout; }
          _cb.switchTab(id);
          _cb.renderTabs();
          _cb.toast("Subtree opened in new tab");
        }});
      }
      items.push({ label: "Reparent…", hint: "Shift+P", action: () => { Canvas.enterReparentMode(node.id); _cb.toast("Click new parent"); } });
      const parentNode = _state.nodes.find(n => n.children.includes(node.id));
      if (parentNode) {
        items.push({ label: "Disconnect from Parent", action: () => {
          parentNode.children = parentNode.children.filter(c => c !== node.id);
          _cb.onChanged();
        }});
      }
      const sameTypeCount = _state.nodes.filter(n => n.type === node.type).length;
      if (sameTypeCount > 1) {
        items.push({ label: `Select All ${node.type} (${sameTypeCount})`, action: () => _cb.selectAllOfType(node.type) });
      }
      if (node.children.length === 1 && NodeTypes.categoryOf(node.type) !== "leaf") {
        const label = NodeTypes.categoryOf(node.type) === "decorator" ? "Unwrap (remove decorator)" : "Flatten (remove wrapper)";
        items.push({ label, hint: "U", action: () => _cb.unwrapDecorator(node) });
      }
      if (node.children.length > 1 && NodeTypes.categoryOf(node.type) === "composite" && _state.nodes.some(n => n.children.includes(node.id))) {
        items.push({ label: "Flatten into parent", action: () => _cb.flattenComposite(node) });
      }
      items.push({ sep: true });
      items.push({ label: "Change Type...", hint: "T", action: () => showTypePicker(node) });
      items.push({ sep: true });
      items.push({ label: "Wrap in Invert", action: () => _cb.wrapInDecorator(node, "invert") });
      items.push({ label: "Wrap in Repeat", action: () => _cb.wrapInDecorator(node, "repeat") });
      items.push({ label: "Wrap in Cooldown", action: () => _cb.wrapInDecorator(node, "cooldown") });
      items.push({ label: "Wrap in Timeout", action: () => _cb.wrapInDecorator(node, "timeout") });
      items.push({ label: "Wrap in Guard", action: () => _cb.wrapInDecorator(node, "guard") });
      items.push({ sep: true });
      items.push({ label: node.disabled ? "Enable" : "Disable", hint: "Ctrl+Shift+D", action: () => { node.disabled = !node.disabled; _cb.onChanged(); _cb.toast(node.disabled ? "Disabled" : "Enabled"); } });
      items.push({ label: Canvas.isBookmarked(node.id) ? "Remove Bookmark" : "Bookmark", hint: "B", action: () => { const on = Canvas.toggleBookmark(node.id); _cb.toast(on ? "Bookmarked" : "Bookmark removed"); } });
      items.push({ label: "Delete", hint: "Del", action: () => { Canvas.setSelectedIds([node.id]); Canvas.deleteSelected(); }, danger: true });
    }

    renderCtxItems(items);
    positionCtxMenu(cx, cy);
  }

  function showConnectionContextMenu(conn, cx, cy) {
    _ctxMenu.textContent = "";
    const parent = _state.nodes.find(n => n.id === conn.parentId);
    const child = _state.nodes.find(n => n.id === conn.childId);
    const parentName = parent ? parent.name : conn.parentId;
    const childName = child ? child.name : conn.childId;

    function insertDecorator(type) {
      if (!parent || !child) return;
      const wrapper = {
        id: Serialization.uid(), type, category: "decorator",
        name: type.charAt(0).toUpperCase() + type.slice(1),
        children: [conn.childId],
        parameters: NodeTypes.defaultParams(type),
        x: child.x, y: child.y - 40,
      };
      const idx = parent.children.indexOf(conn.childId);
      if (idx >= 0) parent.children[idx] = wrapper.id;
      _state.nodes.push(wrapper);
      Canvas.notifyChanged();
      _cb.onChanged();
      Canvas.animatedAutoLayout();
      _cb.toast("Inserted " + type);
    }

    const items = [
      { label: `${parentName} → ${childName}`, disabled: true },
      { sep: true },
      { label: "Select Parent", action: () => Canvas.focusNode(conn.parentId) },
      { label: "Select Child", action: () => Canvas.focusNode(conn.childId) },
      { sep: true },
      { label: "Insert Invert", action: () => insertDecorator("invert") },
      { label: "Insert Repeat", action: () => insertDecorator("repeat") },
      { label: "Insert Cooldown", action: () => insertDecorator("cooldown") },
      { label: "Insert Timeout", action: () => insertDecorator("timeout") },
      { label: "Insert Guard", action: () => insertDecorator("guard") },
      { sep: true },
      { label: "Delete Connection", action: () => {
        if (parent) {
          const idx = parent.children.indexOf(conn.childId);
          if (idx >= 0) parent.children.splice(idx, 1);
          _cb.onChanged();
        }
      }, danger: true },
    ];

    renderCtxItems(items);
    positionCtxMenu(cx, cy);
  }

  function showQuickCreate(parentId, wx, wy, cx, cy) {
    _ctxMenu.textContent = "";
    const header = document.createElement("div");
    header.className = "ctx-item";
    header.style.opacity = "0.4";
    header.style.pointerEvents = "none";
    header.textContent = "Create & connect child";
    _ctxMenu.appendChild(header);
    const sep = document.createElement("div");
    sep.className = "ctx-sep";
    _ctxMenu.appendChild(sep);
    const types = [
      { label: "→ Sequence", type: "sequence" },
      { label: "? Selector", type: "selector" },
      { label: "▶ Action", type: "action" },
      { label: "✔ Condition", type: "condition" },
      { label: "! Invert", type: "invert" },
      { label: "↻ Repeat", type: "repeat" },
      { label: "⏱ Cooldown", type: "cooldown" },
      { label: "⛨ Guard", type: "guard" },
    ];
    for (const nt of types) {
      const div = document.createElement("div");
      div.className = "ctx-item";
      div.textContent = nt.label;
      div.addEventListener("click", () => {
        _ctxMenu.classList.add("hidden");
        const node = Canvas.addNodeAt(nt.type, wx, wy);
        if (node) {
          const parent = _state.nodes.find(n => n.id === parentId);
          if (parent && parent.children.length < NodeTypes.maxChildren(parent.type)) {
            parent.children.push(node.id);
            _cb.onChanged();
          }
        }
      });
      _ctxMenu.appendChild(div);
    }
    _ctxMenu.style.left = cx + "px";
    _ctxMenu.style.top = cy + "px";
    _ctxMenu.classList.remove("hidden");
    requestAnimationFrame(() => {
      const rect = _ctxMenu.getBoundingClientRect();
      if (rect.right > window.innerWidth) _ctxMenu.style.left = (cx - rect.width) + "px";
      if (rect.bottom > window.innerHeight) _ctxMenu.style.top = (cy - rect.height) + "px";
    });
  }

  function showCanvasContextMenu(wx, wy, cx, cy) {
    _ctxMenu.textContent = "";
    const nodeTypes = [
      { label: "→ Sequence", type: "sequence" },
      { label: "? Selector", type: "selector" },
      { label: "∥ Parallel", type: "parallel" },
      { label: "▶ Action", type: "action" },
      { label: "✔ Condition", type: "condition" },
      { sep: true },
      { label: "! Invert", type: "invert" },
      { label: "↻ Repeat", type: "repeat" },
      { label: "⏱ Cooldown", type: "cooldown" },
      { label: "⏰ Timeout", type: "timeout" },
      { label: "⛨ Guard", type: "guard" },
    ];
    const header = document.createElement("div");
    header.className = "ctx-item";
    header.style.opacity = "0.4";
    header.style.pointerEvents = "none";
    header.textContent = "Add node";
    _ctxMenu.appendChild(header);
    const sep = document.createElement("div");
    sep.className = "ctx-sep";
    _ctxMenu.appendChild(sep);
    for (const nt of nodeTypes) {
      if (nt.sep) { const s = document.createElement("div"); s.className = "ctx-sep"; _ctxMenu.appendChild(s); continue; }
      const div = document.createElement("div");
      div.className = "ctx-item";
      div.textContent = nt.label;
      div.addEventListener("click", () => {
        _ctxMenu.classList.add("hidden");
        Canvas.addNodeAt(nt.type, wx, wy);
      });
      _ctxMenu.appendChild(div);
    }
    const sep2 = document.createElement("div");
    sep2.className = "ctx-sep";
    _ctxMenu.appendChild(sep2);
    const paste = document.createElement("div");
    paste.className = "ctx-item";
    paste.textContent = "Paste from Clipboard";
    paste.addEventListener("click", () => { _ctxMenu.classList.add("hidden"); _cb.pasteFromClipboard(); });
    _ctxMenu.appendChild(paste);
    const tmplSep = document.createElement("div");
    tmplSep.className = "ctx-sep";
    _ctxMenu.appendChild(tmplSep);
    for (const [key, label] of [["check-then-act", "📋 Check → Act"], ["try-fallback", "📋 Try / Fallback"], ["cooldown-action", "📋 Cooldown Act"]]) {
      const div = document.createElement("div");
      div.className = "ctx-item";
      div.textContent = label;
      div.addEventListener("click", () => {
        _ctxMenu.classList.add("hidden");
        const nodes = _cb.TEMPLATES[key]();
        for (const n of nodes) { n.x += wx; n.y += wy; }
        _state.nodes.push(...nodes);
        if (_state.nodes.length === nodes.length) _state.root = nodes[0].id;
        Canvas.notifyChanged();
        Canvas.triggerSpawn(nodes.map(n => n.id));
        Canvas.setSelectedIds(nodes.map(n => n.id));
        _cb.onChanged();
      });
      _ctxMenu.appendChild(div);
    }
    const sep3 = document.createElement("div");
    sep3.className = "ctx-sep";
    _ctxMenu.appendChild(sep3);
    const ai = document.createElement("div");
    ai.className = "ctx-item";
    ai.textContent = "✨ AI Generate";
    ai.addEventListener("click", () => { _ctxMenu.classList.add("hidden"); _cb.openAI(); });
    _ctxMenu.appendChild(ai);

    if (_state.nodes.length > 0) {
      const sep4 = document.createElement("div");
      sep4.className = "ctx-sep";
      _ctxMenu.appendChild(sep4);
      for (const [label, action] of [
        ["Select All", () => Canvas.setSelectedIds(_state.nodes.map(n => n.id))],
        ["Fit View", () => Canvas.centerView(true)],
        ["Auto-Layout", () => { Canvas.animatedAutoLayout(); Canvas.centerView(true); }],
        ["Copy as Image", () => _cb.copyAsImage()],
      ]) {
        const div = document.createElement("div");
        div.className = "ctx-item";
        div.textContent = label;
        div.addEventListener("click", () => { _ctxMenu.classList.add("hidden"); action(); });
        _ctxMenu.appendChild(div);
      }
    }

    _ctxMenu.classList.remove("hidden");
    const cmw = _ctxMenu.offsetWidth, cmh = _ctxMenu.offsetHeight;
    _ctxMenu.style.left = Math.min(cx, window.innerWidth - cmw - 8) + "px";
    _ctxMenu.style.top = Math.min(cy, window.innerHeight - cmh - 8) + "px";
  }

  function showTypePicker(node) {
    _ctxMenu.textContent = "";
    const types = NodeTypes.allTypes().filter(t => t !== node.type);
    for (const t of types) {
      const div = document.createElement("div");
      div.className = "ctx-item";
      div.style.cssText = "display:flex;flex-direction:column;gap:1px;";
      const label = document.createElement("span");
      label.textContent = `${NodeTypes.ICONS[t] || ""} ${t.charAt(0).toUpperCase() + t.slice(1)}`;
      div.appendChild(label);
      if (NodeTypes.DESCRIPTIONS[t]) {
        const desc = document.createElement("span");
        desc.textContent = NodeTypes.DESCRIPTIONS[t];
        desc.style.cssText = "font-size:9px;opacity:0.45;";
        div.appendChild(desc);
      }
      div.addEventListener("click", () => {
        _ctxMenu.classList.add("hidden");
        node.type = t;
        node.category = NodeTypes.categoryOf(t);
        const max = NodeTypes.maxChildren(t);
        if (node.children.length > max) node.children.length = max;
        _cb.onChanged();
        Properties.show(Canvas.getSelectedIds());
        _cb.toast(`Changed to ${t}`);
      });
      _ctxMenu.appendChild(div);
    }
    _ctxMenu.classList.remove("hidden");
    _ctxMenu.style.left = Math.min(window.innerWidth / 2, window.innerWidth - 200) + "px";
    _ctxMenu.style.top = Math.min(window.innerHeight / 2, window.innerHeight - 300) + "px";
  }

  function showWrapPicker(node) {
    _ctxMenu.textContent = "";
    const decorators = ["invert", "repeat", "cooldown", "timeout", "guard"];
    for (const d of decorators) {
      const div = document.createElement("div");
      div.className = "ctx-item";
      div.textContent = `${NodeTypes.ICONS[d] || ""} ${d.charAt(0).toUpperCase() + d.slice(1)}`;
      div.addEventListener("click", () => { _ctxMenu.classList.add("hidden"); _cb.wrapInDecorator(node, d); });
      _ctxMenu.appendChild(div);
    }
    _ctxMenu.classList.remove("hidden");
    _ctxMenu.style.left = Math.min(window.innerWidth / 2, window.innerWidth - 200) + "px";
    _ctxMenu.style.top = Math.min(window.innerHeight / 2, window.innerHeight - 200) + "px";
  }

  return { init, renderCtxItems, positionCtxMenu, showContextMenu, showConnectionContextMenu, showCanvasContextMenu, showQuickCreate, showTypePicker, showWrapPicker };
})();
