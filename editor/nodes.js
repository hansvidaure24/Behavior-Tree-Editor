/** Node type definitions and rendering config. */
export const NodeTypes = (() => {
  const COLORS = {
    composite: { fill: "#1b4332", stroke: "#95d5b2", text: "#95d5b2" },
    decorator: { fill: "#4a3728", stroke: "#e09f3e", text: "#e09f3e" },
    leaf:      { fill: "#3c1642", stroke: "#c77dff", text: "#c77dff" },
  };

  const COLORS_LIGHT = {
    composite: { fill: "#d4edda", stroke: "#28a745", text: "#155724" },
    decorator: { fill: "#fce8cd", stroke: "#d68910", text: "#7a4f1e" },
    leaf:      { fill: "#e8d5f5", stroke: "#8e44ad", text: "#5b2d8e" },
  };

  const ICONS = {
    sequence:  "→",
    selector:  "?",
    parallel:  "∥",
    action:    "▶",
    condition: "✔",
    invert:    "!",
    repeat:    "↻",
    cooldown:  "⏱",
    timeout:   "⏰",
    guard:     "⛨",
  };

  const CATEGORIES = {
    sequence: "composite", selector: "composite", parallel: "composite",
    action: "leaf", condition: "leaf",
    invert: "decorator", repeat: "decorator", cooldown: "decorator", timeout: "decorator", guard: "decorator",
  };

  const DESCRIPTIONS = {
    sequence:  "Runs children left-to-right; fails on first failure",
    selector:  "Runs children left-to-right; succeeds on first success",
    parallel:  "Runs all children simultaneously",
    action:    "Leaf node that performs a game action",
    condition: "Leaf node that checks a boolean condition",
    invert:    "Inverts child result (success↔failure)",
    repeat:    "Repeats child N times",
    cooldown:  "Blocks re-entry for a duration after running",
    timeout:   "Fails child if it runs too long",
    guard:     "Runs child only if a condition is met",
  };

  const DEFAULT_PARAMS = {
    repeat: { count: 3 },
    cooldown: { duration: 2 },
    timeout: { seconds: 5 },
    parallel: { policy: "fail_on_one" },
  };

  const SUGGESTED_PARAMS = {
    action: ["target", "speed", "duration", "range", "animation"],
    condition: ["key", "op", "value"],
    guard: ["key", "op", "value"],
    repeat: ["count"],
    cooldown: ["duration"],
    timeout: ["seconds"],
    parallel: ["policy"],
  };

  const NODE_W = 160;
  const NODE_H = 54;
  const PORT_R = 7;

  function isLight() { return document.body.classList.contains("light"); }

  function colors(category) {
    const pal = isLight() ? COLORS_LIGHT : COLORS;
    return pal[category] || pal.leaf;
  }

  function categoryOf(type) {
    return CATEGORIES[type] || "leaf";
  }

  function maxChildren(type) {
    const cat = CATEGORIES[type];
    if (cat === "leaf") return 0;
    if (cat === "decorator") return 1;
    return Infinity;
  }

  function allTypes() {
    return Object.keys(CATEGORIES);
  }

  function defaultParams(type) {
    return DEFAULT_PARAMS[type] ? { ...DEFAULT_PARAMS[type] } : {};
  }

  const NODE_COLORS = [
    null, "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
  ];
  const NODE_COLOR_LABELS = [
    "Default", "Red", "Amber", "Green", "Blue", "Purple", "Pink", "Teal", "Orange",
  ];

  function suggestedParams(type) { return SUGGESTED_PARAMS[type] || []; }

  return { COLORS, ICONS, CATEGORIES, DESCRIPTIONS, NODE_W, NODE_H, PORT_R, NODE_COLORS, NODE_COLOR_LABELS, colors, categoryOf, maxChildren, allTypes, defaultParams, suggestedParams };
})();
