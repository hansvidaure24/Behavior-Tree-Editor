using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace BehaviorTreeRuntime
{
    /// <summary>
    /// A behavior tree built from a .bt.json file exported by the Behavior Tree Editor. Plain C#: tick it from
    /// a MonoBehaviour (<see cref="BehaviorTreeRunner"/>), a server loop, or a test.
    /// </summary>
    /// <example><code>
    /// var bindings = new BTBindings()
    ///     .RegisterCondition("Has Target", ctx => agent.HasTarget)
    ///     .RegisterAction("Move To Target", ctx => agent.MoveTo(ctx.Params.GetFloat("speed", 1f)),
    ///                     onAbort: ctx => agent.Stop());
    /// var tree = BehaviorTree.FromJson(jsonText, bindings);
    /// // every tick:
    /// tree.Tick(Time.deltaTime);
    /// </code></example>
    public sealed class BehaviorTree
    {
        readonly List<BTNode> _nodes = new List<BTNode>();
        readonly Dictionary<string, BTNode> _byId = new Dictionary<string, BTNode>();

        internal BehaviorTree(BTBindings bindings, Blackboard blackboard)
        {
            Bindings = bindings ?? new BTBindings();
            Blackboard = blackboard ?? new Blackboard();
            var rng = new System.Random();
            Random = () => (float)rng.NextDouble();
        }

        /// <summary>Parse and build a tree. Throws <see cref="BehaviorTreeLoadException"/> listing every problem found.</summary>
        public static BehaviorTree FromJson(string json, BTBindings bindings = null, Blackboard blackboard = null) =>
            TreeLoader.Load(json, bindings, blackboard);

        public string Title { get; internal set; } = "";
        public string Description { get; internal set; } = "";
        public BTNode Root { get; internal set; }
        /// <summary>Every enabled node, in file order (disabled nodes are left out of the tree).</summary>
        public IReadOnlyList<BTNode> Nodes => _nodes;
        public Blackboard Blackboard { get; }
        public BTBindings Bindings { get; }
        /// <summary>Anything bindings want to reach through <see cref="BTContext.Owner"/> — the agent.</summary>
        public object Owner { get; set; }

        public float Time { get; private set; }
        public float DeltaTime { get; private set; }
        /// <summary>Number of ticks run so far.</summary>
        public int TickCount { get; private set; }
        public NodeStatus LastStatus { get; private set; } = NodeStatus.Failure;
        /// <summary>Source of [0,1) randoms (cooldown ranges). Replace it to make runs deterministic.</summary>
        public Func<float> Random { get; set; }

        /// <summary>Log every node status change and abort to the Console.</summary>
        public bool DebugLog { get; set; }
        /// <summary>Prefix for log lines — e.g. the agent's name.</summary>
        public string DebugName { get; set; }
        /// <summary>Object highlighted when a log line is clicked in the Console.</summary>
        public UnityEngine.Object DebugContext { get; set; }

        /// <summary>Raised after every tick (TickRecorder listens to this).</summary>
        public event Action<BehaviorTree> Ticked;

        /// <summary>False while a committed branch (e.g. an attack) is running.</summary>
        public bool CanBeInterrupted => Root == null || Root.CanBeInterrupted;

        /// <summary>Advance tree time by <paramref name="deltaTime"/> and evaluate the tree once from the root.</summary>
        public NodeStatus Tick(float deltaTime)
        {
            TickCount++;
            DeltaTime = deltaTime;
            Time += deltaTime;
            LastStatus = Root != null ? Root.Tick() : NodeStatus.Failure;
            Ticked?.Invoke(this);
            return LastStatus;
        }

        /// <summary>Abort everything that is running (stagger, death, despawn, tree swap).</summary>
        public void Abort() => Root?.Abort();

        public BTNode FindById(string id) => id != null && _byId.TryGetValue(id, out var n) ? n : null;

        public BTNode FindByName(string name)
        {
            var key = BTBindings.Normalize(name);
            foreach (var n in _nodes) if (n.BindingKey == key) return n;
            return null;
        }

        internal void Add(BTNode node)
        {
            _nodes.Add(node);
            _byId[node.Id] = node;
        }

        internal void ReportStatus(BTNode node, NodeStatus previous, NodeStatus status, bool firstRun)
        {
            if (!DebugLog || (!firstRun && previous == status)) return;
            Debug.Log($"[BT {Label}] t={Time.ToString("F2", CultureInfo.InvariantCulture)} {node.Type} \"{node.Name}\" → {status}", DebugContext);
        }

        internal void ReportAbort(BTNode node)
        {
            if (DebugLog) Debug.Log($"[BT {Label}] t={Time.ToString("F2", CultureInfo.InvariantCulture)} {node.Type} \"{node.Name}\" aborted", DebugContext);
        }

        internal void Warn(string message) => Debug.LogWarning($"[BT {Label}] {message}", DebugContext);

        string Label => string.IsNullOrEmpty(DebugName) ? Title : DebugName;
    }

    public sealed class BehaviorTreeLoadException : Exception
    {
        public IReadOnlyList<string> Problems { get; }

        public BehaviorTreeLoadException(IReadOnlyList<string> problems)
            : base("Invalid behavior tree:\n  - " + string.Join("\n  - ", problems)) => Problems = problems;
    }
}
