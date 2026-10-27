# Behavior Tree Editor — Market Research

## Existing Tools

### Unity-Integrated (Paid)

| Tool | Price | Notes |
|---|---|---|
| Behavior Designer (Opsive) | $95 | Most popular on Asset Store (~762 reviews). BT only. Add-on packs extra |
| NodeCanvas (Paradox Notion) | $120 | BT + FSM + Dialogue. 369 reviews, 4.7/5. Full source. Maintained since 2014 |
| Arbor (MoodLab) | ~$45 | Japanese-developed. BT + FSM. Less community outside Japan |
| Emerald AI | $65 | Bundles BT with full NPC system, not standalone |

### Unity-Integrated (Free/Open Source)

| Tool | Notes |
|---|---|
| FluidBT | Code-first fluent API, no visual editor. Free on GitHub |
| Unity Behavior (official) | Released 2024, DOTS-adjacent, still maturing. Ships with Unity 6 |
| xNode | Graph framework, not BT-specific. 3.7k stars |
| DOTS-BehaviorTree | 101 stars, ECS + Burst, no visual editor |

### Engine-Agnostic / Standalone

| Tool | Price | Platform | Notes |
|---|---|---|---|
| BehaviorTree.CPP + Groot2 | Free (lib) / €590/yr PRO | C++ / ROS2 | Most-used in robotics. 3,700+ stars. Groot2 free tier capped at 20-node monitoring |
| behavior3editor | Free (MIT) | Web (Electron/React) | Exports JSON. ~700 stars, appears dormant. Chrome/Opera only |
| behavior-studio | Free | Python | 40 stars. Exports XML. Minimal traction |
| Behaviac (Tencent) | Free | C++ / C# / Python | BT + FSM + HTN. Mostly Chinese docs |

### Other

| Tool | Notes |
|---|---|
| py_trees | Python, MIT. Robotics/ROS2 focus. No visual editor |
| Godot BT addons | Community plugins, all small/experimental |
| Unreal built-in BT editor | Solid, ships with UE. Not available outside Unreal |

---

## What They Get Wrong

### Pricing
- $95–$120 barrier for indie devs
- Groot2 PRO at €590/year for debugging features
- Add-on packs (Behavior Designer) push total past $200

### Version Control
- Unity tools serialize to binary/bloated XML — massive unreadable diffs
- NodeCanvas JSON includes layout positions — merging branches is painful
- No structured merge support anywhere

### Runtime Debugging
- Most tools highlight "currently executing node" — that's it
- No replay/history: bug 2 seconds ago = missed it
- No timeline view, no conditional breakpoints in free tiers
- "Why did the AI do that?" is unanswerable

### Engine Lock-In
- Behavior Designer / NodeCanvas only run inside Unity Editor
- No export to other engines or runtime-agnostic formats
- Designers can't edit without opening Unity

### UX
- Large trees become unmanageable — no auto-layout, no grouping/folding
- Groot2 gates node search behind paywall
- No way to annotate nodes with design intent

### Collaboration
- Zero tools support real-time collaborative editing
- No web-based editing = designers need full engine installed
- No commenting, review, or approval workflows

### AI / Automation
- No tool generates trees from natural language
- No suggestion system for common patterns
- No analytics on branch execution frequency

---

## Market Gaps (Ranked by How Underserved)

1. **Real-time replay debugger** — nobody does this well for games at any price
2. **Git-native serialization** — every tool gets this wrong; studios feel the pain daily
3. **Standalone web editor** (engine-agnostic) — behavior3editor died in this spot; demand is real
4. **AI-assisted tree authoring** — completely empty; first mover advantage
5. **Cross-engine runtime + thin adapters** — Unity + Unreal + Godot with one editor
6. **Playtest analytics** — heat maps over nodes, dead branch detection. Zero tools do this
7. **Dialogue + BT unification** — NodeCanvas combines them shallowly; no standalone tool does it

---

## Technical Reference

### Standard Node Types

| Category | Types |
|---|---|
| Composite | Sequence (AND), Selector (OR), Parallel (configurable policy) |
| Decorator | Invert, Repeat, RepeatUntilFail, Cooldown, Timeout, Guard |
| Leaf | Action (Running/Success/Failure), Condition (instant query) |
| Advanced | Dynamic Guard Selector, Subtree reference, Event-driven interrupts |

### Serialization Formats

| Format | Used By | Notes |
|---|---|---|
| XML | BehaviorTree.CPP, Unity Behavior | Human-readable, verbose, decent diff |
| JSON | behavior3editor, many custom | Compact, diff-friendly if formatted |
| ScriptableObject (binary) | NodeCanvas, Behavior Designer | Fast in Unity, terrible for VCS |
| Code-first | FluidBT, custom | Best perf, no visual editor |

### Runtime Patterns

- **Blackboard** — shared key-value store per agent. Industry standard
- **Tick model** — traverse from root each frame or fixed interval
- **Event-driven interrupts** — re-evaluate subtrees on trigger, reduces polling
- **Token/object pooling** — avoid per-tick GC. Critical for consoles
- **Async actions** — return Running while in-flight, don't block the tree

---

## Cross-Industry Use

| Industry | Notes |
|---|---|
| Robotics | BehaviorTree.CPP is de facto standard. ROS2 Nav2, MoveIt, 100+ companies |
| Autonomous vehicles | Mission planning layers. Need formal verification |
| Game AI | The established market above |
| Dialogue | Ink/Yarn/Twine dominate but share graph structure with BTs |
| Manufacturing | Emerging use for robot cell orchestration. Underserved |

Robotics + games share ~80% of node vocabulary and the same debugging/serialization problems. A tool targeting both has a larger addressable market than Unity-only players.
