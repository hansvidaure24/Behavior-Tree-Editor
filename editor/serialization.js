/** Converts between editor state and JSON format. */
export const Serialization = (() => {
  function uid() {
    return crypto.randomUUID().slice(0, 8);
  }

  function toJSON(editorState) {
    const tree = {
      version: "1.0",
      title: editorState.title || "Untitled",
      description: editorState.description || "",
      root: editorState.root || "",
      nodes: {},
    };
    const layout = { version: "1.0", nodes: {} };

    for (const node of editorState.nodes) {
      const entry = {
        id: node.id,
        type: node.type,
        category: node.category,
        name: node.name,
        children: [...node.children],
        parameters: { ...node.parameters },
      };
      if (node.comment) entry.comment = node.comment;
      if (node.color) entry.color = node.color;
      if (node.disabled) entry.disabled = true;
      if (node.description) entry.description = node.description;
      tree.nodes[node.id] = entry;
      layout.nodes[node.id] = { x: node.x, y: node.y };
    }
    return { tree, layout };
  }

  function fromJSON(treeData, layoutData) {
    const nodes = [];
    const layout = layoutData || { nodes: {} };

    for (const [id, n] of Object.entries(treeData.nodes)) {
      const pos = layout.nodes[id] || { x: 0, y: 0 };
      const node = {
        id: n.id,
        type: n.type,
        category: n.category,
        name: n.name || n.type,
        children: n.children || [],
        parameters: n.parameters || {},
        x: pos.x,
        y: pos.y,
      };
      if (n.comment) node.comment = n.comment;
      if (n.color) node.color = n.color;
      if (n.disabled) node.disabled = true;
      if (n.description) node.description = n.description;
      nodes.push(node);
    }

    return {
      title: treeData.title || "Untitled",
      description: treeData.description || "",
      root: treeData.root || "",
      nodes,
    };
  }

  return { uid, toJSON, fromJSON };
})();
