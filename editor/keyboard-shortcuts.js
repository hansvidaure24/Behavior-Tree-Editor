// @ts-check
import { NodeTypes } from './nodes.js';
import { History } from './history.js';
import { Serialization } from './serialization.js';
import { Replay } from './replay.js';
import { Canvas } from './canvas.js';
import { Properties } from './properties.js';
import { groupIntoSequence, onChanged, selectAllOfType, setDirty, showTypePicker, showWrapPicker, state, toast, unwrapDecorator, validateDetailed } from './app.js';
import { activeTabId, closeTab, switchTab, tabAddBtn, tabs } from './tab-manager.js';
import { togglePalette, toggleProperties } from './toolbar.js';
import { closeReplay, showWarningsPanel, toggleBBViewer, toggleJsonPreview, toggleOutline, updateReplayUI, warningsPanel } from './panels.js';
import { openCmdPalette, openReplace, openSearch, showStats } from './dialogs.js';
import { copySelectedToClipboard, copyToClipboard, exportJSON, extractSubtreeToClipboard, fileHandle, importFromFile, pasteFromClipboard } from './file-io.js';

/** Global keyboard shortcuts. */

let warningIdx = 0;
/** Restart warning cycling (the N shortcut) from the first warning. */
export function resetWarningIdx() { warningIdx = 0; }

export function initKeyboardShortcuts() {
  // --- Keyboard shortcuts ---
  document.addEventListener("keydown", /** @param {KeyboardEvent & {target: HTMLElement}} e */ e => {
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
            setTimeout(() => { const el = /** @type {HTMLInputElement} */ (document.getElementById("prop-name")); if (el) { el.focus(); el.select(); } }, 50);
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
        const el = /** @type {HTMLInputElement} */ (document.getElementById("prop-name"));
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
      const pf = /** @type {HTMLInputElement} */ (document.getElementById("palette-filter"));
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
              const el = /** @type {HTMLInputElement} */ (document.getElementById("prop-name"));
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
        /** @type {HTMLInputElement} */ (document.getElementById("save-filename")).value = "";
        document.getElementById("save-dialog").classList.remove("hidden");
        setTimeout(() => /** @type {HTMLInputElement} */ (document.getElementById("save-filename")).focus(), 0);
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
}
