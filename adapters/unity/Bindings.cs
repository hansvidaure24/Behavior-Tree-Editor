using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace BehaviorTreeRuntime
{
    /// <summary>What game code receives when it runs for one node. One instance per node, reused every tick.</summary>
    public sealed class BTContext
    {
        internal BTContext(BTNode node) => Node = node;

        public BTNode Node { get; }
        public BehaviorTree Tree => Node.Tree;
        public Blackboard Blackboard => Node.Tree.Blackboard;
        /// <summary>The node's parameters from the editor (e.g. <c>speed</c>, <c>stop_distance</c>).</summary>
        public NodeParams Params => Node.Params;
        public string Name => Node.Name;
        /// <summary>Tree time in seconds (sum of the delta times passed to <see cref="BehaviorTree.Tick"/>).</summary>
        public float Time => Node.Tree.Time;
        /// <summary>Seconds covered by the current tick.</summary>
        public float DeltaTime => Node.Tree.DeltaTime;
        /// <summary>Seconds since this node was entered.</summary>
        public float ElapsedInNode => Node.Tree.Time - Node.EnteredAt;
        /// <summary>Whatever the owner set as <see cref="BehaviorTree.Owner"/> (the runner sets its GameObject).</summary>
        public object Owner => Node.Tree.Owner;
        public T OwnerAs<T>() where T : class => Node.Tree.Owner as T;
    }

    /// <summary>
    /// A game action with a lifecycle. Create one per node (see <see cref="BTBindings.RegisterActionFactory"/>)
    /// so it can keep per-node state such as a chosen destination.
    /// </summary>
    public interface IBTAction
    {
        void OnEnter(BTContext ctx);
        NodeStatus OnTick(BTContext ctx);
        void OnExit(BTContext ctx, NodeStatus status);
        /// <summary>A parent cut the action off while it was Running: stop moving, cancel the animation, ...</summary>
        void OnAbort(BTContext ctx);
        /// <summary>False while the action must finish (a committed attack); selectors won't pre-empt it.</summary>
        bool CanBeInterrupted { get; }
    }

    /// <summary>Convenience base: override only what you need.</summary>
    public abstract class BTAction : IBTAction
    {
        public virtual void OnEnter(BTContext ctx) { }
        public abstract NodeStatus OnTick(BTContext ctx);
        public virtual void OnExit(BTContext ctx, NodeStatus status) { }
        public virtual void OnAbort(BTContext ctx) { }
        public virtual bool CanBeInterrupted => true;
    }

    public interface IBTCondition
    {
        bool Check(BTContext ctx);
    }

    /// <summary>
    /// Maps action/condition node names to game code. Names match loosely — case, spaces and
    /// punctuation are ignored, so a node named "Move To Target" binds to "MoveToTarget". One bindings
    /// object can be shared by every tree of an agent type.
    /// </summary>
    public sealed class BTBindings
    {
        readonly Dictionary<string, Func<BTContext, IBTAction>> _actions = new Dictionary<string, Func<BTContext, IBTAction>>();
        readonly Dictionary<string, Func<BTContext, IBTCondition>> _conditions = new Dictionary<string, Func<BTContext, IBTCondition>>();

        /// <summary>Bind an action to a tick function. Return Running to keep it going on the next tick.</summary>
        public BTBindings RegisterAction(string name, Func<BTContext, NodeStatus> onTick,
            Action<BTContext> onEnter = null, Action<BTContext> onAbort = null, bool interruptible = true)
        {
            if (onTick == null) throw new ArgumentNullException(nameof(onTick));
            _actions[Normalize(name)] = _ => new DelegateAction(onTick, onEnter, onAbort, interruptible);
            return this;
        }

        /// <summary>Bind an action to a factory that creates one <see cref="IBTAction"/> per node.</summary>
        public BTBindings RegisterActionFactory(string name, Func<BTContext, IBTAction> factory)
        {
            _actions[Normalize(name)] = factory ?? throw new ArgumentNullException(nameof(factory));
            return this;
        }

        public BTBindings RegisterCondition(string name, Func<BTContext, bool> check)
        {
            if (check == null) throw new ArgumentNullException(nameof(check));
            var shared = new DelegateCondition(check);
            _conditions[Normalize(name)] = _ => shared;
            return this;
        }

        /// <summary>Bind a condition to a factory that creates one <see cref="IBTCondition"/> per node.</summary>
        public BTBindings RegisterConditionFactory(string name, Func<BTContext, IBTCondition> factory)
        {
            _conditions[Normalize(name)] = factory ?? throw new ArgumentNullException(nameof(factory));
            return this;
        }

        public bool HasAction(string name) => _actions.ContainsKey(Normalize(name));
        public bool HasCondition(string name) => _conditions.ContainsKey(Normalize(name));
        public bool Unregister(string name) => _actions.Remove(Normalize(name)) | _conditions.Remove(Normalize(name));

        internal IBTAction CreateAction(BTContext ctx) =>
            _actions.TryGetValue(ctx.Node.BindingKey, out var f) ? f(ctx) : null;

        internal IBTCondition CreateCondition(BTContext ctx) =>
            _conditions.TryGetValue(ctx.Node.BindingKey, out var f) ? f(ctx) : null;

        /// <summary>Lower-case letters and digits only.</summary>
        public static string Normalize(string name)
        {
            if (string.IsNullOrEmpty(name)) return "";
            var sb = new StringBuilder(name.Length);
            foreach (var c in name)
                if (char.IsLetterOrDigit(c)) sb.Append(char.ToLowerInvariant(c));
            return sb.ToString();
        }

        sealed class DelegateAction : IBTAction
        {
            readonly Func<BTContext, NodeStatus> _tick;
            readonly Action<BTContext> _enter, _abort;
            readonly bool _interruptible;

            public DelegateAction(Func<BTContext, NodeStatus> tick, Action<BTContext> enter, Action<BTContext> abort, bool interruptible)
            {
                _tick = tick;
                _enter = enter;
                _abort = abort;
                _interruptible = interruptible;
            }

            public void OnEnter(BTContext ctx) => _enter?.Invoke(ctx);
            public NodeStatus OnTick(BTContext ctx) => _tick(ctx);
            public void OnExit(BTContext ctx, NodeStatus status) { }
            public void OnAbort(BTContext ctx) => _abort?.Invoke(ctx);
            public bool CanBeInterrupted => _interruptible;
        }

        sealed class DelegateCondition : IBTCondition
        {
            readonly Func<BTContext, bool> _check;
            public DelegateCondition(Func<BTContext, bool> check) => _check = check;
            public bool Check(BTContext ctx) => _check(ctx);
        }
    }

    /// <summary>A node's parameters from the .bt.json file, with forgiving typed getters.</summary>
    public sealed class NodeParams
    {
        public static readonly NodeParams Empty = new NodeParams(new Dictionary<string, object>());

        readonly Dictionary<string, object> _values;

        public NodeParams(Dictionary<string, object> values) => _values = values ?? new Dictionary<string, object>();

        public bool Has(string key) => _values.ContainsKey(key);
        public object Get(string key) => _values.TryGetValue(key, out var v) ? v : null;
        public IEnumerable<KeyValuePair<string, object>> All => _values;
        public int Count => _values.Count;

        public float GetFloat(string key, float fallback = 0f) =>
            _values.TryGetValue(key, out var v) && TryDouble(v, out double d) ? (float)d : fallback;

        public int GetInt(string key, int fallback = 0) =>
            _values.TryGetValue(key, out var v) && TryDouble(v, out double d) ? (int)Math.Round(d) : fallback;

        public bool GetBool(string key, bool fallback = false)
        {
            if (!_values.TryGetValue(key, out var v) || v == null) return fallback;
            if (v is bool b) return b;
            if (v is string s && bool.TryParse(s, out b)) return b;
            if (TryDouble(v, out double d)) return Math.Abs(d) > 1e-9;
            return fallback;
        }

        public string GetString(string key, string fallback = "") =>
            _values.TryGetValue(key, out var v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : fallback;

        /// <summary>Enum by name (case-insensitive) or by number.</summary>
        public T GetEnum<T>(string key, T fallback) where T : struct, Enum
        {
            if (!_values.TryGetValue(key, out var v) || v == null) return fallback;
            if (v is string s && Enum.TryParse(s, true, out T named)) return named;
            if (TryDouble(v, out double d)) return (T)Enum.ToObject(typeof(T), (int)Math.Round(d));
            return fallback;
        }

        static bool TryDouble(object v, out double d)
        {
            if (BlackboardCompare.TryNumber(v, out d)) return true;
            if (v is string s) return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out d);
            if (v is bool b) { d = b ? 1 : 0; return true; }
            return false;
        }
    }
}
