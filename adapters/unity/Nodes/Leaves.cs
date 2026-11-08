using System;
using System.Globalization;

namespace BehaviorTreeRuntime
{
    /// <summary>
    /// Game action, bound by node name to code registered in <see cref="BTBindings"/>. The binding is looked
    /// up when the node is first entered (so registration order doesn't matter) and retried until found.
    /// An unbound action fails and logs one warning, so a missing binding is never mistaken for success.
    /// </summary>
    public sealed class ActionNode : BTNode
    {
        IBTAction _impl;
        bool _warned;

        public bool IsBound => _impl != null;

        public override bool CanBeInterrupted => _impl == null || _impl.CanBeInterrupted;

        protected override void OnEnter()
        {
            if (_impl == null) _impl = Tree.Bindings.CreateAction(Context);
            if (_impl == null)
            {
                if (!_warned)
                {
                    _warned = true;
                    Tree.Warn($"No action registered for \"{Name}\" — it will fail. Register it with Bindings.RegisterAction(\"{Name}\", ...).");
                }
                return;
            }
            _impl.OnEnter(Context);
        }

        protected override NodeStatus OnTick() => _impl != null ? _impl.OnTick(Context) : NodeStatus.Failure;

        protected override void OnExit(NodeStatus status) => _impl?.OnExit(Context, status);

        protected override void OnAbort() => _impl?.OnAbort(Context);
    }

    /// <summary>
    /// Instant yes/no check: a game binding registered under the node's name, or else the blackboard
    /// comparison in its <c>key</c>/<c>op</c>/<c>value</c> parameters. Sequences re-check conditions
    /// every tick while a later child is running.
    /// </summary>
    public sealed class ConditionNode : BTNode
    {
        readonly ConditionCheck _check = new ConditionCheck();

        public override bool IsCondition => true;

        protected override NodeStatus OnTick() => _check.Evaluate(this) ? NodeStatus.Success : NodeStatus.Failure;
    }

    /// <summary>Shared by <see cref="ConditionNode"/> and <see cref="Guard"/>.</summary>
    internal sealed class ConditionCheck
    {
        IBTCondition _bound;
        bool _warned;

        public bool Evaluate(BTNode node)
        {
            if (_bound == null) _bound = node.Tree.Bindings.CreateCondition(node.Context);
            if (_bound != null) return _bound.Check(node.Context);
            if (node.Params.Has("key")) return BlackboardCompare.Evaluate(node.Tree.Blackboard, node.Params, node.Tree);
            if (!_warned)
            {
                _warned = true;
                node.Tree.Warn($"No condition registered for \"{node.Name}\" and no key/op/value parameters — it will fail. Register it with Bindings.RegisterCondition(\"{node.Name}\", ...).");
            }
            return false;
        }
    }

    /// <summary>
    /// Compares blackboard[<c>key</c>] with <c>value</c> using <c>op</c>: eq, ne, lt, gt, le, ge (the
    /// editor's options; ==, !=, &lt;, &gt;, &lt;=, &gt;=, lte, gte, neq also accepted). Without a value
    /// the check is "key is set and truthy". A missing key fails.
    /// </summary>
    public static class BlackboardCompare
    {
        public static bool Evaluate(Blackboard bb, NodeParams p, BehaviorTree tree = null)
        {
            var key = p.GetString("key", null);
            if (string.IsNullOrEmpty(key) || !bb.TryGetRaw(key, out var actual) || actual == null) return false;
            if (!p.Has("value")) return Truthy(actual);

            var expected = p.Get("value");
            var op = NormalizeOp(p.GetString("op", "eq"));
            if (op == null)
            {
                tree?.Warn($"Unknown comparison op \"{p.GetString("op", "")}\" — use eq, ne, lt, gt, le or ge.");
                return false;
            }

            if (TryNumber(actual, out double a) && TryNumber(expected, out double b))
            {
                switch (op)
                {
                    case "eq": return Math.Abs(a - b) < 1e-4;
                    case "ne": return Math.Abs(a - b) >= 1e-4;
                    case "lt": return a < b;
                    case "gt": return a > b;
                    case "le": return a <= b;
                    case "ge": return a >= b;
                }
            }
            if (actual is bool ab && expected is bool eb)
                return op == "eq" ? ab == eb : op == "ne" ? ab != eb : false;

            int cmp = string.CompareOrdinal(Convert.ToString(actual, CultureInfo.InvariantCulture), Convert.ToString(expected, CultureInfo.InvariantCulture));
            switch (op)
            {
                case "eq": return cmp == 0;
                case "ne": return cmp != 0;
                case "lt": return cmp < 0;
                case "gt": return cmp > 0;
                case "le": return cmp <= 0;
                case "ge": return cmp >= 0;
            }
            return false;
        }

        static string NormalizeOp(string op)
        {
            switch ((op ?? "eq").Trim().ToLowerInvariant())
            {
                case "eq": case "==": case "=": return "eq";
                case "ne": case "neq": case "!=": return "ne";
                case "lt": case "<": return "lt";
                case "gt": case ">": return "gt";
                case "le": case "lte": case "<=": return "le";
                case "ge": case "gte": case ">=": return "ge";
                default: return null;
            }
        }

        static bool Truthy(object v)
        {
            switch (v)
            {
                case bool b: return b;
                case string s: return s.Length > 0;
                default: return TryNumber(v, out double d) ? Math.Abs(d) > 1e-9 : true;
            }
        }

        internal static bool TryNumber(object v, out double d)
        {
            switch (v)
            {
                case double x: d = x; return true;
                case float x: d = x; return true;
                case int x: d = x; return true;
                case long x: d = x; return true;
                case short x: d = x; return true;
                case byte x: d = x; return true;
                case uint x: d = x; return true;
                case decimal x: d = (double)x; return true;
                default: d = 0; return false;
            }
        }
    }
}
