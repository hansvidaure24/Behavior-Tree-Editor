import { NodeTypes } from './nodes.js';
import { Serialization } from './serialization.js';
import { Replay } from './replay.js';

/** Canvas renderer — pan/zoom, node rendering, connections, interaction. */
export const Canvas = (() => {
  let cvs, ctx, mmCvs, mmCtx;
  let W, H;

  // Camera
  let camX = 0, camY = 0, zoom = 1;
  let targetZoom = 1, targetCamX = 0, targetCamY = 0, animating = false;

  // Interaction state
  let dragging = null;
  let panning = false;
  let panStart = { x: 0, y: 0, camX: 0, camY: 0 };
  let panVelX = 0, panVelY = 0, lastPanX = 0, lastPanY = 0;
  let connecting = null;
  let selecting = null;
  let selectedIds = new Set();
  let connectHoverId = null;
  let hoverConnectionKey = null; // "parentId:childId"
  let hoverNodeId = null;
  let hoverTime = 0;
  const TOOLTIP_DELAY = 500;
  let spaceHeld = false;
  let snapToGrid = true;
  let collapsedIds = new Set();
  const GRID = 15;
  let snapGuides = []; // {axis:'x'|'y', pos: worldCoord}
  let shakeNode = null; // {id, start, origX, origY}
  let pulseNode = null; // {id, start} — highlight pulse after search/focus
  const spawnAnims = new Map(); // id -> startTime
  const deathAnims = new Map(); // id -> {startTime, x, y, name, type, category}
  let searchMatchIds = null; // Set of node ids matching search, or null when search inactive
  let connectMode = null; // {fromId} — keyboard-initiated connection mode
  let reparentMode = null; // {childId} — keyboard-initiated reparent mode
  let positionLocked = false;
  let connectionStyle = "bezier"; // "bezier" | "straight" | "step"
  let showExecOrder = false;
  let replayHeatmap = false;
  let showFlowDots = false;
  const bookmarks = new Set();
  let isolatedSubtree = null; // node id — when set, only this subtree is visible
  let lastDblClickType = localStorage.getItem("bt-last-dblclick-type") || "action";

  // External
  let state = null;
  let onChanged = null;
  let onSelect = null;
  let onContextMenu = null;
  let onConnectionContextMenu = null;
  let onRejectReason = () => {};
  let onCanvasContextMenu = null;
  let onConnectEmpty = null;
  let onZoomChange = null;

  let nodeById = {};
  function rebuildLookup() {
    nodeById = {};
    for (const n of state.nodes) nodeById[n.id] = n;
  }

  function init(canvas, minimap, editorState, callbacks) {
    cvs = canvas;
    ctx = cvs.getContext("2d");
    mmCvs = minimap;
    mmCtx = mmCvs.getContext("2d");
    state = editorState;
    onChanged = callbacks.onChanged;
    onSelect = callbacks.onSelect;
    onContextMenu = callbacks.onContextMenu;
    if (callbacks.onRejectReason) onRejectReason = callbacks.onRejectReason;
    if (callbacks.onConnectionContextMenu) onConnectionContextMenu = callbacks.onConnectionContextMenu;
    if (callbacks.onCanvasContextMenu) onCanvasContextMenu = callbacks.onCanvasContextMenu;
    if (callbacks.onConnectEmpty) onConnectEmpty = callbacks.onConnectEmpty;

    resize();
    window.addEventListener("resize", resize);

    cvs.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    cvs.addEventListener("wheel", onWheel, { passive: false });
    cvs.addEventListener("dblclick", onDblClick);

    window.addEventListener("keydown", e => {
      if (e.code === "Space" && e.target === document.body && !(typeof Replay !== "undefined" && Replay.isActive())) { e.preventDefault(); spaceHeld = true; }
    });
    window.addEventListener("keyup", e => { if (e.code === "Space") spaceHeld = false; });

    cvs.addEventListener("dragover", e => e.preventDefault());
    cvs.addEventListener("drop", onDrop);

    mmCvs.addEventListener("mousedown", onMinimapDown);

    // Click zoom % HUD to cycle zoom presets
    const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2];
    cvs.addEventListener("click", e => {
      const { x: sx, y: sy } = getCanvasPos(e);
      if (sx > W - 60 && sy > H - 26) {
        const cur = Math.round(zoom * 100);
        let next = 1;
        for (const p of ZOOM_PRESETS) {
          if (Math.round(p * 100) > cur) { next = p; break; }
        }
        if (cur >= Math.round(ZOOM_PRESETS[ZOOM_PRESETS.length - 1] * 100)) next = ZOOM_PRESETS[0];
        const cx = W / 2, cy = H / 2;
        targetCamX = cx - (cx - camX) * (next / zoom);
        targetCamY = cy - (cy - camY) * (next / zoom);
        targetZoom = next;
        animating = true;
      }
    });

    // Touch support
    let lastTouchDist = 0;
    let touchMode = null; // 'drag'|'pan'
    cvs.addEventListener("touchstart", e => {
      e.preventDefault();
      if (e.touches.length === 2) {
        touchMode = "pan";
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.sqrt(dx * dx + dy * dy);
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = cvs.getBoundingClientRect();
        panStart = { x: mx - rect.left, y: my - rect.top, camX, camY };
        return;
      }
      const t = e.touches[0];
      const fakeE = { clientX: t.clientX, clientY: t.clientY, button: 0, shiftKey: false, altKey: false, preventDefault() {} };
      onMouseDown(fakeE);
      touchMode = "drag";
    }, { passive: false });

    cvs.addEventListener("touchmove", e => {
      e.preventDefault();
      if (e.touches.length === 2 && touchMode === "pan") {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const factor = dist / lastTouchDist;
        lastTouchDist = dist;
        const newZoom = Math.max(0.15, Math.min(4, zoom * factor));
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = cvs.getBoundingClientRect();
        const sx = mx - rect.left, sy = my - rect.top;
        camX = sx - (sx - camX) * (newZoom / zoom);
        camY = sy - (sy - camY) * (newZoom / zoom);
        zoom = newZoom;
        if (onZoomChange) onZoomChange(zoom);
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0];
        onMouseMove({ clientX: t.clientX, clientY: t.clientY });
      }
    }, { passive: false });

    cvs.addEventListener("touchend", e => {
      e.preventDefault();
      if (touchMode === "pan" && e.touches.length < 2) { touchMode = null; panning = false; return; }
      onMouseUp({ clientX: 0, clientY: 0 });
      touchMode = null;
    }, { passive: false });

    requestAnimationFrame(loop);
  }

  function resize() {
    const rect = cvs.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    if (W <= 0 || H <= 0) return;
    cvs.width = W * devicePixelRatio;
    cvs.height = H * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function screenToWorld(sx, sy) {
    return { x: (sx - camX) / zoom, y: (sy - camY) / zoom };
  }

  function snap(v) { return snapToGrid ? Math.round(v / GRID) * GRID : v; }

  function nodeAt(wx, wy) {
    const nw = NodeTypes.NODE_W, nh = NodeTypes.NODE_H;
    for (let i = state.nodes.length - 1; i >= 0; i--) {
      const n = state.nodes[i];
      if (wx >= n.x && wx <= n.x + nw && wy >= n.y && wy <= n.y + nh) return n;
    }
    return null;
  }

  function outputPort(node) {
    return { x: node.x + NodeTypes.NODE_W / 2, y: node.y + NodeTypes.NODE_H };
  }
  function inputPort(node) {
    return { x: node.x + NodeTypes.NODE_W / 2, y: node.y };
  }
  function hitPort(wx, wy, port) {
    const dx = wx - port.x, dy = wy - port.y;
    return dx * dx + dy * dy < 196;
  }

  function getCanvasPos(e) {
    const rect = cvs.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // --- Mouse ---

  function onMouseDown(e) {
    panVelX = 0; panVelY = 0;
    const { x: sx, y: sy } = getCanvasPos(e);
    const { x: wx, y: wy } = screenToWorld(sx, sy);

    if (spaceHeld || e.button === 1) {
      panning = true;
      panStart = { x: sx, y: sy, camX, camY };
      cvs.style.cursor = "grabbing";
      return;
    }

    if (e.button === 2) {
      const hitConn = findConnectionAt(wx, wy);
      if (hitConn) {
        if (onConnectionContextMenu) {
          onConnectionContextMenu(hitConn, e.clientX, e.clientY);
        }
        return;
      }
      const hitNode = nodeAt(wx, wy);
      if (hitNode && onContextMenu) {
        if (!selectedIds.has(hitNode.id)) {
          selectedIds.clear();
          selectedIds.add(hitNode.id);
        }
        if (onSelect) onSelect([...selectedIds]);
        onContextMenu(hitNode, e.clientX, e.clientY);
        return;
      }
      if (onCanvasContextMenu) {
        onCanvasContextMenu(wx, wy, e.clientX, e.clientY);
        return;
      }
      panning = true;
      panStart = { x: sx, y: sy, camX, camY };
      cvs.style.cursor = "grabbing";
      return;
    }

    for (const n of state.nodes) {
      if (NodeTypes.maxChildren(n.type) > 0 && hitPort(wx, wy, outputPort(n))) {
        connecting = { fromId: n.id, x: wx, y: wy };
        cvs.style.cursor = "crosshair";
        return;
      }
    }

    for (const n of state.nodes) {
      if (hitPort(wx, wy, inputPort(n))) {
        const parent = state.nodes.find(p => p.children.includes(n.id));
        if (parent) {
          parent.children = parent.children.filter(c => c !== n.id);
          connecting = { fromId: parent.id, x: wx, y: wy };
          cvs.style.cursor = "crosshair";
          return;
        }
      }
    }

    // Left-click on hovered connection → open connection context menu
    if (hoverConnectionKey && e.button === 0) {
      const hitConn = findConnectionAt(wx, wy);
      if (hitConn && onConnectionContextMenu) {
        onConnectionContextMenu(hitConn, e.clientX, e.clientY);
        return;
      }
    }

    const hit = nodeAt(wx, wy);
    if (hit && connectMode) {
      const parent = nodeById[connectMode.fromId];
      if (parent && hit.id !== connectMode.fromId &&
          !parent.children.includes(hit.id) &&
          parent.children.length < NodeTypes.maxChildren(parent.type) &&
          !wouldCycle(hit.id, connectMode.fromId)) {
        for (const p of state.nodes) {
          const idx = p.children.indexOf(hit.id);
          if (idx >= 0) p.children.splice(idx, 1);
        }
        parent.children.push(hit.id);
        if (onChanged) onChanged();
        // Stay in connect mode if parent can still accept children
        if (parent.children.length < NodeTypes.maxChildren(parent.type)) {
          onRejectReason("Connected! Click another target or Esc");
          return;
        }
        onRejectReason("");
      } else if (parent) {
        shakeNode = { id: hit.id, start: performance.now(), origX: hit.x, origY: hit.y };
        if (parent.children.includes(hit.id)) onRejectReason("Already connected");
        else if (wouldCycle(hit.id, connectMode.fromId)) onRejectReason("Would create a cycle");
        else onRejectReason("Cannot connect");
        return; // stay in connect mode on failure too
      }
      connectMode = null;
      cvs.style.cursor = "default";
      return;
    }
    if (hit && reparentMode) {
      const child = nodeById[reparentMode.childId];
      if (child && hit.id !== reparentMode.childId &&
          NodeTypes.maxChildren(hit.type) > 0 &&
          hit.children.length < NodeTypes.maxChildren(hit.type) &&
          !hit.children.includes(reparentMode.childId) &&
          !wouldCycle(reparentMode.childId, hit.id)) {
        for (const p of state.nodes) {
          const idx = p.children.indexOf(reparentMode.childId);
          if (idx >= 0) p.children.splice(idx, 1);
        }
        hit.children.push(reparentMode.childId);
        if (onChanged) onChanged();
        onRejectReason("Reparented to " + hit.name);
      } else if (child) {
        shakeNode = { id: hit.id, start: performance.now(), origX: hit.x, origY: hit.y };
        if (hit.id === reparentMode.childId) onRejectReason("Can't parent to itself");
        else if (wouldCycle(reparentMode.childId, hit.id)) onRejectReason("Would create a cycle");
        else onRejectReason("Can't connect there");
        return;
      }
      reparentMode = null;
      cvs.style.cursor = "default";
      return;
    }
    if (hit) {
      if (e.altKey && state.root) {
        // Alt+click: select path from root to this node
        const parentOf = {};
        for (const n of state.nodes) for (const cid of n.children) parentOf[cid] = n.id;
        const path = [];
        let cur = hit.id;
        while (cur) { path.push(cur); cur = parentOf[cur]; }
        selectedIds.clear();
        for (const id of path) selectedIds.add(id);
        if (onSelect) onSelect([...selectedIds]);
        onRejectReason(path.length + " nodes in path");
        return;
      }
      if (e.shiftKey || (e.ctrlKey && !e.metaKey) || (e.metaKey && !e.ctrlKey)) {
        if (selectedIds.has(hit.id)) selectedIds.delete(hit.id);
        else selectedIds.add(hit.id);
      } else if (!selectedIds.has(hit.id)) {
        selectedIds.clear();
        selectedIds.add(hit.id);
      }
      if (!positionLocked) {
        dragging = { node: hit, offX: wx - hit.x, offY: wy - hit.y, startPositions: {} };
        for (const id of selectedIds) {
          const n = nodeById[id];
          if (n) dragging.startPositions[id] = { x: n.x, y: n.y };
        }
        cvs.style.cursor = "grabbing";
      } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        shakeNode = { id: hit.id, start: performance.now(), origX: hit.x, origY: hit.y };
        if (onRejectReason) onRejectReason("Locked — Shift+L to unlock");
      }
      if (onSelect) onSelect([...selectedIds]);
    } else {
      if (e.altKey) {
        panning = true;
        panStart = { x: sx, y: sy, camX, camY };
        cvs.style.cursor = "grabbing";
      } else {
        const shiftBox = e.shiftKey;
        if (!shiftBox) { selectedIds.clear(); if (onSelect) onSelect([]); }
        selecting = { x: wx, y: wy, x2: wx, y2: wy, subtract: shiftBox };
      }
    }
  }

  function onMouseMove(e) {
    const { x: sx, y: sy } = getCanvasPos(e);
    const { x: wx, y: wy } = screenToWorld(sx, sy);

    if (panning) {
      const newCX = panStart.camX + (sx - panStart.x);
      const newCY = panStart.camY + (sy - panStart.y);
      panVelX = (newCX - camX) * 0.5 + panVelX * 0.5;
      panVelY = (newCY - camY) * 0.5 + panVelY * 0.5;
      camX = newCX;
      camY = newCY;
      return;
    }

    if (connecting) {
      connecting.x = wx;
      connecting.y = wy;
      const target = state.nodes.find(n =>
        n.id !== connecting.fromId &&
        (hitPort(wx, wy, inputPort(n)) || nodeAt(wx, wy) === n)
      );
      connectHoverId = target ? target.id : null;
      cvs.style.cursor = target ? "crosshair" : "default";
      return;
    }

    if (dragging) {
      // Edge-pan when dragging near canvas borders
      const edgeMargin = 40, edgeSpeed = 8;
      if (sx < edgeMargin) camX += edgeSpeed;
      else if (sx > W - edgeMargin) camX -= edgeSpeed;
      if (sy < edgeMargin) camY += edgeSpeed;
      else if (sy > H - edgeMargin) camY -= edgeSpeed;

      const { x: wx2, y: wy2 } = screenToWorld(sx, sy);
      const dx = wx2 - dragging.node.x - dragging.offX;
      const dy = wy2 - dragging.node.y - dragging.offY;
      for (const id of selectedIds) {
        const n = nodeById[id];
        if (n) {
          n.x = snap(n.x + dx);
          n.y = snap(n.y + dy);
        }
      }
      // Compute snap guides
      snapGuides = [];
      const nw = NodeTypes.NODE_W, nh = NodeTypes.NODE_H;
      const threshold = 4;
      const primary = dragging.node;
      const pCx = primary.x + nw / 2, pCy = primary.y + nh / 2;
      const pRx = primary.x + nw, pBy = primary.y + nh;
      for (const n of state.nodes) {
        if (selectedIds.has(n.id)) continue;
        const cx = n.x + nw / 2, cy = n.y + nh / 2;
        const rx = n.x + nw, by = n.y + nh;
        if (Math.abs(pCx - cx) < threshold) snapGuides.push({ axis: "x", pos: cx });
        if (Math.abs(primary.x - n.x) < threshold) snapGuides.push({ axis: "x", pos: n.x + nw / 2 });
        if (Math.abs(pRx - rx) < threshold) snapGuides.push({ axis: "x", pos: rx - nw / 2 });
        if (Math.abs(primary.x - rx) < threshold) snapGuides.push({ axis: "x", pos: rx });
        if (Math.abs(pRx - n.x) < threshold) snapGuides.push({ axis: "x", pos: n.x });
        if (Math.abs(pCy - cy) < threshold) snapGuides.push({ axis: "y", pos: cy });
        if (Math.abs(primary.y - n.y) < threshold) snapGuides.push({ axis: "y", pos: n.y + nh / 2 });
        if (Math.abs(pBy - by) < threshold) snapGuides.push({ axis: "y", pos: by - nh / 2 });
        if (Math.abs(primary.y - by) < threshold) snapGuides.push({ axis: "y", pos: by });
        if (Math.abs(pBy - n.y) < threshold) snapGuides.push({ axis: "y", pos: n.y });
      }
      return;
    }

    if (selecting) {
      selecting.x2 = wx;
      selecting.y2 = wy;
      return;
    }

    // Idle hover
    if (spaceHeld) { cvs.style.cursor = "grab"; return; }

    // Connection hover highlight
    hoverConnectionKey = null;
    const hitConn = findConnectionAt(wx, wy);
    if (hitConn) {
      hoverConnectionKey = hitConn.parentId + ":" + hitConn.childId;
      cvs.style.cursor = "pointer";
      return;
    }

    for (const n of state.nodes) {
      if (hitPort(wx, wy, inputPort(n)) || (NodeTypes.maxChildren(n.type) > 0 && hitPort(wx, wy, outputPort(n)))) {
        cvs.style.cursor = "crosshair";
        hoverNodeId = null;
        return;
      }
    }
    const hovNode = nodeAt(wx, wy);
    if (hovNode) {
      if (hoverNodeId !== hovNode.id) { hoverNodeId = hovNode.id; hoverTime = performance.now(); }
      cvs.style.cursor = "grab";
    } else {
      hoverNodeId = null;
      cvs.style.cursor = "default";
    }
  }

  function onMouseUp(e) {
    if (connecting) {
      const { x: sx, y: sy } = getCanvasPos(e);
      const { x: wx, y: wy } = screenToWorld(sx, sy);
      const target = state.nodes.find(n =>
        n.id !== connecting.fromId &&
        (hitPort(wx, wy, inputPort(n)) || nodeAt(wx, wy) === n)
      );
      if (target) {
        const parent = nodeById[connecting.fromId];
        const canConnect = parent && !parent.children.includes(target.id) &&
            parent.children.length < NodeTypes.maxChildren(parent.type) &&
            !wouldCycle(target.id, connecting.fromId);
        if (canConnect) {
          for (const p of state.nodes) {
            const idx = p.children.indexOf(target.id);
            if (idx >= 0) p.children.splice(idx, 1);
          }
          parent.children.push(target.id);
          if (onChanged) onChanged();
        } else {
          shakeNode = { id: target.id, start: performance.now(), origX: target.x, origY: target.y };
          if (parent && parent.children.includes(target.id)) onRejectReason("Already connected");
          else if (parent && parent.children.length >= NodeTypes.maxChildren(parent.type)) onRejectReason("Max children reached (" + NodeTypes.maxChildren(parent.type) + ")");
          else if (wouldCycle(target.id, connecting.fromId)) onRejectReason("Would create a cycle");
          else onRejectReason("Cannot connect");
        }
      } else {
        const parent = nodeById[connecting.fromId];
        if (parent && parent.children.length < NodeTypes.maxChildren(parent.type) && onConnectEmpty) {
          onConnectEmpty(connecting.fromId, wx, wy, e.clientX, e.clientY);
        }
      }
      connecting = null;
      connectHoverId = null;
      cvs.style.cursor = "default";
      return;
    }

    if (dragging) {
      let moved = false;
      for (const id of selectedIds) {
        const sp = dragging.startPositions[id];
        const n = nodeById[id];
        if (sp && n && (n.x !== sp.x || n.y !== sp.y)) { moved = true; break; }
      }
      // Auto-connect: if single node dragged near an output port, reparent
      if (moved && selectedIds.size === 1) {
        const draggedId = [...selectedIds][0];
        const draggedNode = nodeById[draggedId];
        if (draggedNode) {
          const inp = inputPort(draggedNode);
          for (const n of state.nodes) {
            if (n.id === draggedId || n.children.includes(draggedId)) continue;
            if (NodeTypes.maxChildren(n.type) <= 0 || n.children.length >= NodeTypes.maxChildren(n.type)) continue;
            const out = outputPort(n);
            const dx = inp.x - out.x, dy = inp.y - out.y;
            if (Math.abs(dx) < 30 && dy > 0 && dy < 50 && !wouldCycle(draggedId, n.id)) {
              // Remove from old parent
              for (const p of state.nodes) {
                const idx = p.children.indexOf(draggedId);
                if (idx >= 0) p.children.splice(idx, 1);
              }
              n.children.push(draggedId);
              break;
            }
          }
        }
      }
      if (moved && onChanged) onChanged();
      dragging = null;
      snapGuides = [];
      cvs.style.cursor = "grab";
      return;
    }

    if (selecting) {
      const x1 = Math.min(selecting.x, selecting.x2);
      const y1 = Math.min(selecting.y, selecting.y2);
      const x2 = Math.max(selecting.x, selecting.x2);
      const y2 = Math.max(selecting.y, selecting.y2);
      const nw = NodeTypes.NODE_W, nh = NodeTypes.NODE_H;
      const before = selectedIds.size;
      for (const n of state.nodes) {
        if (n.x + nw > x1 && n.x < x2 && n.y + nh > y1 && n.y < y2) {
          if (selecting.subtract) selectedIds.delete(n.id);
          else selectedIds.add(n.id);
        }
      }
      const sub = selecting.subtract;
      selecting = null;
      if (!sub && selectedIds.size > 1 && selectedIds.size > before) {
        onRejectReason(selectedIds.size + " nodes selected");
      } else if (sub && selectedIds.size < before) {
        onRejectReason(selectedIds.size + " nodes selected");
      }
      if (onSelect) onSelect([...selectedIds]);
      return;
    }

    panning = false;
    cvs.style.cursor = spaceHeld ? "grab" : "default";
  }

  function wouldCycle(childId, parentId) {
    const visited = new Set();
    function walk(id) {
      if (id === parentId) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      const n = nodeById[id];
      return n ? n.children.some(walk) : false;
    }
    return walk(childId);
  }

  function findConnectionAt(wx, wy) {
    const threshold = 10;
    for (const node of state.nodes) {
      const out = outputPort(node);
      for (const cid of node.children) {
        const child = nodeById[cid];
        if (!child) continue;
        const inp = inputPort(child);
        if (distToBezier(wx, wy, out.x, out.y, inp.x, inp.y) < threshold) {
          return { parentId: node.id, childId: cid };
        }
      }
    }
    return null;
  }

  function distToBezier(px, py, x1, y1, x2, y2) {
    const cp = Math.abs(y2 - y1) * 0.5 + 20;
    let minD = Infinity;
    for (let t = 0; t <= 1; t += 0.04) {
      const it = 1 - t;
      const cy1 = y1 + cp, cy2 = y2 - cp;
      const bx = it*it*it*x1 + 3*it*it*t*x1 + 3*it*t*t*x2 + t*t*t*x2;
      const by = it*it*it*y1 + 3*it*it*t*cy1 + 3*it*t*t*cy2 + t*t*t*y2;
      const dx = px - bx, dy = py - by;
      minD = Math.min(minD, Math.sqrt(dx*dx + dy*dy));
    }
    return minD;
  }

  function onWheel(e) {
    e.preventDefault();
    const { x: sx, y: sy } = getCanvasPos(e);

    if (e.ctrlKey || e.metaKey) {
      // Pinch-to-zoom (trackpad) or Ctrl+scroll (mouse) → zoom at cursor
      const factor = 1 - e.deltaY * 0.01;
      const newZoom = Math.max(0.15, Math.min(4, zoom * factor));
      camX = sx - (sx - camX) * (newZoom / zoom);
      camY = sy - (sy - camY) * (newZoom / zoom);
      zoom = newZoom;
      if (onZoomChange) onZoomChange(zoom);
      targetZoom = newZoom; targetCamX = camX; targetCamY = camY;
    } else {
      // Scroll / two-finger swipe → pan
      camX -= e.deltaX;
      camY -= e.deltaY;
    }
  }

  let lastDblClick = 0;
  function onDblClick(e) {
    if (typeof Replay !== "undefined" && Replay.isActive()) return;
    const now = performance.now();
    if (now - lastDblClick < 400) return;
    lastDblClick = now;
    const { x: sx, y: sy } = getCanvasPos(e);
    const { x: wx, y: wy } = screenToWorld(sx, sy);

    // Double-click output port to collapse/expand subtree
    for (const n of state.nodes) {
      if (NodeTypes.maxChildren(n.type) > 0 && n.children.length > 0 && hitPort(wx, wy, outputPort(n))) {
        toggleCollapse(n.id);
        return;
      }
    }

    // Double-click on connection → open connection context menu
    const hitConn = findConnectionAt(wx, wy);
    if (hitConn && onConnectionContextMenu) {
      onConnectionContextMenu(hitConn, e.clientX, e.clientY);
      return;
    }

    const hit = nodeAt(wx, wy);
    if (hit) {
      selectedIds.clear();
      selectedIds.add(hit.id);
      if (onSelect) onSelect([hit.id]);
      showInlineRename(hit);
    } else {
      const dblType = lastDblClickType || "action";
      const dblCat = NodeTypes.categoryOf(dblType);
      const node = {
        id: Serialization.uid(),
        type: dblType,
        category: dblCat,
        name: dblType.charAt(0).toUpperCase() + dblType.slice(1),
        children: [],
        parameters: NodeTypes.defaultParams(dblType),
        x: snap(wx - NodeTypes.NODE_W / 2),
        y: snap(wy - NodeTypes.NODE_H / 2),
      };
      state.nodes.push(node);
      rebuildLookup();
      if (state.nodes.length === 1) state.root = node.id;
      spawnAnims.set(node.id, performance.now());

      // Auto-connect: if exactly one node was selected and it can have children, connect
      const prevSel = [...selectedIds];
      if (prevSel.length === 1) {
        const parent = nodeById[prevSel[0]];
        if (parent && NodeTypes.maxChildren(parent.type) > 0 && parent.children.length < NodeTypes.maxChildren(parent.type)) {
          parent.children.push(node.id);
        }
      }

      selectedIds.clear();
      selectedIds.add(node.id);
      if (onSelect) onSelect([node.id]);
      if (onChanged) onChanged();
      showInlineRename(node);
    }
  }

  function showInlineRename(node) {
    const nw = NodeTypes.NODE_W;
    const sx = node.x * zoom + camX;
    const sy = (node.y + 10) * zoom + camY;
    const sw = nw * zoom;
    const input = document.createElement("input");
    input.type = "text";
    input.value = node.name;
    input.style.cssText = `position:fixed;left:${sx}px;top:${sy}px;width:${sw}px;padding:2px 6px;font:600 ${Math.max(11, 13 * zoom)}px -apple-system,sans-serif;text-align:center;background:${isLight() ? "#fff" : "#1a1a2e"};color:${isLight() ? "#333" : "#e0e0e0"};border:2px solid #53a8b6;border-radius:4px;outline:none;z-index:500;box-shadow:0 2px 12px rgba(0,0,0,0.3);`;
    document.body.appendChild(input);
    input.focus();
    input.select();
    function commit() {
      const v = input.value.trim();
      if (v && v !== node.name) {
        node.name = v;
        if (onChanged) onChanged();
        if (onSelect) onSelect([...selectedIds]);
      }
      input.remove();
    }
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") { input.value = node.name; input.blur(); }
    });
  }

  function onDrop(e) {
    e.preventDefault();
    const type = e.dataTransfer.getData("node-type");
    if (!type) return;
    const category = NodeTypes.categoryOf(type);

    const { x: sx, y: sy } = getCanvasPos(e);
    const { x: wx, y: wy } = screenToWorld(sx, sy);

    const node = {
      id: Serialization.uid(),
      type, category,
      name: type.charAt(0).toUpperCase() + type.slice(1),
      children: [],
      parameters: NodeTypes.defaultParams(type),
      x: snap(wx - NodeTypes.NODE_W / 2),
      y: snap(wy - NodeTypes.NODE_H / 2),
    };
    state.nodes.push(node);
    rebuildLookup();
    if (state.nodes.length === 1) state.root = node.id;
    spawnAnims.set(node.id, performance.now());

    // Splice: if dropped onto an existing connection, insert between parent and child
    let spliced = false;
    if (NodeTypes.maxChildren(node.type) > 0) {
      const hitConn = findConnectionAt(wx, wy);
      if (hitConn) {
        const parent = nodeById[hitConn.parentId];
        if (parent) {
          const idx = parent.children.indexOf(hitConn.childId);
          if (idx >= 0) {
            parent.children[idx] = node.id;
            node.children.push(hitConn.childId);
            spliced = true;
          }
        }
      }
    }

    // Auto-connect: if dropped near a node's output port, connect as child
    if (!spliced) {
      for (const n of state.nodes) {
        if (n.id === node.id) continue;
        if (NodeTypes.maxChildren(n.type) > 0 && n.children.length < NodeTypes.maxChildren(n.type)) {
          const out = outputPort(n);
          const dx = (node.x + NodeTypes.NODE_W / 2) - out.x;
          const dy = node.y - out.y;
          if (Math.abs(dx) < NodeTypes.NODE_W * 1.2 && dy > 0 && dy < 120) {
            n.children.push(node.id);
            break;
          }
        }
      }
    }

    selectedIds.clear();
    selectedIds.add(node.id);
    if (onSelect) onSelect([node.id]);
    if (onChanged) onChanged();
  }

  // --- Rendering ---

  let mmFrame = 0;

  function loop() {
    // Smooth camera animation
    if (animating) {
      const ease = 0.15;
      camX += (targetCamX - camX) * ease;
      camY += (targetCamY - camY) * ease;
      const prevZoom = zoom;
      zoom += (targetZoom - zoom) * ease;
      if (Math.abs(camX - targetCamX) < 0.5 && Math.abs(camY - targetCamY) < 0.5 && Math.abs(zoom - targetZoom) < 0.001) {
        camX = targetCamX; camY = targetCamY; zoom = targetZoom;
        animating = false;
      }
      if (onZoomChange && zoom !== prevZoom) onZoomChange(zoom);
    }

    // Pan momentum
    if (!panning && (Math.abs(panVelX) > 0.1 || Math.abs(panVelY) > 0.1)) {
      camX += panVelX;
      camY += panVelY;
      panVelX *= 0.92;
      panVelY *= 0.92;
    }

    // Layout animation
    if (layoutAnim) {
      const t = Math.min(1, (performance.now() - layoutAnim.start) / layoutAnim.dur);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      for (const n of state.nodes) {
        const a = layoutAnim.before[n.id], b = layoutAnim.after[n.id];
        if (!a || !b) continue;
        n.x = a.x + (b.x - a.x) * ease;
        n.y = a.y + (b.y - a.y) * ease;
      }
      if (t >= 1) layoutAnim = null;
    }

    draw();
    if (++mmFrame % 3 === 0) drawMinimap();
    requestAnimationFrame(loop);
  }

  function isLight() { return document.body.classList.contains("light"); }

  function draw() {
    ctx.save();
    ctx.fillStyle = isLight() ? "#f0f2f5" : "#1a1a2e";
    ctx.fillRect(0, 0, W, H);
    drawGrid();
    ctx.translate(camX, camY);
    ctx.scale(zoom, zoom);

    // Precompute which nodes have parents (O(n) per frame instead of O(n²))
    const hasParent = new Set();
    for (const n of state.nodes) for (const cid of n.children) hasParent.add(cid);

    // Empty canvas hint
    if (state.nodes.length === 0) {
      ctx.save();
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      const lt = isLight();

      // Tree icon with gentle pulse
      const pulse = 0.97 + 0.03 * Math.sin(performance.now() / 800);
      ctx.save();
      ctx.translate(W / 2, H / 2 - 60);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = lt ? "#00000012" : "#ffffff0a";
      ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lt ? "#28a745" : "#95d5b2";
      ctx.beginPath(); ctx.arc(0, -15, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lt ? "#d68910" : "#e09f3e";
      ctx.beginPath(); ctx.arc(-18, 10, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = lt ? "#8e44ad" : "#c77dff";
      ctx.beginPath(); ctx.arc(18, 10, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = lt ? "#00000020" : "#ffffff15";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(-18, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(18, 4); ctx.stroke();
      ctx.restore();

      ctx.fillStyle = lt ? "#00000035" : "#ffffff20";
      ctx.font = "600 18px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Create your behavior tree", W / 2, H / 2 + 10);
      ctx.font = "13px -apple-system, sans-serif";
      ctx.fillStyle = lt ? "#00000020" : "#ffffff12";
      ctx.fillText("Drag from palette  ·  Double-click to create  ·  Drop a .bt.json file", W / 2, H / 2 + 35);
      ctx.fillText("Press 1-9 for quick add  ·  / to search palette  ·  Right-click for menu", W / 2, H / 2 + 55);
      ctx.fillText("Ctrl+P command palette  ·  ✨ AI Generate  ·  ? for all shortcuts", W / 2, H / 2 + 75);
      ctx.restore();
    }

    // Viewport bounds for culling
    const _nw = NodeTypes.NODE_W, _nh = NodeTypes.NODE_H;
    const vL = -camX / zoom - _nw, vT = -camY / zoom - _nh;
    const vR = (W - camX) / zoom + _nw, vB = (H - camY) / zoom + _nh;

    // Dot grid when snap is active and zoomed in enough
    if (snapToGrid && zoom > 0.6 && state.nodes.length > 0) {
      const step = GRID * 4;
      const dotAlpha = Math.min(0.25, (zoom - 0.6) * 0.5);
      ctx.fillStyle = isLight() ? `rgba(0,0,0,${dotAlpha})` : `rgba(255,255,255,${dotAlpha * 0.6})`;
      const gL = Math.floor(vL / step) * step, gT = Math.floor(vT / step) * step;
      for (let gx = gL; gx < vR; gx += step) {
        for (let gy = gT; gy < vB; gy += step) {
          ctx.fillRect(gx - 0.5, gy - 0.5, 1, 1);
        }
      }
    }

    // Color group regions
    if (zoom > 0.3) {
      const colorGroups = {};
      for (const n of state.nodes) {
        if (n.color) {
          if (!colorGroups[n.color]) colorGroups[n.color] = [];
          colorGroups[n.color].push(n);
        }
      }
      const gPad = 20;
      for (const [color, nodes] of Object.entries(colorGroups)) {
        if (nodes.length < 2) continue;
        let gx1 = Infinity, gy1 = Infinity, gx2 = -Infinity, gy2 = -Infinity;
        for (const n of nodes) {
          gx1 = Math.min(gx1, n.x); gy1 = Math.min(gy1, n.y);
          gx2 = Math.max(gx2, n.x + _nw); gy2 = Math.max(gy2, n.y + _nh);
        }
        if (gx2 + gPad < vL || gx1 - gPad > vR || gy2 + gPad < vT || gy1 - gPad > vB) continue;
        ctx.fillStyle = color + "0a";
        ctx.strokeStyle = color + "20";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        roundRect(ctx, gx1 - gPad, gy1 - gPad, gx2 - gx1 + gPad * 2, gy2 - gy1 + gPad * 2, 10);
        ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Precompute ancestry path for selected node(s)
    const ancestryPath = new Set();
    if (selectedIds.size > 0 && selectedIds.size <= 3) {
      const parentOf = {};
      for (const n of state.nodes) for (const cid of n.children) parentOf[cid] = n.id;
      for (const sid of selectedIds) {
        let cur = sid;
        while (cur && !ancestryPath.has(cur)) {
          ancestryPath.add(cur);
          cur = parentOf[cur];
        }
      }
    }

    // Compute isolated subtree set (needed before connections and node rendering)
    let isolatedSet = null;
    if (isolatedSubtree) {
      isolatedSet = new Set();
      function collectIso(id) { if (isolatedSet.has(id)) return; isolatedSet.add(id); const n = nodeById[id]; if (n) for (const c of n.children) collectIso(c); }
      collectIso(isolatedSubtree);
    }

    // Connections (skip collapsed, cull off-screen)
    for (const node of state.nodes) {
      if (isolatedSet && !isolatedSet.has(node.id)) continue;
      const visChildren = getVisibleChildren(node);
      const out = outputPort(node);
      for (let ci = 0; ci < visChildren.length; ci++) {
        const child = nodeById[visChildren[ci]];
        if (!child) continue;
        // Skip if both parent and child are off-screen
        const pVis = node.x + _nw > vL && node.x < vR && node.y + _nh > vT && node.y < vB;
        const cVis = child.x + _nw > vL && child.x < vR && child.y + _nh > vT && child.y < vB;
        if (!pVis && !cVis) continue;
        const inp = inputPort(child);
        const key = node.id + ":" + child.id;
        const hovered = hoverConnectionKey === key;
        const replayConn = typeof Replay !== "undefined" && Replay.isActive() ? Replay.getStatusColor(child.id) : null;
        const connDimmed = searchMatchIds !== null && !searchMatchIds.has(node.id) && !searchMatchIds.has(child.id);
        const onPath = ancestryPath.has(node.id) && ancestryPath.has(child.id);
        const override = connDimmed ? "#53a8b622" : replayConn || (hovered ? "#7dd3e0" : onPath ? "#7dd3e0" : null);
        const width = hovered ? 3.5 : replayConn ? 3 : onPath ? 3 : 2.5;
        const pCat = NodeTypes.categoryOf(node.type);
        const cCat = NodeTypes.categoryOf(child.type);
        const pStroke = NodeTypes.colors(pCat).stroke;
        const cStroke = NodeTypes.colors(cCat).stroke;
        const color = override || pStroke;
        const color2 = override ? null : cStroke;
        drawCurve(out.x, out.y, inp.x, inp.y, color, width, color2);
        const arrowColor = override || cStroke;
        if (zoom > 0.3 && !connDimmed) drawArrow(out.x, out.y, inp.x, inp.y, arrowColor);

        // Flow particle on active replay connections
        if (replayConn) {
          const phase = (performance.now() % 1200) / 1200;
          const cp2 = Math.abs(inp.y - out.y) * 0.5 + 20;
          const pt = phase;
          const ipt = 1 - pt;
          const px = ipt*ipt*ipt*out.x + 3*ipt*ipt*pt*out.x + 3*ipt*pt*pt*inp.x + pt*pt*pt*inp.x;
          const py = ipt*ipt*ipt*out.y + 3*ipt*ipt*pt*(out.y+cp2) + 3*ipt*pt*pt*(inp.y-cp2) + pt*pt*pt*inp.y;
          ctx.fillStyle = replayConn;
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Flow dots (non-replay ambient animation)
        if (showFlowDots && !replayConn && !connDimmed && zoom > 0.25) {
          const cp3 = Math.abs(inp.y - out.y) * 0.5 + 20;
          const seed = (node.id.charCodeAt(0) + ci * 97) % 1000;
          for (let di = 0; di < 2; di++) {
            const phase = ((performance.now() + seed * 500 + di * 600) % 2400) / 2400;
            const pt = phase;
            const ipt = 1 - pt;
            const px = ipt*ipt*ipt*out.x + 3*ipt*ipt*pt*out.x + 3*ipt*pt*pt*inp.x + pt*pt*pt*inp.x;
            const py = ipt*ipt*ipt*out.y + 3*ipt*ipt*pt*(out.y+cp3) + 3*ipt*pt*pt*(inp.y-cp3) + pt*pt*pt*inp.y;
            const alpha = Math.sin(phase * Math.PI) * 0.5;
            ctx.fillStyle = `rgba(83,168,182,${alpha})`;
            ctx.beginPath();
            ctx.arc(px, py, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Child order number (hide when zoomed far out)
        if (visChildren.length > 1 && zoom > 0.4) {
          const t = 0.5;
          const cp = Math.abs(inp.y - out.y) * 0.5 + 20;
          const it = 1 - t;
          const mx = it*it*it*out.x + 3*it*it*t*out.x + 3*it*t*t*inp.x + t*t*t*inp.x;
          const my = it*it*it*out.y + 3*it*it*t*(out.y+cp) + 3*it*t*t*(inp.y-cp) + t*t*t*inp.y;
          ctx.fillStyle = isLight() ? "#e2e6ee" : "#1a1a2e";
          ctx.beginPath();
          ctx.arc(mx, my, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#53a8b644";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = "#53a8b6";
          ctx.font = "bold 10px -apple-system, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(ci + 1, mx, my);
        }
      }
    }

    // Connection hover — glow both endpoints
    if (hoverConnectionKey && !dragging && !connecting) {
      const [hpid, hcid] = hoverConnectionKey.split(":");
      for (const hid of [hpid, hcid]) {
        const hn = nodeById[hid];
        if (hn) {
          ctx.strokeStyle = "#7dd3e044";
          ctx.lineWidth = 3;
          roundRect(ctx, hn.x - 3, hn.y - 3, _nw + 6, _nh + 6, 10);
          ctx.stroke();
        }
      }
    }

    // Keyboard connect mode — highlight source node
    if (connectMode) {
      const src = nodeById[connectMode.fromId];
      if (src) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
        ctx.strokeStyle = `rgba(83, 168, 182, ${0.4 + pulse * 0.6})`;
        ctx.lineWidth = 3 / zoom;
        ctx.setLineDash([6 / zoom, 3 / zoom]);
        roundRect(ctx, src.x - 4, src.y - 4, NodeTypes.NODE_W + 8, NodeTypes.NODE_H + 8, 10);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Reparent mode — highlight child node with orange pulse
    if (reparentMode) {
      const child = nodeById[reparentMode.childId];
      if (child) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
        ctx.strokeStyle = `rgba(245, 158, 11, ${0.4 + pulse * 0.6})`;
        ctx.lineWidth = 3 / zoom;
        ctx.setLineDash([6 / zoom, 3 / zoom]);
        roundRect(ctx, child.x - 4, child.y - 4, NodeTypes.NODE_W + 8, NodeTypes.NODE_H + 8, 10);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // In-progress connection — show valid/invalid targets
    if (connecting) {
      const from = nodeById[connecting.fromId];
      if (from) {
        const out = outputPort(from);
        // Highlight valid/invalid drop targets
        for (const n of state.nodes) {
          if (n.id === connecting.fromId) continue;
          const canConn = !from.children.includes(n.id) &&
            from.children.length < NodeTypes.maxChildren(from.type) &&
            !wouldCycle(n.id, connecting.fromId);
          if (connectHoverId === n.id) {
            ctx.strokeStyle = canConn ? "#22c55e" : "#ef4444";
            ctx.lineWidth = 3 / zoom;
            ctx.setLineDash([]);
            roundRect(ctx, n.x - 3, n.y - 3, NodeTypes.NODE_W + 6, NodeTypes.NODE_H + 6, 10);
            ctx.stroke();
          }
        }
        const validTarget = connectHoverId && !from.children.includes(connectHoverId) &&
          from.children.length < NodeTypes.maxChildren(from.type) &&
          !wouldCycle(connectHoverId, connecting.fromId);
        const connColor = connectHoverId ? (validTarget ? "#22c55e88" : "#ef444488") : "#53a8b666";
        drawCurve(out.x, out.y, connecting.x, connecting.y, connColor, 2);
        ctx.setLineDash([6, 4]);
        drawCurve(out.x, out.y, connecting.x, connecting.y, connColor.slice(0, -2) + "44", 1);
        ctx.setLineDash([]);
      }
    }

    // Snap guides
    if (snapGuides.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#53a8b644";
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([4 / zoom, 4 / zoom]);
      for (const g of snapGuides) {
        ctx.beginPath();
        if (g.axis === "x") {
          ctx.moveTo(g.pos, -1e5);
          ctx.lineTo(g.pos, 1e5);
        } else {
          ctx.moveTo(-1e5, g.pos);
          ctx.lineTo(1e5, g.pos);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Compute hidden-by-collapse set
    const hiddenByCollapse = new Set();
    function hideDescendants(id) {
      const n = nodeById[id];
      if (!n) return;
      for (const cid of n.children) {
        hiddenByCollapse.add(cid);
        hideDescendants(cid);
      }
    }
    for (const id of collapsedIds) hideDescendants(id);

    // Shake animation
    if (shakeNode) {
      const elapsed = performance.now() - shakeNode.start;
      if (elapsed > 300) {
        const n = nodeById[shakeNode.id];
        if (n) { n.x = shakeNode.origX; n.y = shakeNode.origY; }
        shakeNode = null;
      } else {
        const n = nodeById[shakeNode.id];
        if (n) {
          const amp = 6 * (1 - elapsed / 300);
          n.x = shakeNode.origX + Math.sin(elapsed * 0.05) * amp;
        }
      }
    }

    // Nodes (render selected last so they're on top, frustum cull off-screen)
    const nw = _nw, nh = _nh;
    const visible = state.nodes.filter(n => !hiddenByCollapse.has(n.id) && (!isolatedSet || isolatedSet.has(n.id)) && n.x + nw > vL && n.x < vR && n.y + nh > vT && n.y < vB);
    const unselected = visible.filter(n => !selectedIds.has(n.id));
    const selected = visible.filter(n => selectedIds.has(n.id));
    for (const node of unselected) drawNode(node, false, connectHoverId === node.id, hasParent);
    for (const node of selected) drawNode(node, true, connectHoverId === node.id, hasParent);

    // Death animation ghosts
    for (const [id, d] of deathAnims) {
      const elapsed = performance.now() - d.startTime;
      if (elapsed > 250) { deathAnims.delete(id); continue; }
      const t = elapsed / 250;
      const scale = 1 - t * 0.4;
      const alpha = 1 - t;
      ctx.save();
      ctx.globalAlpha = alpha * 0.5;
      ctx.translate(d.x + nw / 2, d.y + nh / 2);
      ctx.scale(scale, scale);
      ctx.translate(-(d.x + nw / 2), -(d.y + nh / 2));
      const c = NodeTypes.colors(d.category);
      ctx.fillStyle = c.fill;
      roundRect(ctx, d.x, d.y, nw, nh, 8);
      ctx.fill();
      ctx.restore();
    }

    // Replay heatmap overlay
    if (replayHeatmap && typeof Replay !== "undefined" && Replay.isActive()) {
      const heat = Replay.getHeatmap();
      for (const node of visible) {
        const h = heat[node.id];
        if (h == null || h === 0) continue;
        const r = Math.round(255 * h), g = Math.round(80 * (1 - h)), b = 0;
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.3 + h * 0.7})`;
        ctx.lineWidth = 2 + h * 4;
        roundRect(ctx, node.x - 3, node.y - 3, nw + 6, nh + 6, 10);
        ctx.stroke();
      }
    }

    // Search match highlight ring
    if (searchMatchIds !== null) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 400);
      for (const node of visible) {
        if (!searchMatchIds.has(node.id)) continue;
        ctx.strokeStyle = `rgba(83,168,182,${0.4 + pulse * 0.4})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        roundRect(ctx, node.x - 4, node.y - 4, nw + 8, nh + 8, 10);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Depth badges (show at zoom > 0.5 when tree has depth > 1, not during replay)
    const replayOn = typeof Replay !== "undefined" && Replay.isActive();
    if (zoom > 0.5 && state.root && !replayOn) {
      const depths = {};
      function walkDepth(id, d) {
        if (depths[id] !== undefined) return;
        depths[id] = d;
        const nd = nodeById[id];
        if (nd) for (const cid of nd.children) walkDepth(cid, d + 1);
      }
      walkDepth(state.root, 0);
      const maxD = Math.max(0, ...Object.values(depths));
      if (maxD > 1) {
        ctx.font = "bold 8px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const node of visible) {
          const d = depths[node.id];
          if (d == null) continue;
          const bx = node.x + nw - 10, by = node.y - 6;
          ctx.fillStyle = isLight() ? "#d0d6e2" : "#1a1a2e";
          ctx.beginPath();
          ctx.arc(bx, by, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#53a8b644";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = "#53a8b6";
          ctx.fillText(d, bx, by);
        }
      }
    }

    // Execution order overlay (O key toggle)
    if (showExecOrder && state.root && !replayOn && zoom > 0.35) {
      let order = 0;
      const execNums = {};
      function walkExec(id) {
        if (execNums[id] !== undefined || hiddenByCollapse.has(id)) return;
        execNums[id] = ++order;
        const nd = nodeById[id];
        if (nd) for (const cid of nd.children) walkExec(cid);
      }
      walkExec(state.root);
      ctx.font = "bold 9px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const node of visible) {
        const num = execNums[node.id];
        if (num == null) continue;
        const bx = node.x + 10, by = node.y - 6;
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.arc(bx, by, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1a1a2e";
        ctx.fillText(num, bx, by);
      }
    }

    // Pulse ring on focused node
    if (pulseNode) {
      const pn = nodeById[pulseNode.id];
      const elapsed = performance.now() - pulseNode.start;
      if (pn && elapsed < 600) {
        const t = elapsed / 600;
        const r = 20 + t * 40;
        const alpha = 1 - t;
        ctx.strokeStyle = `rgba(83, 168, 182, ${alpha * 0.6})`;
        ctx.lineWidth = (3 - t * 2) / zoom;
        ctx.beginPath();
        ctx.arc(pn.x + NodeTypes.NODE_W / 2, pn.y + NodeTypes.NODE_H / 2, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        pulseNode = null;
      }
    }

    // Box select
    if (selecting) {
      const subMode = selecting.subtract;
      ctx.strokeStyle = subMode ? "#ef4444" : "#53a8b6";
      ctx.fillStyle = subMode ? "#ef444412" : "#53a8b612";
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([5 / zoom, 3 / zoom]);
      const sx1 = Math.min(selecting.x, selecting.x2);
      const sy1 = Math.min(selecting.y, selecting.y2);
      const sw = Math.abs(selecting.x2 - selecting.x);
      const sh = Math.abs(selecting.y2 - selecting.y);
      ctx.fillRect(sx1, sy1, sw, sh);
      ctx.strokeRect(sx1, sy1, sw, sh);
      ctx.setLineDash([]);
      const selCount = state.nodes.filter(n =>
        n.x + _nw > sx1 && n.x < sx1 + sw && n.y + _nh > sy1 && n.y < sy1 + sh
      ).length;
      if (selCount > 0) {
        const bx = sx1 + sw, by = sy1;
        ctx.fillStyle = subMode ? "#ef4444" : "#53a8b6";
        ctx.beginPath();
        ctx.arc(bx, by, 12 / zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0d1b2a";
        ctx.font = `bold ${10 / zoom}px -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(selCount, bx, by);
      }
    }

    ctx.restore();

    // HUD
    ctx.save();
    ctx.fillStyle = isLight() ? "#00000030" : "#ffffff25";
    ctx.font = "11px -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    const zoomSuffix = connectionStyle !== "bezier" ? " · " + connectionStyle : "";
    const orderSuffix = showExecOrder ? " · order" : "";
    const heatSuffix = replayHeatmap ? " · heat" : "";
    const flowSuffix = showFlowDots ? " · flow" : "";
    const dblSuffix = lastDblClickType !== "action" ? " · dbl:" + lastDblClickType : "";
    ctx.fillText(Math.round(zoom * 100) + "%" + zoomSuffix + orderSuffix + heatSuffix + flowSuffix + dblSuffix, W - 12, H - 12);
    if (connectMode) {
      ctx.fillStyle = "#53a8b6";
      ctx.fillText("CONNECT — click target (Esc cancel)", W - 12, H - 26);
    } else if (isolatedSubtree) {
      ctx.fillStyle = "#c77dff";
      const isoNode = nodeById[isolatedSubtree];
      ctx.fillText("ISOLATED: " + (isoNode ? isoNode.name : "?") + " — Esc to exit", W - 12, H - 26);
    } else if (positionLocked) {
      ctx.fillStyle = "#f59e0b";
      ctx.fillText("LOCKED", W - 12, H - 26);
    } else if (snapToGrid) {
      ctx.fillText("SNAP", W - 12, H - 26);
    }
    ctx.textAlign = "left";
    let connCount = 0;
    for (const n of state.nodes) connCount += n.children.length;
    const searchSuffix = searchMatchIds !== null ? " · " + searchMatchIds.size + " match" : "";
    let selSuffix = "";
    if (selectedIds.size > 1) {
      const cats = {};
      for (const id of selectedIds) {
        const n = nodeById[id];
        if (n) cats[n.category] = (cats[n.category] || 0) + 1;
      }
      const parts = Object.entries(cats).map(([c, n]) => n + " " + c.slice(0, 4));
      selSuffix = " (" + selectedIds.size + " sel: " + parts.join(", ") + ")";
    } else if (selectedIds.size === 1) {
      selSuffix = " (1 sel)";
    }
    // Tree depth indicator
    let depthLabel = "";
    if (state.root && state.nodes.length > 1) {
      let maxDepth = 0;
      const dv = new Set();
      function wd(id, d) { if (dv.has(id)) return; dv.add(id); if (d > maxDepth) maxDepth = d; const nd = nodeById[id]; if (nd) for (const c of nd.children) wd(c, d + 1); }
      wd(state.root, 0);
      const dc = maxDepth <= 4 ? "#22c55e" : maxDepth <= 8 ? "#f59e0b" : "#ef4444";
      depthLabel = " · depth " + maxDepth;
      ctx.fillStyle = dc;
      ctx.beginPath();
      ctx.arc(12 + ctx.measureText(state.nodes.length + " nodes · " + connCount + " conn").width + 28, H - 15, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = isLight() ? "#00000030" : "#ffffff25";
    const nodeLabel = state.nodes.length + " nodes · " + connCount + " conn" + depthLabel + selSuffix + searchSuffix;
    ctx.fillText(nodeLabel, 12, H - 12);

    // Depth sparkline
    if (state.root && state.nodes.length > 2) {
      const byD = {};
      const dv2 = new Set();
      function wdS(id, d) { if (dv2.has(id)) return; dv2.add(id); byD[d] = (byD[d] || 0) + 1; const nd = nodeById[id]; if (nd) for (const c of nd.children) wdS(c, d + 1); }
      wdS(state.root, 0);
      const depths = Object.keys(byD).map(Number).sort((a, b) => a - b);
      const maxB = Math.max(1, ...depths.map(d => byD[d]));
      const barW = 4, barGap = 1, maxH = 16;
      const sparkX = 12;
      const sparkY = H - 28;
      ctx.globalAlpha = 0.35;
      for (let i = 0; i < depths.length; i++) {
        const h = Math.max(2, (byD[depths[i]] / maxB) * maxH);
        ctx.fillStyle = "#53a8b6";
        ctx.fillRect(sparkX + i * (barW + barGap), sparkY + maxH - h, barW, h);
      }
      ctx.globalAlpha = 1;
    }

    // Contextual hint
    if (selectedIds.size > 0 && !reparentMode && !connectMode) {
      ctx.fillStyle = isLight() ? "#00000020" : "#ffffff15";
      ctx.font = "10px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      let hints = [];
      if (selectedIds.size === 1) {
        const sn = nodeById[[...selectedIds][0]];
        if (sn) {
          if (sn.children.length > 0) hints.push("Z zoom subtree", "C collapse", "E extract");
          hints.push("W wrap", "T type", "D dup", "F2 rename");
        }
      } else {
        hints.push("Del delete", "Ctrl+G color", "L layout");
        if (selectedIds.size === 2) hints.push("Shift+X swap");
      }
      if (hints.length > 0) ctx.fillText(hints.join("  ·  "), W / 2, H - 8);
    }

    // Replay HUD
    if (typeof Replay !== "undefined" && Replay.isActive()) {
      const data = Replay.getData();
      const frame = Replay.getCurrentFrame();
      ctx.fillStyle = "#ffffff50";
      ctx.font = "bold 12px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      if (data.agentId) ctx.fillText(data.agentId, 12, 8);
      if (frame) {
        ctx.font = "11px -apple-system, sans-serif";
        ctx.fillText(`t=${frame.timestamp.toFixed(3)}s`, 12, 24);
      }
    }

    // Connection tooltip + insert button on hover
    if (hoverConnectionKey && !dragging && !connecting) {
      const [pid, cid] = hoverConnectionKey.split(":");
      const pNode = nodeById[pid], cNode = nodeById[cid];
      if (pNode && cNode) {
        // Draw "+" insert circle at midpoint
        const mOut = outputPort(pNode), mInp = inputPort(cNode);
        const mCp = Math.abs(mInp.y - mOut.y) * 0.5 + 20;
        const mt = 0.5, mit = 0.5;
        const midX = (mit*mit*mit*mOut.x + 3*mit*mit*mt*mOut.x + 3*mit*mt*mt*mInp.x + mt*mt*mt*mInp.x) * zoom + camX;
        const midY = (mit*mit*mit*mOut.y + 3*mit*mit*mt*(mOut.y+mCp) + 3*mit*mt*mt*(mInp.y-mCp) + mt*mt*mt*mInp.y) * zoom + camY;
        const lt = isLight();
        ctx.fillStyle = lt ? "#0f3460" : "#53a8b6";
        ctx.beginPath();
        ctx.arc(midX, midY, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = lt ? "#fff" : "#0d1b2a";
        ctx.font = "bold 14px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("+", midX, midY);

        const childIdx = pNode.children.indexOf(cid);
        const lines = [`${pNode.name} → ${cNode.name}`];
        if (pNode.children.length > 1) lines.push(`child ${childIdx + 1} of ${pNode.children.length}`);
        lines.push("right-click to insert · click + to add");

        ctx.font = "12px -apple-system, sans-serif";
        const pad = 8, lineH = 16;
        let maxW = 0;
        for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
        const tw = maxW + pad * 2, th = lines.length * lineH + pad * 2;
        const out = outputPort(pNode), inp = inputPort(cNode);
        let sx = ((out.x + inp.x) / 2) * zoom + camX + 10;
        let sy = ((out.y + inp.y) / 2) * zoom + camY - th / 2;
        if (sx + tw > W - 4) sx = sx - tw - 20;
        if (sy + th > H - 4) sy = H - th - 4;
        if (sx < 4) sx = 4;
        if (sy < 4) sy = 4;

        ctx.fillStyle = lt ? "#ffffffee" : "#0d1b2aee";
        ctx.strokeStyle = lt ? "#c0c8d8" : "#0f3460";
        ctx.lineWidth = 1;
        roundRect(ctx, sx, sy, tw, th, 6);
        ctx.fill(); ctx.stroke();
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillStyle = i === 0 ? (lt ? "#1a1a2e" : "#e0e0e0") : (lt ? "#888" : "#666");
          ctx.font = i === 0 ? "600 12px -apple-system, sans-serif" : "11px -apple-system, sans-serif";
          ctx.fillText(lines[i], sx + pad, sy + pad + i * lineH);
        }
      }
    }

    // Tooltip on hover
    if (hoverNodeId && performance.now() - hoverTime > TOOLTIP_DELAY && !dragging && !connecting) {
      const n = nodeById[hoverNodeId];
      if (n) {
        const params = Object.entries(n.parameters);
        const lines = [`${n.name} (${n.type})${n.disabled ? " [DISABLED]" : ""}`];
        const parent = state.nodes.find(p => p.children.includes(n.id));
        if (parent) {
          const idx = parent.children.indexOf(n.id);
          lines.push(`↑ ${parent.name}${parent.children.length > 1 ? ` [${idx + 1}/${parent.children.length}]` : ""}`);
        }
        if (n.description) lines.push(n.description.length > 50 ? n.description.slice(0, 50) + "…" : n.description);
        if (params.length > 0) lines.push(...params.map(([k, v]) => `${k}: ${v}`));
        if (n.children.length > 0) {
          const collapsed = collapsedIds.has(n.id);
          lines.push(`children: ${n.children.length}${collapsed ? " (collapsed)" : ""}`);
        }
        if (n.comment) lines.push(`"${n.comment.length > 40 ? n.comment.slice(0, 40) + "..." : n.comment}"`);

        const replayOn = typeof Replay !== "undefined" && Replay.isActive();
        if (replayOn) {
          const rs = Replay.getNodeStatus(n.id);
          if (rs) lines.push(`status: ${rs.toUpperCase()}`);
        }
        const timeline = replayOn ? Replay.getNodeTimeline(n.id) : null;
        const hasTimeline = timeline && timeline.some(s => s != null);
        const sparkH = hasTimeline ? 18 : 0;

        let sx = (n.x + NodeTypes.NODE_W) * zoom + camX + 10;
        let sy = n.y * zoom + camY;
        const lineH = 16;
        const pad = 8;
        let maxW = 0;
        ctx.font = "12px -apple-system, sans-serif";
        for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
        const sparkW = hasTimeline ? Math.max(100, timeline.length * 2) : 0;
        const tw = Math.max(maxW, sparkW) + pad * 2;
        const th = lines.length * lineH + pad * 2 + sparkH;
        if (sx + tw > W - 4) sx = n.x * zoom + camX - tw - 10;
        if (sy + th > H - 4) sy = H - th - 4;
        if (sx < 4) sx = 4;
        if (sy < 4) sy = 4;

        const lt = isLight();
        ctx.fillStyle = lt ? "#ffffffee" : "#0d1b2aee";
        ctx.strokeStyle = lt ? "#c0c8d8" : "#0f3460";
        ctx.lineWidth = 1;
        roundRect(ctx, sx, sy, tw, th, 6);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillStyle = i === 0 ? (lt ? "#1a1a2e" : "#e0e0e0") : (lt ? "#666" : "#8888aa");
          ctx.font = i === 0 ? "600 12px -apple-system, sans-serif" : "12px -apple-system, sans-serif";
          ctx.fillText(lines[i], sx + pad, sy + pad + i * lineH);
        }

        if (hasTimeline) {
          const barY = sy + th - sparkH - pad / 2;
          const barW = Math.max(1, (tw - pad * 2) / timeline.length);
          const SC = Replay.STATUS_COLORS;
          for (let i = 0; i < timeline.length; i++) {
            const s = timeline[i];
            ctx.fillStyle = s ? (SC[s] || "#333") : (lt ? "#e8e8e8" : "#1a1a2e");
            ctx.fillRect(sx + pad + i * barW, barY, Math.max(1, barW - 0.5), 12);
          }
          const cur = Replay.getCurrentTick();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          const cx = sx + pad + cur * barW;
          ctx.beginPath(); ctx.moveTo(cx, barY - 1); ctx.lineTo(cx, barY + 13); ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  function drawGrid() {
    const gridSize = GRID * zoom;
    if (gridSize < 5) return;
    const majorEvery = 4;
    const offX = camX % gridSize;
    const offY = camY % gridSize;
    const majorSize = gridSize * majorEvery;
    const majorOffX = camX % majorSize;
    const majorOffY = camY % majorSize;

    // Minor grid
    ctx.strokeStyle = isLight() ? "#00000008" : "#ffffff06";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = offX; x < W; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = offY; y < H; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // Major grid
    if (majorSize > 20) {
      ctx.strokeStyle = isLight() ? "#00000012" : "#ffffff0d";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = majorOffX; x < W; x += majorSize) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = majorOffY; y < H; y += majorSize) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    }

    // Origin crosshair
    const ox = camX, oy = camY;
    if (ox > -20 && ox < W + 20 && oy > -20 && oy < H + 20) {
      ctx.strokeStyle = isLight() ? "#00000018" : "#ffffff12";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ox, Math.max(0, oy - 20)); ctx.lineTo(ox, Math.min(H, oy + 20));
      ctx.moveTo(Math.max(0, ox - 20), oy); ctx.lineTo(Math.min(W, ox + 20), oy);
      ctx.stroke();
    }
  }

  function drawNode(node, selected, connectHover, hasParentSet) {
    const { NODE_W: nw, NODE_H: nh, PORT_R: pr } = NodeTypes;
    const c = NodeTypes.colors(node.category);

    // Spawn scale animation
    let spawnScale = 1;
    if (spawnAnims.has(node.id)) {
      const elapsed = performance.now() - spawnAnims.get(node.id);
      if (elapsed > 300) spawnAnims.delete(node.id);
      else if (elapsed < 0) { spawnScale = 0; }
      else {
        const t = elapsed / 300;
        spawnScale = 1 - Math.pow(1 - t, 3) * (1 - 0.3) + Math.sin(t * Math.PI) * 0.08;
      }
    }
    if (spawnScale < 1) {
      ctx.save();
      ctx.translate(node.x + nw / 2, node.y + nh / 2);
      ctx.scale(spawnScale, spawnScale);
      ctx.translate(-(node.x + nw / 2), -(node.y + nh / 2));
    }

    const x = node.x, y = node.y;
    const isRoot = state.root === node.id;
    const isOrphan = !isRoot && !hasParentSet.has(node.id);

    // Replay status
    const replayActive = typeof Replay !== "undefined" && Replay.isActive();
    const replayColor = replayActive ? Replay.getStatusColor(node.id) : null;
    const replayStatus = replayActive ? Replay.getNodeStatus(node.id) : null;
    const searchDimmed = searchMatchIds !== null && !searchMatchIds.has(node.id);
    const nodeDisabled = node.disabled;
    const dimmed = (replayActive && !replayColor) || searchDimmed || nodeDisabled;

    // Glow for replay status or selection
    if (replayColor) {
      ctx.shadowColor = replayColor + "80";
      ctx.shadowBlur = 16;
    } else if (selected) {
      ctx.shadowColor = "#ffffff40";
      ctx.shadowBlur = 12;
    }

    // Shadow
    ctx.fillStyle = isLight() ? "#00000018" : "#00000050";
    roundRect(ctx, x + 2, y + 2, nw, nh, 8);
    ctx.fill();

    // Body
    const lt = isLight();
    const bodyFill = dimmed ? (lt ? "#e0e0e0" : "#0d1b2a") : connectHover ? (lt ? "#b8e6c8" : "#2a5a4a") : c.fill;
    ctx.fillStyle = bodyFill;
    ctx.globalAlpha = dimmed ? 0.4 : 1;

    if (replayColor) {
      ctx.strokeStyle = replayColor;
      ctx.lineWidth = 3;
    } else {
      const customBorder = node.color && !connectHover && !isOrphan && !selected && !isRoot;
      ctx.strokeStyle = connectHover ? "#53a8b6" : isOrphan ? "#ff6b6b" : selected ? "#ffffff" : isRoot ? "#ffd700" : customBorder ? node.color : c.stroke;
      ctx.lineWidth = connectHover ? 3 : selected ? 2.5 : isRoot ? 2.5 : customBorder ? 2 : 1.5;
    }
    roundRect(ctx, x, y, nw, nh, 8);
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;

    // Category stripe (top bar)
    if (!dimmed) {
      ctx.fillStyle = node.color || c.stroke;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(x + 8, y);
      ctx.lineTo(x + nw - 8, y);
      ctx.quadraticCurveTo(x + nw, y, x + nw, y + 4);
      ctx.lineTo(x, y + 4);
      ctx.quadraticCurveTo(x, y, x + 8, y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Replay status badge (top-right)
    if (replayColor && replayStatus) {
      const labels = { success: "OK", failure: "FAIL", running: "RUN" };
      const label = labels[replayStatus] || replayStatus.toUpperCase();
      const badgeW = ctx.measureText ? Math.max(30, label.length * 7 + 10) : 36;
      ctx.fillStyle = replayColor + "40";
      roundRect(ctx, x + nw - badgeW - 4, y + 3, badgeW, 14, 3);
      ctx.fill();
      ctx.fillStyle = replayColor;
      ctx.font = "bold 8px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(label, x + nw - 8, y + 5);
    }

    // Root badge (only when not in replay or when root)
    if (isRoot && !replayActive) {
      ctx.fillStyle = "#ffd70030";
      roundRect(ctx, x + 4, y + 3, 36, 14, 3);
      ctx.fill();
      ctx.fillStyle = "#ffd700";
      ctx.font = "bold 8px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("ROOT", x + 8, y + 5);
    }

    // Orphan badge
    if (isOrphan && state.nodes.length > 1 && !replayActive) {
      ctx.fillStyle = "#ff6b6b30";
      roundRect(ctx, x + nw - 58, y + 3, 54, 14, 3);
      ctx.fill();
      ctx.fillStyle = "#ff6b6b";
      ctx.font = "bold 8px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("ORPHAN", x + nw - 8, y + 5);
    }

    // Disabled badge + strikethrough
    if (nodeDisabled && zoom > 0.5 && !replayActive) {
      ctx.fillStyle = "#88888830";
      roundRect(ctx, x + 4, y + nh - 18, 56, 14, 3);
      ctx.fill();
      ctx.fillStyle = "#888888";
      ctx.font = "bold 8px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("DISABLED", x + 8, y + nh - 16);
    }
    if (nodeDisabled && zoom > 0.4) {
      ctx.strokeStyle = isLight() ? "#00000040" : "#ffffff40";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + nh / 2);
      ctx.lineTo(x + nw - 8, y + nh / 2);
      ctx.stroke();
    }

    // Zoom-dependent detail: hide subtitle when very zoomed out
    const icon = NodeTypes.ICONS[node.type] || "";
    if (zoom > 0.35) {
      // Type subtitle + parameter hint
      ctx.fillStyle = (dimmed ? "#ffffff" : c.text) + "66";
      ctx.font = "9px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const paramKeys = Object.keys(node.parameters);
      const paramHint = paramKeys.length > 0 ? " " + paramKeys.map(k => k + "=" + node.parameters[k]).join(" ") : "";
      const subtitle = node.type.toUpperCase() + (paramHint.length < 28 ? paramHint : "");
      ctx.fillText(subtitle, x + nw / 2, y + nh - 5, nw - 10);

      // Key parameter badge (bottom-right) for decorator/parallel config
      const keyParam =
        node.type === "parallel" && node.parameters.policy ? node.parameters.policy.replace(/_/g, " ") :
        node.type === "repeat" && node.parameters.count != null ? "×" + node.parameters.count :
        node.type === "cooldown" && node.parameters.duration != null ? node.parameters.duration + "s" :
        node.type === "timeout" && node.parameters.seconds != null ? node.parameters.seconds + "s" :
        node.type === "guard" && node.parameters.key ? node.parameters.key :
        null;
      if (keyParam && !dimmed) {
        ctx.font = "bold 8px -apple-system, sans-serif";
        const tw = ctx.measureText(keyParam).width + 8;
        ctx.fillStyle = c.stroke + "25";
        roundRect(ctx, x + nw - tw - 4, y + nh - 16, tw, 12, 3);
        ctx.fill();
        ctx.fillStyle = c.stroke;
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(keyParam, x + nw - 6, y + nh - 5);
      }
    }

    // Icon + name
    const hasDesc = node.description && zoom > 0.5 && !dimmed;
    ctx.fillStyle = dimmed ? "#ffffff44" : c.text;
    ctx.font = "600 13px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelY = isRoot && !replayActive ? y + nh / 2 + 1 : y + nh / 2 - (hasDesc ? 6 : (zoom > 0.35 ? 3 : 0));
    ctx.fillText(`${icon} ${node.name}`, x + nw / 2, labelY, nw - 20);
    if (hasDesc) {
      const desc = node.description.length > 35 ? node.description.slice(0, 35) + "…" : node.description;
      ctx.fillStyle = isLight() ? "#00000050" : "#ffffff40";
      ctx.font = "italic 10px -apple-system, sans-serif";
      ctx.fillText(desc, x + nw / 2, labelY + 14, nw - 16);
    }

    ctx.globalAlpha = 1;

    // Ports and comment indicator — hide when zoomed very far out
    if (zoom > 0.25) {
      // Input port (top)
      ctx.fillStyle = connectHover ? "#ffffff" : replayColor || "#53a8b6";
      ctx.strokeStyle = "#0d1b2a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + nw / 2, y, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Output port (bottom)
      if (NodeTypes.maxChildren(node.type) > 0) {
        ctx.fillStyle = replayColor || "#53a8b6";
        ctx.beginPath();
        ctx.arc(x + nw / 2, y + nh, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Comment indicator + inline preview
      if (node.comment) {
        ctx.fillStyle = "#53a8b6";
        ctx.font = "10px -apple-system, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("💬", x + 3, y + nh - 14);
        if (zoom > 0.7 && !dimmed) {
          const preview = node.comment.length > 30 ? node.comment.slice(0, 30) + "…" : node.comment;
          ctx.fillStyle = isLight() ? "#00000040" : "#ffffff30";
          ctx.font = "italic 9px -apple-system, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(preview, x + nw / 2, y + nh + 2, nw);
        }
      }
    }

    // Warning indicator
    if (state._warningIds && state._warningIds.has(node.id) && !dimmed && zoom > 0.4) {
      ctx.fillStyle = "#f59e0b";
      ctx.font = "bold 11px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("⚠", x + nw - 16, y + nh - 15);
    }

    // Bookmark star
    if (bookmarks.has(node.id) && !dimmed && zoom > 0.3) {
      ctx.fillStyle = "#ffd700";
      ctx.font = "bold 12px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("★", x + nw - 2, y + 2);
    }

    if (spawnScale < 1) ctx.restore();

    // Collapse indicator with descendant count
    if (collapsedIds.has(node.id) && node.children.length > 0) {
      let dCount = 0;
      const dVisited = new Set();
      function countDesc(nid) {
        if (dVisited.has(nid)) return;
        dVisited.add(nid);
        const nd = nodeById[nid];
        if (nd) for (const cid of nd.children) { dCount++; countDesc(cid); }
      }
      countDesc(node.id);
      const label = "+" + dCount + " hidden";
      const tw = ctx.measureText(label).width || 60;
      ctx.fillStyle = "#f59e0b22";
      roundRect(ctx, x + nw / 2 - tw / 2 - 8, y + nh + 8, tw + 16, 18, 9);
      ctx.fill();
      ctx.fillStyle = "#f59e0b";
      ctx.font = "bold 10px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + nw / 2, y + nh + 17);
    }
  }

  function tracePath(x1, y1, x2, y2, offsetY) {
    const oy = offsetY || 0;
    ctx.beginPath();
    if (connectionStyle === "straight") {
      ctx.moveTo(x1, y1 + oy);
      ctx.lineTo(x2, y2 + oy);
    } else if (connectionStyle === "step") {
      const midY = (y1 + y2) / 2 + oy;
      ctx.moveTo(x1, y1 + oy);
      ctx.lineTo(x1, midY);
      ctx.lineTo(x2, midY);
      ctx.lineTo(x2, y2 + oy);
    } else {
      const cp = Math.abs(y2 - y1) * 0.5 + 20;
      ctx.moveTo(x1, y1 + oy);
      ctx.bezierCurveTo(x1, y1 + cp + oy, x2, y2 - cp + oy, x2, y2 + oy);
    }
  }

  function drawCurve(x1, y1, x2, y2, color, lineWidth, color2) {
    // Shadow pass
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = (lineWidth || 2.5) + 3;
    tracePath(x1, y1, x2, y2, 1);
    ctx.stroke();
    ctx.restore();
    // Main curve
    if (color2 && color2 !== color) {
      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, color);
      grad.addColorStop(1, color2);
      ctx.strokeStyle = grad;
    } else {
      ctx.strokeStyle = color;
    }
    ctx.lineWidth = lineWidth || 2.5;
    tracePath(x1, y1, x2, y2);
    ctx.stroke();
  }

  function drawArrow(x1, y1, x2, y2, color) {
    let angle;
    if (connectionStyle === "straight") {
      angle = Math.atan2(y2 - y1, x2 - x1);
    } else if (connectionStyle === "step") {
      angle = Math.PI / 2;
    } else {
      const cp = Math.abs(y2 - y1) * 0.5 + 20;
      const t = 0.85, it = 1 - t;
      const cy1 = y1 + cp, cy2 = y2 - cp;
      const bx = it*it*it*x1 + 3*it*it*t*x1 + 3*it*t*t*x2 + t*t*t*x2;
      const by = it*it*it*y1 + 3*it*it*t*cy1 + 3*it*t*t*cy2 + t*t*t*y2;
      angle = Math.atan2(y2 - by, x2 - bx);
    }
    const size = 7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2 - 4);
    ctx.lineTo(x2 - size * Math.cos(angle - 0.4), y2 - 4 - size * Math.sin(angle - 0.4));
    ctx.lineTo(x2 - size * Math.cos(angle + 0.4), y2 - 4 - size * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawMinimap() {
    const mw = mmCvs.width = mmCvs.clientWidth * devicePixelRatio;
    const mh = mmCvs.height = mmCvs.clientHeight * devicePixelRatio;
    mmCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const cw = mmCvs.clientWidth, ch = mmCvs.clientHeight;

    mmCtx.clearRect(0, 0, cw, ch);
    mmCtx.fillStyle = isLight() ? "#dde1e8" : "#0d1b2a";
    mmCtx.fillRect(0, 0, cw, ch);

    if (state.nodes.length === 0) return;

    let isolatedSet = null;
    if (isolatedSubtree) {
      isolatedSet = new Set();
      function cIso(id) { if (isolatedSet.has(id)) return; isolatedSet.add(id); const n = nodeById[id]; if (n) for (const c of n.children) cIso(c); }
      cIso(isolatedSubtree);
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of state.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NodeTypes.NODE_W);
      maxY = Math.max(maxY, n.y + NodeTypes.NODE_H);
    }
    const pad = 50;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const s = Math.min(cw / (maxX - minX), ch / (maxY - minY));
    const ox = (cw - (maxX - minX) * s) / 2;
    const oy = (ch - (maxY - minY) * s) / 2;

    mmCtx.strokeStyle = "#53a8b633";
    mmCtx.lineWidth = 1;
    for (const node of state.nodes) {
      if (isolatedSet && !isolatedSet.has(node.id)) continue;
      for (const cid of node.children) {
        const child = nodeById[cid];
        if (!child) continue;
        mmCtx.beginPath();
        mmCtx.moveTo(ox + (node.x + NodeTypes.NODE_W / 2 - minX) * s,
                      oy + (node.y + NodeTypes.NODE_H - minY) * s);
        mmCtx.lineTo(ox + (child.x + NodeTypes.NODE_W / 2 - minX) * s,
                      oy + (child.y - minY) * s);
        mmCtx.stroke();
      }
    }

    const mmHidden = new Set();
    function mmHideDesc(id) {
      const nd = nodeById[id];
      if (!nd) return;
      for (const cid of nd.children) { mmHidden.add(cid); mmHideDesc(cid); }
    }
    for (const id of collapsedIds) mmHideDesc(id);

    const mmReplay = typeof Replay !== "undefined" && Replay.isActive();
    for (const n of state.nodes) {
      if (mmHidden.has(n.id)) continue;
      if (isolatedSet && !isolatedSet.has(n.id)) continue;
      const c = NodeTypes.colors(n.category);
      const rc = mmReplay ? Replay.getStatusColor(n.id) : null;
      mmCtx.fillStyle = rc || (selectedIds.has(n.id) ? "#ffffff" : n.color || c.stroke);
      mmCtx.globalAlpha = mmReplay && !rc ? 0.3 : 1;
      const rx = Math.max(2, NodeTypes.NODE_W * s);
      const ry = Math.max(2, NodeTypes.NODE_H * s);
      mmCtx.fillRect(ox + (n.x - minX) * s, oy + (n.y - minY) * s, rx, ry);
    }
    mmCtx.globalAlpha = 1;

    const vx = ox + (-camX / zoom - minX) * s;
    const vy = oy + (-camY / zoom - minY) * s;
    const vw = (W / zoom) * s;
    const vh = (H / zoom) * s;
    mmCtx.fillStyle = isLight() ? "#2980b908" : "#53a8b608";
    mmCtx.fillRect(vx, vy, vw, vh);
    mmCtx.strokeStyle = isLight() ? "#2980b966" : "#53a8b666";
    mmCtx.lineWidth = 1.5;
    mmCtx.strokeRect(vx, vy, vw, vh);
  }

  // --- Minimap click-to-navigate ---
  function getMinimapTransform() {
    if (state.nodes.length === 0) return null;
    const cw = mmCvs.clientWidth, ch = mmCvs.clientHeight;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of state.nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NodeTypes.NODE_W); maxY = Math.max(maxY, n.y + NodeTypes.NODE_H);
    }
    const pad = 50;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const s = Math.min(cw / (maxX - minX), ch / (maxY - minY));
    const ox = (cw - (maxX - minX) * s) / 2;
    const oy = (ch - (maxY - minY) * s) / 2;
    return { minX, minY, s, ox, oy };
  }

  function minimapNavigate(e) {
    const t = getMinimapTransform();
    if (!t) return;
    const rect = mmCvs.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const worldX = (mx - t.ox) / t.s + t.minX;
    const worldY = (my - t.oy) / t.s + t.minY;
    camX = W / 2 - worldX * zoom;
    camY = H / 2 - worldY * zoom;
  }

  function onMinimapDown(e) {
    minimapNavigate(e);
    function onMove(ev) { minimapNavigate(ev); }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // --- Collapse / expand subtrees ---
  function getVisibleChildren(node) {
    if (collapsedIds.has(node.id)) return [];
    return node.children;
  }

  function isCollapsed(id) { return collapsedIds.has(id); }

  function selectSubtree(id) {
    const visited = new Set();
    function collect(nid) {
      if (visited.has(nid)) return;
      visited.add(nid);
      const n = nodeById[nid];
      if (n) for (const cid of n.children) collect(cid);
    }
    collect(id);
    for (const nid of visited) selectedIds.add(nid);
    if (onSelect) onSelect([...selectedIds]);
  }

  // --- Public API ---

  function deleteSelected() {
    if (selectedIds.size === 0) return;
    // Find a neighbor to select after deletion
    let nextSelectId = null;
    if (selectedIds.size === 1) {
      const delId = [...selectedIds][0];
      const parent = state.nodes.find(n => n.children.includes(delId));
      if (parent) {
        const idx = parent.children.indexOf(delId);
        const siblings = parent.children.filter(c => c !== delId);
        nextSelectId = siblings.length > 0 ? siblings[Math.min(idx, siblings.length - 1)] : parent.id;
      }
    }
    const now = performance.now();
    for (const id of selectedIds) {
      const n = nodeById[id];
      if (n) deathAnims.set(id, { startTime: now, x: n.x, y: n.y, name: n.name, type: n.type, category: n.category });
      for (const p of state.nodes) {
        const idx = p.children.indexOf(id);
        if (idx >= 0) p.children.splice(idx, 1);
      }
    }
    state.nodes = state.nodes.filter(n => !selectedIds.has(n.id));
    rebuildLookup();
    if (selectedIds.has(state.root)) {
      state.root = state.nodes.length > 0 ? state.nodes[0].id : "";
    }
    selectedIds.clear();
    if (nextSelectId && nodeById[nextSelectId]) {
      selectedIds.add(nextSelectId);
      if (onSelect) onSelect([nextSelectId]);
    } else {
      if (onSelect) onSelect([]);
    }
    if (onChanged) onChanged();
  }

  function autoLayout() {
    if (state.nodes.length === 0) return;
    rebuildLookup();
    const nw = NodeTypes.NODE_W, nh = NodeTypes.NODE_H;
    const hGap = 35, vGap = 70;

    const childSet = new Set();
    for (const n of state.nodes) n.children.forEach(c => childSet.add(c));
    const rootNode = nodeById[state.root] || state.nodes.find(n => !childSet.has(n.id)) || state.nodes[0];

    const widths = {};
    const visited = new Set();
    function calcWidth(id) {
      if (visited.has(id)) return nw;
      visited.add(id);
      const n = nodeById[id];
      if (!n || n.children.length === 0) { widths[id] = nw; return nw; }
      let total = 0;
      for (const cid of n.children) total += calcWidth(cid) + hGap;
      total -= hGap;
      widths[id] = Math.max(nw, total);
      return widths[id];
    }
    calcWidth(rootNode.id);

    const placed = new Set();
    function place(id, x, y) {
      if (placed.has(id)) return;
      placed.add(id);
      const n = nodeById[id];
      if (!n) return;
      n.x = snap(x + ((widths[id] || nw) - nw) / 2);
      n.y = snap(y);
      let cx = x;
      for (const cid of n.children) {
        place(cid, cx, y + nh + vGap);
        cx += (widths[cid] || nw) + hGap;
      }
    }
    const totalW = widths[rootNode.id] || nw;
    place(rootNode.id, -totalW / 2, 0);

    let orphanX = -totalW / 2;
    let maxY = 0;
    for (const n of state.nodes) maxY = Math.max(maxY, n.y);
    for (const n of state.nodes) {
      if (!placed.has(n.id)) {
        n.x = snap(orphanX);
        n.y = snap(maxY + nh + vGap * 2);
        orphanX += nw + hGap;
      }
    }

    if (onChanged) onChanged();
  }

  let layoutAnim = null;
  function animatedAutoLayout() {
    if (state.nodes.length === 0) return;
    const before = {};
    for (const n of state.nodes) before[n.id] = { x: n.x, y: n.y };
    autoLayout();
    const after = {};
    for (const n of state.nodes) { after[n.id] = { x: n.x, y: n.y }; n.x = before[n.id].x; n.y = before[n.id].y; }
    layoutAnim = { before, after, start: performance.now(), dur: 300 };
  }

  function getSelectedIds() { return [...selectedIds]; }
  function setSelectedIds(ids) { selectedIds = new Set(ids); if (onSelect) onSelect([...selectedIds]); }
  function getState() { return state; }
  function setState(s) { state = s; rebuildLookup(); }
  function notifyChanged() { rebuildLookup(); }

  function centerView(animated) {
    if (state.nodes.length === 0) {
      if (animated) {
        targetCamX = W / 2; targetCamY = 50; targetZoom = 1; animating = true;
      } else {
        camX = W / 2; camY = 50; zoom = 1;
      }
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of state.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NodeTypes.NODE_W);
      maxY = Math.max(maxY, n.y + NodeTypes.NODE_H);
    }
    const tw = maxX - minX, th = maxY - minY;
    const z = Math.min(1.5, Math.min((W - 80) / tw, (H - 80) / th));
    const cx = (W - tw * z) / 2 - minX * z;
    const cy = (H - th * z) / 2 - minY * z;
    if (animated) {
      targetCamX = cx; targetCamY = cy; targetZoom = z; animating = true;
    } else {
      camX = cx; camY = cy; zoom = z;
    }
  }

  function copySelected() {
    if (selectedIds.size === 0) return;
    const copies = [];
    const idMap = {};
    for (const id of selectedIds) {
      const n = nodeById[id];
      if (!n) continue;
      const newId = Serialization.uid();
      idMap[id] = newId;
      copies.push({ ...n, id: newId, x: n.x + 30, y: n.y + 30, children: [...n.children], parameters: { ...n.parameters } });
    }
    for (const c of copies) {
      c.children = c.children.filter(cid => idMap[cid]).map(cid => idMap[cid]);
    }
    state.nodes.push(...copies);
    rebuildLookup();
    selectedIds.clear();
    copies.forEach(c => selectedIds.add(c.id));
    if (onSelect) onSelect([...selectedIds]);
    if (onChanged) onChanged();
  }

  function toggleSnap() { snapToGrid = !snapToGrid; return snapToGrid; }
  function isSnapping() { return snapToGrid; }

  function toggleCollapse(id) {
    if (collapsedIds.has(id)) collapsedIds.delete(id);
    else collapsedIds.add(id);
  }

  function exportPNG() {
    if (state.nodes.length === 0) return null;
    const nw = NodeTypes.NODE_W, nh = NodeTypes.NODE_H;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of state.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + nw);
      maxY = Math.max(maxY, n.y + nh);
    }
    const pad = 40;
    const titleH = 30;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const tw = maxX - minX, th = maxY - minY + titleH;

    const offCvs = document.createElement("canvas");
    offCvs.width = tw * 2;
    offCvs.height = th * 2;
    const oc = offCvs.getContext("2d");
    oc.scale(2, 2);
    oc.fillStyle = "#1a1a2e";
    oc.fillRect(0, 0, tw, th);

    oc.fillStyle = "#ffffff50";
    oc.font = "600 14px -apple-system, sans-serif";
    oc.textAlign = "left";
    oc.textBaseline = "top";
    oc.fillText(state.title || "Untitled", 12, 8);
    oc.fillStyle = "#ffffff25";
    oc.font = "11px -apple-system, sans-serif";
    oc.textAlign = "right";
    oc.fillText(state.nodes.length + " nodes", tw - 12, 10);

    oc.translate(-minX, -minY + titleH);

    // Draw connections
    const hasParent = new Set();
    for (const n of state.nodes) for (const cid of n.children) hasParent.add(cid);
    for (const node of state.nodes) {
      const out = outputPort(node);
      for (const cid of node.children) {
        const child = nodeById[cid];
        if (!child) continue;
        const inp = inputPort(child);
        const cp = Math.abs(inp.y - out.y) * 0.5 + 20;
        oc.strokeStyle = "#53a8b6";
        oc.lineWidth = 2.5;
        oc.beginPath();
        oc.moveTo(out.x, out.y);
        oc.bezierCurveTo(out.x, out.y + cp, inp.x, inp.y - cp, inp.x, inp.y);
        oc.stroke();
      }
    }

    // Draw nodes (simplified)
    for (const node of state.nodes) {
      const c = NodeTypes.colors(node.category);
      const x = node.x, y = node.y;
      oc.fillStyle = c.fill;
      oc.strokeStyle = state.root === node.id ? "#ffd700" : node.color || c.stroke;
      oc.lineWidth = state.root === node.id ? 2.5 : node.color ? 2 : 1.5;
      roundRect(oc, x, y, nw, nh, 8);
      oc.fill();
      oc.stroke();
      // Color stripe
      oc.fillStyle = node.color || c.stroke;
      oc.globalAlpha = 0.7;
      oc.beginPath();
      oc.moveTo(x + 8, y); oc.lineTo(x + nw - 8, y);
      oc.quadraticCurveTo(x + nw, y, x + nw, y + 4);
      oc.lineTo(x, y + 4); oc.quadraticCurveTo(x, y, x + 8, y);
      oc.closePath(); oc.fill();
      oc.globalAlpha = 1;
      const icon = NodeTypes.ICONS[node.type] || "";
      oc.fillStyle = c.text;
      oc.font = "600 13px -apple-system, sans-serif";
      oc.textAlign = "center";
      oc.textBaseline = "middle";
      oc.fillText(`${icon} ${node.name}`, x + nw / 2, y + nh / 2, nw - 20);
      oc.fillStyle = c.text + "66";
      oc.font = "9px -apple-system, sans-serif";
      oc.textBaseline = "bottom";
      oc.fillText(node.type.toUpperCase(), x + nw / 2, y + nh - 5, nw - 10);
      // Ports
      oc.fillStyle = "#53a8b6";
      oc.beginPath();
      oc.arc(x + nw / 2, y, 5, 0, Math.PI * 2);
      oc.fill();
      if (NodeTypes.maxChildren(node.type) > 0) {
        oc.beginPath();
        oc.arc(x + nw / 2, y + nh, 5, 0, Math.PI * 2);
        oc.fill();
      }
    }

    return offCvs.toDataURL("image/png");
  }

  function exportPNGBlob() {
    const dataUrl = exportPNG();
    if (!dataUrl) return Promise.resolve(null);
    return fetch(dataUrl).then(r => r.blob());
  }

  function exportSVG() {
    if (state.nodes.length === 0) return null;
    const nw = NodeTypes.NODE_W, nh = NodeTypes.NODE_H;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of state.nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + nw); maxY = Math.max(maxY, n.y + nh);
    }
    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const tw = maxX - minX, th = maxY - minY;

    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const titleH = 28;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th + titleH}" viewBox="${minX} ${minY - titleH} ${tw} ${th + titleH}" font-family="-apple-system,sans-serif">\n`;
    svg += `<rect x="${minX}" y="${minY - titleH}" width="${tw}" height="${th + titleH}" fill="#1a1a2e"/>\n`;
    svg += `<text x="${minX + 12}" y="${minY - 8}" fill="#ffffff80" font-size="14" font-weight="600">${esc(state.title || "Untitled")}</text>\n`;
    svg += `<text x="${maxX - 12}" y="${minY - 8}" text-anchor="end" fill="#ffffff40" font-size="11">${state.nodes.length} nodes</text>\n`;

    // Gradient defs + connections
    const gradIds = new Set();
    let defs = "<defs>\n";
    for (const node of state.nodes) {
      for (const cid of node.children) {
        const child = nodeById[cid];
        if (!child) continue;
        const pCat = NodeTypes.categoryOf(node.type);
        const cCat = NodeTypes.categoryOf(child.type);
        const gid = pCat + "-" + cCat;
        if (!gradIds.has(gid)) {
          gradIds.add(gid);
          const pCol = NodeTypes.COLORS[pCat]?.stroke || "#53a8b6";
          const cCol = NodeTypes.COLORS[cCat]?.stroke || "#53a8b6";
          defs += `<linearGradient id="g-${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${pCol}"/><stop offset="100%" stop-color="${cCol}"/></linearGradient>\n`;
        }
      }
    }
    defs += "</defs>\n";
    svg += defs;
    for (const node of state.nodes) {
      const out = outputPort(node);
      for (const cid of node.children) {
        const child = nodeById[cid];
        if (!child) continue;
        const inp = inputPort(child);
        const pCat = NodeTypes.categoryOf(node.type);
        const cCat = NodeTypes.categoryOf(child.type);
        const gid = pCat + "-" + cCat;
        let d;
        if (connectionStyle === "straight") {
          d = `M${out.x},${out.y} L${inp.x},${inp.y}`;
        } else if (connectionStyle === "step") {
          const midY = (out.y + inp.y) / 2;
          d = `M${out.x},${out.y} L${out.x},${midY} L${inp.x},${midY} L${inp.x},${inp.y}`;
        } else {
          const cp = Math.abs(inp.y - out.y) * 0.5 + 20;
          d = `M${out.x},${out.y} C${out.x},${out.y + cp} ${inp.x},${inp.y - cp} ${inp.x},${inp.y}`;
        }
        svg += `<path d="${d}" fill="none" stroke="url(#g-${gid})" stroke-width="2.5"/>\n`;
      }
    }

    // Nodes
    for (const node of state.nodes) {
      const c = NodeTypes.colors(node.category);
      const x = node.x, y = node.y;
      const isRoot = state.root === node.id;
      const hasParent = state.nodes.some(n => n.children.includes(node.id));
      const isOrphan = !isRoot && !hasParent && state.nodes.length > 1;
      const strokeColor = isOrphan ? "#ff6b6b" : isRoot ? "#ffd700" : node.color || c.stroke;
      const sw = isRoot ? 2.5 : isOrphan ? 2 : node.color ? 2 : 1.5;
      // Shadow
      svg += `<rect x="${x + 2}" y="${y + 2}" width="${nw}" height="${nh}" rx="8" fill="#00000050"/>\n`;
      svg += `<rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="8" fill="${c.fill}" stroke="${strokeColor}" stroke-width="${sw}"/>\n`;
      // Stripe
      svg += `<rect x="${x}" y="${y}" width="${nw}" height="4" rx="4" fill="${node.color || c.stroke}" opacity="0.7"/>\n`;
      // Root badge
      if (isRoot) svg += `<rect x="${x + 4}" y="${y + 3}" width="36" height="14" rx="3" fill="#ffd70030"/><text x="${x + 8}" y="${y + 13}" fill="#ffd700" font-size="8" font-weight="bold">ROOT</text>\n`;
      // Orphan badge
      if (isOrphan) svg += `<rect x="${x + nw - 58}" y="${y + 3}" width="54" height="14" rx="3" fill="#ff6b6b30"/><text x="${x + nw - 8}" y="${y + 13}" text-anchor="end" fill="#ff6b6b" font-size="8" font-weight="bold">ORPHAN</text>\n`;
      // Name
      const icon = NodeTypes.ICONS[node.type] || "";
      svg += `<text x="${x + nw / 2}" y="${y + nh / 2}" text-anchor="middle" dominant-baseline="central" fill="${c.text}" font-size="13" font-weight="600">${esc(icon + " " + node.name)}</text>\n`;
      // Type
      svg += `<text x="${x + nw / 2}" y="${y + nh - 5}" text-anchor="middle" dominant-baseline="auto" fill="${c.text}" opacity="0.4" font-size="9">${node.type.toUpperCase()}</text>\n`;
      // Ports
      svg += `<circle cx="${x + nw / 2}" cy="${y}" r="5" fill="#53a8b6" stroke="#0d1b2a" stroke-width="2"/>\n`;
      if (NodeTypes.maxChildren(node.type) > 0) svg += `<circle cx="${x + nw / 2}" cy="${y + nh}" r="5" fill="#53a8b6" stroke="#0d1b2a" stroke-width="2"/>\n`;
      // Comment indicator
      if (node.comment) svg += `<text x="${x + 5}" y="${y + nh - 6}" font-size="10">💬</text>\n`;
    }

    svg += `</svg>`;
    return svg;
  }

  function addNodeAt(type, wx, wy) {
    const node = {
      id: Serialization.uid(),
      type,
      category: NodeTypes.categoryOf(type),
      name: type.charAt(0).toUpperCase() + type.slice(1),
      children: [],
      parameters: NodeTypes.defaultParams(type),
      x: snap(wx - NodeTypes.NODE_W / 2),
      y: snap(wy - NodeTypes.NODE_H / 2),
    };
    state.nodes.push(node);
    rebuildLookup();
    if (state.nodes.length === 1) state.root = node.id;
    spawnAnims.set(node.id, performance.now());
    lastDblClickType = type;
    localStorage.setItem("bt-last-dblclick-type", type);
    selectedIds.clear();
    selectedIds.add(node.id);
    if (onSelect) onSelect([node.id]);
    if (onChanged) onChanged();
    return node;
  }

  function addNodeAtCenter(type) {
    let wx = (W / 2 - camX) / zoom - NodeTypes.NODE_W / 2;
    let wy = (H / 2 - camY) / zoom - NodeTypes.NODE_H / 2;
    let autoConnected = false;

    // If a single node is selected and can accept children, position below it
    if (selectedIds.size === 1) {
      const parentId = [...selectedIds][0];
      const parent = nodeById[parentId];
      if (parent && NodeTypes.maxChildren(parent.type) > 0 && parent.children.length < NodeTypes.maxChildren(parent.type)) {
        wx = parent.x + (parent.children.length * 40);
        wy = parent.y + NodeTypes.NODE_H + 60;
        autoConnected = true;
      }
    }

    const node = {
      id: Serialization.uid(),
      type,
      category: NodeTypes.categoryOf(type),
      name: type.charAt(0).toUpperCase() + type.slice(1),
      children: [],
      parameters: NodeTypes.defaultParams(type),
      x: snap(wx),
      y: snap(wy),
    };
    state.nodes.push(node);
    rebuildLookup();
    if (state.nodes.length === 1) state.root = node.id;

    if (autoConnected) {
      const parentId = [...selectedIds][0];
      const parent = nodeById[parentId];
      if (parent) parent.children.push(node.id);
    }

    spawnAnims.set(node.id, performance.now());
    selectedIds.clear();
    selectedIds.add(node.id);
    if (onSelect) onSelect([node.id]);
    if (onChanged) onChanged();
  }

  function zoomBy(factor) {
    const newZoom = Math.max(0.15, Math.min(4, zoom * factor));
    targetCamX = W / 2 - (W / 2 - camX) * (newZoom / zoom);
    targetCamY = H / 2 - (H / 2 - camY) * (newZoom / zoom);
    targetZoom = newZoom;
    animating = true;
  }

  function focusRoot() {
    const root = nodeById[state.root];
    if (root) focusNode(root.id);
    else centerView(true);
  }

  function zoomToSelection() {
    const ids = [...selectedIds];
    if (ids.length === 0) { centerView(true); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const n = nodeById[id];
      if (!n) continue;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NodeTypes.NODE_W);
      maxY = Math.max(maxY, n.y + NodeTypes.NODE_H);
    }
    const tw = maxX - minX, th = maxY - minY;
    const z = Math.min(2, Math.min((W - 100) / tw, (H - 100) / th));
    targetCamX = (W - tw * z) / 2 - minX * z;
    targetCamY = (H - th * z) / 2 - minY * z;
    targetZoom = z;
    animating = true;
  }

  function alignSelected(mode) {
    const ids = [...selectedIds];
    if (ids.length < 2) return;
    const nodes = ids.map(id => nodeById[id]).filter(Boolean);
    const nw = NodeTypes.NODE_W, nh = NodeTypes.NODE_H;

    if (mode === "left") {
      const minX = Math.min(...nodes.map(n => n.x));
      for (const n of nodes) n.x = minX;
    } else if (mode === "right") {
      const maxX = Math.max(...nodes.map(n => n.x + nw));
      for (const n of nodes) n.x = maxX - nw;
    } else if (mode === "center-h") {
      const avg = nodes.reduce((s, n) => s + n.x + nw / 2, 0) / nodes.length;
      for (const n of nodes) n.x = snap(avg - nw / 2);
    } else if (mode === "top") {
      const minY = Math.min(...nodes.map(n => n.y));
      for (const n of nodes) n.y = minY;
    } else if (mode === "bottom") {
      const maxY = Math.max(...nodes.map(n => n.y + nh));
      for (const n of nodes) n.y = maxY - nh;
    } else if (mode === "center-v") {
      const avg = nodes.reduce((s, n) => s + n.y + nh / 2, 0) / nodes.length;
      for (const n of nodes) n.y = snap(avg - nh / 2);
    } else if (mode === "distribute-h") {
      nodes.sort((a, b) => a.x - b.x);
      const minX = nodes[0].x, maxX = nodes[nodes.length - 1].x;
      const gap = (maxX - minX) / (nodes.length - 1);
      for (let i = 1; i < nodes.length - 1; i++) nodes[i].x = snap(minX + gap * i);
    } else if (mode === "distribute-v") {
      nodes.sort((a, b) => a.y - b.y);
      const minY = nodes[0].y, maxY = nodes[nodes.length - 1].y;
      const gap = (maxY - minY) / (nodes.length - 1);
      for (let i = 1; i < nodes.length - 1; i++) nodes[i].y = snap(minY + gap * i);
    }
    if (onChanged) onChanged();
  }

  function focusNode(id) {
    const n = nodeById[id];
    if (!n) return;
    targetCamX = W / 2 - (n.x + NodeTypes.NODE_W / 2) * zoom;
    targetCamY = H / 2 - (n.y + NodeTypes.NODE_H / 2) * zoom;
    targetZoom = zoom;
    animating = true;
    selectedIds.clear();
    selectedIds.add(id);
    pulseNode = { id, start: performance.now() };
    if (onSelect) onSelect([id]);
  }

  function extractSubtree(id) {
    const visited = new Set();
    function collect(nid) {
      if (visited.has(nid)) return;
      visited.add(nid);
      const n = nodeById[nid];
      if (n) for (const cid of n.children) collect(cid);
    }
    collect(id);
    const tree = { version: "1.0", root: id, nodes: {} };
    const layout = { version: "1.0", nodes: {} };
    for (const nid of visited) {
      const n = nodeById[nid];
      if (!n) continue;
      const entry = { id: n.id, type: n.type, category: n.category, name: n.name, children: n.children.filter(c => visited.has(c)), parameters: { ...n.parameters } };
      if (n.comment) entry.comment = n.comment;
      if (n.color) entry.color = n.color;
      tree.nodes[nid] = entry;
      layout.nodes[nid] = { x: n.x, y: n.y };
    }
    return { tree, layout, ids: visited };
  }

  function copySubtreeOf(id) {
    const visited = new Set();
    function collect(nid) {
      if (visited.has(nid)) return;
      visited.add(nid);
      const n = nodeById[nid];
      if (n) for (const cid of n.children) collect(cid);
    }
    collect(id);
    const idMap = {};
    const copies = [];
    for (const nid of visited) {
      const n = nodeById[nid];
      if (!n) continue;
      const newId = Serialization.uid();
      idMap[nid] = newId;
      copies.push({ ...n, id: newId, x: n.x + 40, y: n.y + 40, children: [...n.children], parameters: { ...n.parameters } });
    }
    for (const c of copies) c.children = c.children.filter(cid => idMap[cid]).map(cid => idMap[cid]);
    state.nodes.push(...copies);
    rebuildLookup();
    selectedIds.clear();
    copies.forEach(c => selectedIds.add(c.id));
    if (onSelect) onSelect([...selectedIds]);
    if (onChanged) onChanged();
  }

  function zoomToSubtree(rootId) {
    const ids = new Set();
    function collect(id) { if (ids.has(id)) return; ids.add(id); const n = nodeById[id]; if (n) for (const c of n.children) collect(c); }
    collect(rootId);
    if (ids.size === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const n = nodeById[id]; if (!n) continue;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NodeTypes.NODE_W); maxY = Math.max(maxY, n.y + NodeTypes.NODE_H);
    }
    const tw = maxX - minX, th = maxY - minY;
    const z = Math.min(2, Math.min((W - 100) / tw, (H - 100) / th));
    targetCamX = (W - tw * z) / 2 - minX * z;
    targetCamY = (H - th * z) / 2 - minY * z;
    targetZoom = z;
    animating = true;
  }

  function setSearchFilter(ids) { searchMatchIds = ids; }

  function enterConnectMode(fromId) {
    const n = nodeById[fromId];
    if (!n || NodeTypes.maxChildren(n.type) === 0) return false;
    if (n.children.length >= NodeTypes.maxChildren(n.type)) return false;
    connectMode = { fromId };
    cvs.style.cursor = "crosshair";
    return true;
  }

  function cancelConnectMode() {
    if (connectMode) { connectMode = null; cvs.style.cursor = "default"; return true; }
    if (reparentMode) { reparentMode = null; cvs.style.cursor = "default"; return true; }
    return false;
  }

  function enterReparentMode(childId) {
    reparentMode = { childId };
    cvs.style.cursor = "crosshair";
  }

  function nudgeSelected(dx, dy) {
    if (positionLocked) { if (onRejectReason) onRejectReason("Locked — Shift+L to unlock"); return; }
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      const n = nodeById[id];
      if (n) { n.x += dx; n.y += dy; }
    }
    if (onChanged) onChanged();
  }

  return {
    init, deleteSelected, autoLayout, animatedAutoLayout, getSelectedIds, setSelectedIds,
    getState, setState, centerView, copySelected, notifyChanged,
    toggleSnap, isSnapping, toggleCollapse, focusNode, isCollapsed,
    zoomToSelection, zoomBy, focusRoot, addNodeAtCenter, alignSelected, exportPNG, exportPNGBlob, selectSubtree,
    copySubtreeOf, extractSubtree, exportSVG, addNodeAt, setSearchFilter, zoomToSubtree,
    enterConnectMode, cancelConnectMode, enterReparentMode, nudgeSelected,
    triggerSpawn(ids) { const now = performance.now(); for (const id of ids) spawnAnims.set(id, now); },
    triggerStaggeredSpawn(ids) { const now = performance.now(); for (let i = 0; i < ids.length; i++) spawnAnims.set(ids[i], now + i * 30); },
    toggleLock() { positionLocked = !positionLocked; return positionLocked; },
    isLocked() { return positionLocked; },
    cycleConnectionStyle() {
      const styles = ["bezier", "straight", "step"];
      connectionStyle = styles[(styles.indexOf(connectionStyle) + 1) % styles.length];
      return connectionStyle;
    },
    getConnectionStyle() { return connectionStyle; },
    toggleExecOrder() { showExecOrder = !showExecOrder; return showExecOrder; },
    isExecOrder() { return showExecOrder; },
    toggleHeatmap() { replayHeatmap = !replayHeatmap; return replayHeatmap; },
    toggleFlowDots() { showFlowDots = !showFlowDots; return showFlowDots; },
    toggleBookmark(id) { if (bookmarks.has(id)) bookmarks.delete(id); else bookmarks.add(id); return bookmarks.has(id); },
    getBookmarks() { return [...bookmarks]; },
    isBookmarked(id) { return bookmarks.has(id); },
    isolateSubtree(id) { isolatedSubtree = id; },
    exitIsolation() { isolatedSubtree = null; },
    isIsolated() { return !!isolatedSubtree; },
    getIsolatedRoot() { return isolatedSubtree; },
    getZoom() { return zoom; },
    setZoom(z) { targetZoom = Math.max(0.1, Math.min(5, z)); targetCamX = W / 2 - (W / 2 - camX) * (targetZoom / zoom); targetCamY = H / 2 - (H / 2 - camY) * (targetZoom / zoom); animating = true; },
    setOnZoomChange(fn) { onZoomChange = fn; },
  };
})();
