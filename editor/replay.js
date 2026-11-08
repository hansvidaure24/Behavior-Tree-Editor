// @ts-check
/** @import { ReplayData, ReplayFrame, TickStatus } from './types.js' */
/** Replay debugger — loads tick recordings and visualizes execution on the tree. */
export const Replay = (() => {
  let data = null;       // full replay JSON
  let currentTick = 0;
  let playing = false;
  let playInterval = null;
  let speed = 1;         // ticks per frame at 60fps
  let onTickChange = null;

  const STATUS_COLORS = {
    success: "#22c55e",
    failure: "#ef4444",
    running: "#f59e0b",
    skipped: "#555555",
  };

  /** @param {ReplayData} replayData */
  function load(replayData) {
    data = replayData;
    currentTick = 0;
    playing = false;
    if (playInterval) clearInterval(playInterval);
    playInterval = null;
    if (onTickChange) onTickChange();
  }

  function unload() {
    data = null;
    currentTick = 0;
    playing = false;
    if (playInterval) clearInterval(playInterval);
    playInterval = null;
    if (onTickChange) onTickChange();
  }

  /** @returns {boolean} */
  function isActive() { return data !== null; }
  /** @returns {boolean} */
  function isPlaying() { return playing; }
  /** @returns {number} */
  function getTickCount() { return data ? data.ticks.length : 0; }
  /** @returns {number} */
  function getCurrentTick() { return currentTick; }
  /** @returns {ReplayData | null} */
  function getData() { return data; }

  /** @returns {ReplayFrame | null} */
  function getCurrentFrame() {
    if (!data || currentTick >= data.ticks.length) return null;
    return data.ticks[currentTick];
  }

  /**
   * @param {string} nodeId
   * @returns {TickStatus | null} null when the node wasn't visited this tick.
   */
  function getNodeStatus(nodeId) {
    const frame = getCurrentFrame();
    if (!frame || !frame.nodes[nodeId]) return null;
    return frame.nodes[nodeId].status;
  }

  /**
   * @param {string} nodeId
   * @returns {string | null} CSS color for the node's current status.
   */
  function getStatusColor(nodeId) {
    const status = getNodeStatus(nodeId);
    return status ? STATUS_COLORS[status] || null : null;
  }

  /** @returns {Record<string, any>} Blackboard snapshot at the current tick. */
  function getBlackboard() {
    const frame = getCurrentFrame();
    return frame ? frame.blackboard || {} : {};
  }

  /** @param {number} t */
  function setTick(t) {
    if (!data) return;
    currentTick = Math.max(0, Math.min(t, data.ticks.length - 1));
    if (onTickChange) onTickChange();
  }

  function stepForward() {
    if (!data) return;
    if (currentTick < data.ticks.length - 1) {
      currentTick++;
      if (onTickChange) onTickChange();
    } else {
      pause();
    }
  }

  function stepBack() {
    if (!data) return;
    if (currentTick > 0) {
      currentTick--;
      if (onTickChange) onTickChange();
    }
  }

  function play() {
    if (!data || playing) return;
    playing = true;
    const ms = Math.max(16, Math.round(16 / speed));
    playInterval = setInterval(() => {
      if (currentTick < data.ticks.length - 1) {
        currentTick++;
        if (onTickChange) onTickChange();
      } else {
        pause();
      }
    }, ms);
  }

  function pause() {
    playing = false;
    if (playInterval) clearInterval(playInterval);
    playInterval = null;
  }

  /** @param {number} s Ticks advanced per animation frame. */
  function setSpeed(s) {
    speed = s;
    if (playing) { pause(); play(); }
  }

  /** @param {() => void} cb Called whenever the current tick or loaded data changes. */
  function init(cb) {
    onTickChange = cb;
  }

  // Find when a specific node changed status (for "why did it change?")
  /**
   * Next tick (searching in `direction`) where this node's status differs from now.
   * @param {string} nodeId
   * @param {1 | -1} direction
   * @returns {number}
   */
  function findStatusChange(nodeId, direction) {
    if (!data) return currentTick;
    const currentStatus = getNodeStatus(nodeId);
    let t = currentTick;
    while (direction > 0 ? t < data.ticks.length - 1 : t > 0) {
      t += direction;
      const frame = data.ticks[t];
      const status = frame.nodes[nodeId]?.status;
      if (status !== currentStatus) return t;
    }
    return currentTick;
  }

  /** @returns {Record<string, number>} Visit frequency per node id, normalized to 0..1. */
  function getHeatmap() {
    if (!data) return {};
    const counts = {};
    let max = 0;
    for (const tick of data.ticks) {
      for (const [id, info] of Object.entries(tick.nodes)) {
        if (info.status && info.status !== "skipped") {
          counts[id] = (counts[id] || 0) + 1;
          if (counts[id] > max) max = counts[id];
        }
      }
    }
    const heat = {};
    for (const [id, c] of Object.entries(counts)) heat[id] = max > 0 ? c / max : 0;
    return heat;
  }

  /**
   * @param {string} nodeId
   * @returns {(TickStatus | null)[]} Status at every tick.
   */
  function getNodeTimeline(nodeId) {
    if (!data) return [];
    return data.ticks.map(t => t.nodes[nodeId]?.status || null);
  }

  return {
    load, unload, isActive, isPlaying, getTickCount, getCurrentTick,
    getData, getCurrentFrame, getNodeStatus, getStatusColor, getBlackboard,
    setTick, stepForward, stepBack, play, pause, setSpeed,
    init, findStatusChange, STATUS_COLORS, getHeatmap, getNodeTimeline,
  };
})();
