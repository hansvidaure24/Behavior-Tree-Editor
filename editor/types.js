// @ts-check
/**
 * Core data types shared across the editor. Type-only module: it is never imported at
 * runtime — other files reference these with `@import { ... } from './types.js'`.
 */

/** @typedef {"sequence"|"selector"|"parallel"|"action"|"condition"|"invert"|"repeat"|"cooldown"|"timeout"|"guard"} NodeType */
/** @typedef {"composite"|"decorator"|"leaf"} NodeCategory */

/**
 * A node as the editor holds it: logic plus canvas position.
 * (Named BTNode so it doesn't shadow the DOM's built-in `Node` type.)
 * @typedef {Object} BTNode
 * @property {string} id
 * @property {NodeType | string} type
 * @property {NodeCategory | string} category
 * @property {string} name
 * @property {string[]} children Ordered child ids — this list *is* the node's outgoing connections.
 * @property {Record<string, any>} parameters Node-specific config (e.g. cooldown `duration`, repeat `count`).
 * @property {number} x World-space position (persisted to the .bt.layout.json sidecar, never the logic file).
 * @property {number} y
 * @property {string} [comment]
 * @property {string} [color]
 * @property {boolean} [disabled]
 * @property {string} [description]
 */

/**
 * A parent → child edge. Connections are not stored separately; this is the shape the canvas
 * hands to callbacks (context menus, hover) when the user interacts with a drawn edge.
 * @typedef {Object} Connection
 * @property {string} parentId
 * @property {string} childId
 */

/**
 * The live editor document. One instance is shared by every module and mutated in place.
 * @typedef {Object} TreeState
 * @property {string} title
 * @property {string} description
 * @property {string} root Id of the root node ("" for an empty tree).
 * @property {BTNode[]} nodes
 * @property {Set<string>} [_warningIds] Node ids with validation warnings (set by updateWarnings, read by the canvas).
 */

/**
 * One node in a .bt.json file — see schemas/bt.schema.json.
 * @typedef {Object} SerializedNode
 * @property {string} id
 * @property {NodeType | string} type
 * @property {NodeCategory | string} category
 * @property {string} [name]
 * @property {string[]} [children]
 * @property {Record<string, any>} [parameters]
 * @property {string} [comment]
 * @property {string} [color]
 * @property {boolean} [disabled]
 * @property {string} [description]
 */

/**
 * Contents of a .bt.json file (schemas/bt.schema.json): tree logic only, no coordinates.
 * The export-only fields are added by "Export JSON" for engine runtimes and tooling.
 * @typedef {Object} SerializedTree
 * @property {string} version Always "1.0".
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} root
 * @property {Record<string, SerializedNode>} nodes Keyed by node id.
 * @property {string} [exportedAt]
 * @property {string} [editor]
 * @property {number} [nodeCount]
 * @property {number} [depth]
 * @property {number} [maxBreadth]
 * @property {number} [connectionCount]
 * @property {string[]} [decoratorTypes]
 * @property {string[]} [blackboardKeys]
 * @property {string[]} [actionNames]
 * @property {string[]} [conditionNames]
 */

/**
 * Contents of a .bt.layout.json sidecar: node positions only.
 * @typedef {Object} SerializedLayout
 * @property {string} [version]
 * @property {Record<string, {x: number, y: number}>} nodes
 */

/** @typedef {"success"|"failure"|"running"|"skipped"} TickStatus */

/**
 * One recorded tick in a .replay.json file (schemas/replay.schema.json).
 * @typedef {Object} ReplayFrame
 * @property {number} tick
 * @property {number} timestamp Game time in seconds.
 * @property {Record<string, {status: TickStatus}>} nodes Status of every node visited this tick.
 * @property {Record<string, any>} [blackboard] Blackboard snapshot after the tick.
 */

/**
 * Contents of a .replay.json file.
 * @typedef {Object} ReplayData
 * @property {string} version
 * @property {string} treeTitle
 * @property {string} [agentId]
 * @property {ReplayFrame[]} ticks
 */

/**
 * A validation finding. `nodeId` is null for tree-level problems.
 * @typedef {Object} Warning
 * @property {string} msg
 * @property {string|null} nodeId
 */

export {};
