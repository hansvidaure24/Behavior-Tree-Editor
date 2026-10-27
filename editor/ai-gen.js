import { Serialization } from './serialization.js';
import { Storage } from './storage.js';

/** AI-assisted tree generation — fuzzy search over saved templates + built-in patterns. */
export const AIGen = (() => {
  let uid = () => Serialization.uid();
  let _index = null; // Fuse instance, built lazily
  let _templates = []; // raw template entries

  // --- Built-in patterns (always available, even before templates load) ---
  const PATTERNS = [
    { match: /patrol|wander|roam/i, nodes: () => {
      const walk = { id: uid(), type: "action", category: "leaf", name: "Walk To Waypoint", children: [], parameters: { speed: 2.0 } };
      const wait = { id: uid(), type: "action", category: "leaf", name: "Wait At Point", children: [], parameters: { duration: 3.0 } };
      const seq = { id: uid(), type: "sequence", category: "composite", name: "Patrol", children: [walk.id, wait.id], parameters: {} };
      return { root: seq, all: [seq, walk, wait] };
    }},
    { match: /chase|pursue|follow/i, nodes: () => {
      const cond = { id: uid(), type: "condition", category: "leaf", name: "Has Target", children: [], parameters: { key: "has_target" } };
      const move = { id: uid(), type: "action", category: "leaf", name: "Move To Target", children: [], parameters: { speed: 5.0 } };
      const seq = { id: uid(), type: "sequence", category: "composite", name: "Chase", children: [cond.id, move.id], parameters: {} };
      return { root: seq, all: [seq, cond, move] };
    }},
    { match: /attack|fight|combat|hit|strike/i, nodes: () => {
      const range = { id: uid(), type: "condition", category: "leaf", name: "In Attack Range", children: [], parameters: { key: "target_distance", op: "lt", value: 2.5 } };
      const atk = { id: uid(), type: "action", category: "leaf", name: "Attack Target", children: [], parameters: { damage: 10 } };
      const cd = { id: uid(), type: "cooldown", category: "decorator", name: "Attack Cooldown", children: [atk.id], parameters: { duration: 1.0 } };
      const seq = { id: uid(), type: "sequence", category: "composite", name: "Attack", children: [range.id, cd.id], parameters: {} };
      return { root: seq, all: [seq, range, cd, atk] };
    }},
    { match: /flee|run away|escape|retreat/i, nodes: () => {
      const cond = { id: uid(), type: "condition", category: "leaf", name: "Health Low", children: [], parameters: { key: "health_pct", op: "lt", value: 0.25 } };
      const flee = { id: uid(), type: "action", category: "leaf", name: "Flee From Threat", children: [], parameters: { speed: 7.0 } };
      const seq = { id: uid(), type: "sequence", category: "composite", name: "Flee", children: [cond.id, flee.id], parameters: {} };
      return { root: seq, all: [seq, cond, flee] };
    }},
    { match: /guard|defend|protect/i, nodes: () => {
      const see = { id: uid(), type: "condition", category: "leaf", name: "Can See Threat", children: [], parameters: { key: "threat_visible" } };
      const alert = { id: uid(), type: "action", category: "leaf", name: "Raise Alert", children: [], parameters: { radius: 15.0 } };
      const engage = { id: uid(), type: "action", category: "leaf", name: "Engage Threat", children: [], parameters: { speed: 4.0 } };
      const seq = { id: uid(), type: "sequence", category: "composite", name: "Guard", children: [see.id, alert.id, engage.id], parameters: {} };
      return { root: seq, all: [seq, see, alert, engage] };
    }},
    { match: /investigate|search|look/i, nodes: () => {
      const heard = { id: uid(), type: "condition", category: "leaf", name: "Heard Noise", children: [], parameters: { key: "noise_detected" } };
      const move = { id: uid(), type: "action", category: "leaf", name: "Move To Noise", children: [], parameters: { speed: 3.0 } };
      const look = { id: uid(), type: "action", category: "leaf", name: "Look Around", children: [], parameters: { duration: 3.0 } };
      const timeout = { id: uid(), type: "timeout", category: "decorator", name: "Search Timeout", children: [look.id], parameters: { seconds: 5 } };
      const seq = { id: uid(), type: "sequence", category: "composite", name: "Investigate", children: [heard.id, move.id, timeout.id], parameters: {} };
      return { root: seq, all: [seq, heard, move, timeout, look] };
    }},
    { match: /idle|wait|stand|rest/i, nodes: () => {
      const idle = { id: uid(), type: "action", category: "leaf", name: "Idle", children: [], parameters: { animation: "idle" } };
      return { root: idle, all: [idle] };
    }},
    { match: /heal|recover|regen/i, nodes: () => {
      const low = { id: uid(), type: "condition", category: "leaf", name: "Health Below 50%", children: [], parameters: { key: "health_pct", op: "lt", value: 0.5 } };
      const heal = { id: uid(), type: "action", category: "leaf", name: "Heal Self", children: [], parameters: { amount: 30 } };
      const cd = { id: uid(), type: "cooldown", category: "decorator", name: "Heal Cooldown", children: [heal.id], parameters: { duration: 10.0 } };
      const seq = { id: uid(), type: "sequence", category: "composite", name: "Heal", children: [low.id, cd.id], parameters: {} };
      return { root: seq, all: [seq, low, cd, heal] };
    }},
  ];

  // --- Template indexing ---

  function _nodeText(tree) {
    const nodes = tree.nodes || {};
    const list = Array.isArray(nodes) ? nodes : Object.values(nodes);
    return list.map(n => n.name || "").join(" ");
  }

  function _buildIndex(trees) {
    _templates = trees.map(t => ({
      name: t.name,
      title: t.tree.title || t.name,
      description: t.tree.description || "",
      nodeText: _nodeText(t.tree),
      data: t.tree,
    }));
    if (typeof globalThis.Fuse !== "undefined") {
      _index = new globalThis.Fuse(_templates, {
        keys: [
          { name: "title", weight: 3 },
          { name: "description", weight: 2 },
          { name: "nodeText", weight: 1 },
          { name: "name", weight: 1 },
        ],
        threshold: 0.4,
        includeScore: true,
        ignoreLocation: true,
      });
    }
  }

  async function loadTemplates() {
    try {
      const list = await Storage.listTrees();
      const trees = [];
      for (const entry of list) {
        try {
          const data = await Storage.loadTree(entry.dir, entry.name);
          if (data) trees.push({ name: entry.name, dir: entry.dir, tree: data.tree });
        } catch (e) { /* skip */ }
      }
      _buildIndex(trees);
    } catch (e) { /* templates unavailable, patterns still work */ }
  }

  // --- ID remapping for cloned trees ---

  function _remapIds(nodes) {
    const idMap = {};
    const list = Array.isArray(nodes) ? nodes : Object.values(nodes);
    const cloned = list.map(n => {
      const copy = JSON.parse(JSON.stringify(n));
      const newId = uid();
      idMap[copy.id] = newId;
      return copy;
    });
    for (const n of cloned) {
      n.id = idMap[n.id];
      n.children = (n.children || []).map(c => idMap[c] || c);
    }
    return { nodes: cloned, idMap };
  }

  function _extractSubtree(treeData, rootId) {
    const nodes = treeData.nodes || {};
    const byId = Array.isArray(nodes) ? Object.fromEntries(nodes.map(n => [n.id, n])) : nodes;
    const collected = [];
    const stack = [rootId];
    const seen = new Set();
    while (stack.length) {
      const nid = stack.pop();
      if (seen.has(nid) || !byId[nid]) continue;
      seen.add(nid);
      const node = JSON.parse(JSON.stringify(byId[nid]));
      if (!node.id) node.id = nid;
      collected.push(node);
      for (const cid of (node.children || [])) stack.push(cid);
    }
    return collected;
  }

  // --- Search + assemble ---

  function _fuseSearch(description) {
    if (!_index || !_templates.length) return [];
    const results = _index.search(description);
    return results.map(r => ({
      template: r.item,
      score: 1 - (r.score || 0), // Fuse score is 0=perfect, invert for us
    }));
  }

  function _assembleFromTemplates(description, results) {
    if (!results.length) return null;

    const best = results[0];
    // Single strong match — clone the whole tree
    if (results.length === 1 || best.score >= results[1].score * 1.5) {
      const tree = best.template.data;
      const rootId = tree.root;
      const subtree = _extractSubtree(tree, rootId);
      if (!subtree.length) return null;
      const { nodes, idMap } = _remapIds(subtree);
      return { root: idMap[rootId] || nodes[0].id, nodes };
    }

    // Multiple matches — combine top subtrees
    const allNodes = [];
    const rootChildren = [];
    for (const r of results.slice(0, 3)) {
      if (r.score < best.score * 0.5) break;
      const tree = r.template.data;
      const rootId = tree.root;
      const subtree = _extractSubtree(tree, rootId);
      if (!subtree.length) continue;
      const { nodes, idMap } = _remapIds(subtree);
      const newRoot = idMap[rootId] || nodes[0].id;
      allNodes.push(...nodes);
      rootChildren.push(newRoot);
    }
    if (!rootChildren.length) return null;
    if (rootChildren.length === 1) return { root: rootChildren[0], nodes: allNodes };

    const root = { id: uid(), type: "selector", category: "composite", name: "Root", children: rootChildren, parameters: {} };
    allNodes.unshift(root);
    return { root: root.id, nodes: allNodes };
  }

  // --- Main generate ---

  function generate(description) {
    // Try fuzzy template search first
    const results = _fuseSearch(description);
    if (results.length > 0) {
      const assembled = _assembleFromTemplates(description, results);
      if (assembled) {
        assembled._source = "templates";
        assembled._matches = results.slice(0, 3).map(r => r.template.title);
        return assembled;
      }
    }

    // Fall back to built-in patterns
    const desc = description.toLowerCase();
    const matched = [];
    for (const p of PATTERNS) {
      if (p.match.test(desc)) matched.push(p.nodes());
    }
    if (matched.length === 0) return null;
    if (matched.length === 1) {
      const m = matched[0];
      return { root: m.root.id, nodes: m.all, _source: "patterns" };
    }
    const allNodes = [];
    const rootChildren = [];
    for (const m of matched) {
      rootChildren.push(m.root.id);
      allNodes.push(...m.all);
    }
    const root = { id: uid(), type: "selector", category: "composite", name: "Root", children: rootChildren, parameters: {} };
    allNodes.unshift(root);
    return { root: root.id, nodes: allNodes, _source: "patterns" };
  }

  function getHints() {
    return [
      "patrol and attack enemies",
      "chase target, attack when close, flee when low health",
      "guard an area, investigate noises",
      "stealth assassin with backstab",
      "healer support, heal wounded allies",
      "boss with multiple phases",
      "turret defense, scan and fire",
      "companion that follows and helps",
    ];
  }

  return { generate, getHints, loadTemplates };
})();
