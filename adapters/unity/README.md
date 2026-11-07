# Unity runtime (BehaviorTreeRuntime)

Runs `.bt.json` trees exported by the Behavior Tree Editor. Plain C# with one optional MonoBehaviour; no
packages, no editor extensions. Used in [Hold Steadfast](#hold-steadfast) to drive enemy AI.

## Install

Copy this folder into your project, e.g. `Assets/Plugins/BehaviorTreeRuntime/`. It has its own assembly
definition (`BehaviorTreeRuntime`); reference it from your game's asmdef if you use one. `Tests/` holds
EditMode tests (Window → General → Test Runner) and can be deleted.

## Quick start

1. Add **Behavior Tree Runner** to a GameObject and drag your `.bt.json` onto *Tree Asset*.
2. Bind the tree's actions and conditions by node name (case, spaces and punctuation are ignored, so a
   node named `Move To Target` binds to `"MoveToTarget"`):

```csharp
using BehaviorTreeRuntime;
using UnityEngine;
using UnityEngine.AI;

[RequireComponent(typeof(BehaviorTreeRunner))]
public class GuardBindings : MonoBehaviour
{
    void Awake()
    {
        var agent = GetComponent<NavMeshAgent>();
        var b = GetComponent<BehaviorTreeRunner>().Bindings;

        b.RegisterCondition("Has Target", ctx => ctx.Blackboard.Has("target"));
        b.RegisterAction("Move To Target",
            onTick: ctx =>
            {
                var target = ctx.Blackboard.Get<Transform>("target");
                agent.speed = ctx.Params.GetFloat("speed", 3.5f);      // node parameter from the editor
                agent.SetDestination(target.position);
                return agent.remainingDistance <= agent.stoppingDistance ? NodeStatus.Success : NodeStatus.Running;
            },
            onAbort: ctx => agent.ResetPath());                         // a higher-priority branch took over
    }
}
```

The editor's **Export → Unity C# Adapter** writes this file for you with a stub per action/condition.

Conditions and guards with `key` / `op` / `value` parameters need no code: they compare a blackboard value
(`op`: `eq`, `ne`, `lt`, `gt`, `le`, `ge`). Anything unbound fails and logs one warning — a missing binding is
never mistaken for success.

For actions that keep state, register a factory that returns one `IBTAction` (or `BTAction` subclass) per node:

```csharp
b.RegisterActionFactory("Patrol", ctx => new PatrolAction(waypoints));
```

## How the tree runs

`BehaviorTree.Tick(deltaTime)` evaluates from the root. Each node gets `OnEnter` on its first tick,
`OnExit` when it finishes, `OnAbort` when a parent cuts it off while Running.

| Node | Behaviour | Parameters |
|---|---|---|
| selector | Tries children top-down every tick; a higher branch pre-empts (aborts) a running lower one. Committed branches finish first. | |
| sequence | Fails on the first failure. While a child runs, earlier **conditions** are re-checked each tick; earlier actions are not re-run. | |
| parallel | Ticks unfinished children together; aborts the rest when done. | `policy`: `fail_on_one` (default), `succeed_on_one`, `succeed_on_all` |
| invert | Success ↔ Failure. | |
| repeat | Child succeeds `count` times (one run per tick), then Success; fails if the child fails. | `count` (≤ 0 = forever) |
| cooldown | Fails while cooling down; starts when the child succeeds. | `duration`, or `min` + `max` for a random range |
| timeout | Aborts the child and fails after `seconds` of running. | `seconds` |
| guard | Runs the child only while its condition holds (binding by the guard's name, or `key`/`op`/`value`). | `key`, `op`, `value` |
| action / condition | Game code bound by name. Actions can declare themselves non-interruptible (committed attacks). | anything — read with `ctx.Params` |

Disabled nodes (the editor's *Disable*) are left out, as if deleted.

`BTContext` gives bound code the `Blackboard`, the node's `Params`, `Time`, `DeltaTime`, `ElapsedInNode` and
the tree `Owner` (the runner sets its GameObject).

## Runner options

- **Tick Interval** — seconds between ticks; 0 ticks every frame.
- **Debug Log** — logs every node status change and abort, e.g.
  `[BT Gravewarden] t=4.30 action "Attack" → Running`. Clicking the line selects the agent.
- **Reload On Change** (Editor) — when the `.bt.json` is re-imported (save from the editor, then focus Unity),
  the tree is rebuilt in Play mode, keeping the blackboard. A file with errors is reported and the current tree
  keeps running.

`runner.LoadFromJson(text)` loads a tree from anywhere at runtime (StreamingAssets, a download, a mod).

## Replays

Add **Tick Recorder** next to the runner (or call `recorder.Attach(tree)`). It keeps the last N ticks and saves
a `.replay.json` (context menu *Save Recording*, or automatically on destroy). Drop it on the editor to scrub
through what the agent actually did; nodes that didn't run in a tick show as skipped.

## Without the MonoBehaviour

```csharp
var tree = BehaviorTree.FromJson(json, bindings);   // throws BehaviorTreeLoadException listing every problem
tree.Owner = this;
tree.Tick(0.1f);                                    // e.g. from a 10 Hz server loop
tree.Abort();                                       // stagger, death, despawn
```

## Hold Steadfast

Hold Steadfast's enemies already had a behavior tree runtime (`EnemyBrain`, `BehaviorTreeSO`). The integration
lets an `EnemyDefinitionSO` point at a `.bt.json` instead: this runtime runs the composites and decorators, and
every leaf is the game's own node (`MoveToTarget`, `Attack`, `IsPlayerInRange`, ...), bound through
`EditorTreeLoader`. An EditMode test runs each of the game's trees both ways for thousands of ticks against a
scripted world and requires identical decisions.
