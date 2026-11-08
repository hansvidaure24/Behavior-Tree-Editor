// @ts-check
/** @import { SerializedTree, SerializedLayout } from './types.js' */
/** Undo/redo stack — stores JSON snapshots of the full editor state. */
export const History = (() => {
  const stack = [];
  let index = -1;
  let onChange = null;

  function snapshot(state) {
    return JSON.stringify(state);
  }

  function diffSummary(prev, next) {
    if (!prev || !next) return "";
    const p = JSON.parse(prev), n = JSON.parse(next);
    const pNodes = Object.keys(p.tree?.nodes || {}), nNodes = Object.keys(n.tree?.nodes || {});
    const added = nNodes.filter(id => !pNodes.includes(id)).length;
    const removed = pNodes.filter(id => !nNodes.includes(id)).length;
    if (added > 0 && removed === 0) return `+${added} node${added > 1 ? "s" : ""}`;
    if (removed > 0 && added === 0) return `-${removed} node${removed > 1 ? "s" : ""}`;
    if (added > 0 && removed > 0) return `+${added}/-${removed} nodes`;
    return "edit";
  }

  return {
    /** @param {(snapshot: {tree: SerializedTree, layout: SerializedLayout}, msg: string) => void} cb Called with the restored snapshot after undo/redo/jump. */
    init(cb) { onChange = cb; },

    /**
     * Record a snapshot (no-op if identical to the current one). Keeps the last 100.
     * @param {{tree: SerializedTree, layout: SerializedLayout}} state
     */
    push(state) {
      const s = snapshot(state);
      if (index >= 0 && stack[index] === s) return;
      stack.length = index + 1;
      stack.push(s);
      index++;
      if (stack.length > 100) {
        stack.shift();
        index--;
      }
    },

    /** @returns {{tree: SerializedTree, layout: SerializedLayout} | null} The restored snapshot, or null at the start of history. */
    undo() {
      if (index <= 0) return null;
      const summary = diffSummary(stack[index - 1], stack[index]);
      index--;
      const s = JSON.parse(stack[index]);
      if (onChange) onChange(s, "Undo" + (summary ? ": " + summary : ""));
      return s;
    },

    /** @returns {{tree: SerializedTree, layout: SerializedLayout} | null} */
    redo() {
      if (index >= stack.length - 1) return null;
      const summary = diffSummary(stack[index], stack[index + 1]);
      index++;
      const s = JSON.parse(stack[index]);
      if (onChange) onChange(s, "Redo" + (summary ? ": " + summary : ""));
      return s;
    },

    /** @returns {boolean} */
    canUndo() { return index > 0; },
    /** @returns {boolean} */
    canRedo() { return index < stack.length - 1; },
    /** @returns {number} */
    getUndoCount() { return index; },
    /** @returns {number} */
    getRedoCount() { return stack.length - 1 - index; },
    /** @returns {number} */
    getIndex() { return index; },
    /**
     * One entry per snapshot, for the undo-history panel.
     * @returns {{index: number, summary: string, current: boolean}[]}
     */
    getEntries() {
      const entries = [];
      for (let i = 0; i < stack.length; i++) {
        const summary = i === 0 ? "Initial" : diffSummary(stack[i - 1], stack[i]);
        entries.push({ index: i, summary: summary || "edit", current: i === index });
      }
      return entries;
    },
    /**
     * @param {number} targetIndex
     * @returns {{tree: SerializedTree, layout: SerializedLayout} | null}
     */
    jumpTo(targetIndex) {
      if (targetIndex < 0 || targetIndex >= stack.length) return null;
      index = targetIndex;
      const s = JSON.parse(stack[index]);
      if (onChange) onChange(s, "Jump to step " + targetIndex);
      return s;
    },
    /** Drop all snapshots (used when switching tabs). */
    clear() { stack.length = 0; index = -1; },
  };
})();
