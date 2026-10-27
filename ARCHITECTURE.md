# BehaviorTreeEditor

Web-based visual behavior tree editor. Standalone tool that exports to game engines (Unity, Unreal, Godot). Built for game designers and robotics engineers who shouldn't need a full engine open to edit AI.

## What This Is

A visual node-graph editor for authoring, debugging, and exporting behavior trees. Runs in the browser. Exports clean JSON that engines consume via thin adapters.

## Key Differentiators

1. **Replay debugger** — record tree execution ticks, scrub back in time, answer "why did the AI do that?"
2. **Git-friendly serialization** — structured JSON, no layout coordinates in logic files, line-level diffs that make sense
3. **Web-native** — runs in browser, no engine install required for designers
4. **AI-assisted authoring** — describe behavior in plain English, get a starting tree
5. **Cross-engine export** — JSON + thin runtime adapters for Unity (C#), Unreal (C++), Godot (GDScript)

## Tech Stack

- **Editor frontend:** Vanilla JS + Canvas, no frameworks, no build step
- **Storage:** IndexedDB + File System Access API (no server required)
- **Serialization:** JSON (logic) + separate layout sidecar
- **Runtime adapters:** C# (Unity), C++ (Unreal), GDScript (Godot)
- **AI generation:** Ollama (local, browser talks directly to localhost:11434) + regex pattern fallback
- **Validation CLI:** `python validate.py *.bt.json` for CI/pre-commit hooks

## Running

Open `editor/index.html` in a browser. No server, no install, no build step. Can also deploy `editor/` to any static host (GitHub Pages, S3, etc). PWA-capable — works offline.

## Project Docs

- **Research.md** — Market research, existing tools, gaps, technical reference

## Architecture Decisions

- Trees are data (JSON), not code. The editor authors data. Engine runtimes interpret it
- Layout coordinates stored in separate `.layout.json` files — never pollute the logic file
- Standard node types: Composite (Sequence, Selector, Parallel), Decorator (Invert, Repeat, Cooldown, Timeout, Guard), Leaf (Action, Condition)
- Blackboard pattern for per-agent state
- Storage: IndexedDB for local saves + versioning, File System Access API for direct disk read/write to engine project folders, bundled examples in examples.json
- No server dependency — Python server (server/main.py) still exists for reference but is not required

## Related Project

Hold Steadfast at `../HoldSteadfast/` — the Unity game this editor will serve. Already has `BehaviorTreeSO` assets and 10 enemy behavior trees. The Unity adapter should consume the same JSON format these trees define.
