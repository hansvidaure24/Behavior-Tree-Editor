import { NodeTypes } from './nodes.js';

export const Validation = (() => {
  function validateDetailed(state) {
    const warnings = [];
    if (state.nodes.length === 0) return warnings;
    if (!state.root) warnings.push({ msg: "No root node set", nodeId: null });
    else if (!state.nodes.find(n => n.id === state.root)) warnings.push({ msg: "Root references missing node", nodeId: null });
    const childSet = new Set();
    for (const n of state.nodes) n.children.forEach(c => childSet.add(c));
    const orphans = state.nodes.filter(n => n.id !== state.root && !childSet.has(n.id));
    for (const o of orphans) warnings.push({ msg: `"${o.name}" is orphaned`, nodeId: o.id });
    for (const n of state.nodes) {
      if (NodeTypes.categoryOf(n.type) === "leaf" && n.name === n.type.charAt(0).toUpperCase() + n.type.slice(1)) {
        warnings.push({ msg: `"${n.name}" has default name`, nodeId: n.id });
      }
    }
    for (const n of state.nodes) {
      if (NodeTypes.categoryOf(n.type) === "composite" && n.children.length === 0)
        warnings.push({ msg: `"${n.name}" (${n.type}) has no children`, nodeId: n.id });
      if (NodeTypes.categoryOf(n.type) === "composite" && n.children.length === 1)
        warnings.push({ msg: `"${n.name}" (${n.type}) has only 1 child — flatten with U`, nodeId: n.id });
    }
    for (const n of state.nodes) {
      if (NodeTypes.categoryOf(n.type) === "decorator" && n.children.length === 0)
        warnings.push({ msg: `"${n.name}" (${n.type}) needs a child`, nodeId: n.id });
    }
    const pc = {};
    for (const n of state.nodes) for (const cid of n.children) pc[cid] = (pc[cid] || 0) + 1;
    for (const [cid, count] of Object.entries(pc)) {
      if (count > 1) {
        const child = state.nodes.find(n => n.id === cid);
        if (child) warnings.push({ msg: `"${child.name}" has ${count} parents`, nodeId: cid });
      }
    }
    // Missing required parameters
    const required = { repeat: ["count"], cooldown: ["duration"], timeout: ["seconds"], parallel: ["policy"] };
    for (const n of state.nodes) {
      const reqs = required[n.type];
      if (reqs) {
        for (const k of reqs) {
          if (n.parameters[k] == null || n.parameters[k] === "") {
            warnings.push({ msg: `"${n.name}" (${n.type}) missing param "${k}"`, nodeId: n.id });
          }
        }
      }
    }
    // Duplicate leaf names
    const leafNames = {};
    for (const n of state.nodes) {
      if (n.type === "action" || n.type === "condition") {
        if (leafNames[n.name]) leafNames[n.name].push(n);
        else leafNames[n.name] = [n];
      }
    }
    for (const [name, nodes] of Object.entries(leafNames)) {
      if (nodes.length > 1 && nodes.some(a => nodes.some(b => a.id !== b.id && a.type !== b.type))) {
        warnings.push({ msg: `"${name}" used as both action and condition`, nodeId: nodes[0].id });
      }
    }
    // Duplicate names within same type (likely copy-paste oversight)
    const namesByType = {};
    for (const n of state.nodes) {
      const k = n.type + ":" + n.name;
      if (namesByType[k]) namesByType[k].push(n);
      else namesByType[k] = [n];
    }
    for (const [, dups] of Object.entries(namesByType)) {
      if (dups.length > 1 && (dups[0].type === "action" || dups[0].type === "condition")) {
        warnings.push({ msg: `${dups.length} ${dups[0].type}s named "${dups[0].name}" — intentional?`, nodeId: dups[0].id });
      }
    }
    return warnings;
  }

  function validate(state) {
    const warnings = [];
    if (state.nodes.length === 0) return warnings;
    if (!state.root) warnings.push("No root node set");
    else if (!state.nodes.find(n => n.id === state.root)) warnings.push("Root node references missing node");
    const childSet = new Set();
    for (const n of state.nodes) n.children.forEach(c => childSet.add(c));
    const orphans = state.nodes.filter(n => n.id !== state.root && !childSet.has(n.id));
    if (orphans.length > 0) warnings.push(`${orphans.length} orphan node(s): ${orphans.map(n => n.name).join(", ")}`);
    for (const n of state.nodes) {
      if (NodeTypes.categoryOf(n.type) === "leaf" && n.name === n.type.charAt(0).toUpperCase() + n.type.slice(1)) {
        warnings.push(`"${n.name}" has default name — rename to match your game action`);
        break;
      }
    }
    // Composites with no children
    for (const n of state.nodes) {
      if (NodeTypes.categoryOf(n.type) === "composite" && n.children.length === 0) {
        warnings.push(`"${n.name}" (${n.type}) has no children`);
      }
    }
    // Decorators with no children
    for (const n of state.nodes) {
      if (NodeTypes.categoryOf(n.type) === "decorator" && n.children.length === 0) {
        warnings.push(`"${n.name}" (${n.type}) needs exactly 1 child`);
      }
    }
    // Cycle detection
    const nodeMap = {};
    for (const n of state.nodes) nodeMap[n.id] = n;
    const visited = new Set(), inStack = new Set();
    function hasCycle(id) {
      if (inStack.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id); inStack.add(id);
      const n = nodeMap[id];
      if (n) for (const cid of n.children) { if (hasCycle(cid)) return true; }
      inStack.delete(id);
      return false;
    }
    for (const n of state.nodes) {
      if (hasCycle(n.id)) { warnings.push("Cycle detected in tree — fix before exporting"); break; }
    }
    // Children referencing non-existent nodes
    for (const n of state.nodes) {
      for (const cid of n.children) {
        if (!nodeMap[cid]) warnings.push(`"${n.name}" references missing child ${cid}`);
      }
    }
    // Multi-parent detection
    const parentCount = {};
    for (const n of state.nodes) {
      for (const cid of n.children) {
        parentCount[cid] = (parentCount[cid] || 0) + 1;
      }
    }
    for (const [cid, count] of Object.entries(parentCount)) {
      if (count > 1 && nodeMap[cid]) warnings.push(`"${nodeMap[cid].name}" has ${count} parents — trees must be acyclic`);
    }
    const disabledCount = state.nodes.filter(n => n.disabled).length;
    if (disabledCount > 0) warnings.push(`${disabledCount} disabled node(s) — will be skipped at runtime`);
    return warnings;
  }

  return { validateDetailed, validate };
})();
