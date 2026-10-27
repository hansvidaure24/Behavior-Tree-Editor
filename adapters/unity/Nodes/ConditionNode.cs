using System;

namespace BehaviorTreeRuntime
{
    public class ConditionNode : BTNode
    {
        public Func<Blackboard, bool> Check;

        protected override NodeStatus OnTick(Blackboard bb)
        {
            if (Check != null)
                return Check(bb) ? NodeStatus.Success : NodeStatus.Failure;

            if (Parameters.TryGetValue("key", out var keyObj) && keyObj is string key)
            {
                var actual = bb.Get<object>(key);
                if (actual == null) return NodeStatus.Failure;

                if (Parameters.TryGetValue("value", out var expected))
                {
                    var op = Parameters.TryGetValue("op", out var opObj) ? opObj.ToString() : "eq";
                    return Compare(actual, expected, op) ? NodeStatus.Success : NodeStatus.Failure;
                }
                return NodeStatus.Success;
            }
            return NodeStatus.Failure;
        }

        static bool Compare(object actual, object expected, string op)
        {
            try
            {
                double a = Convert.ToDouble(actual);
                double b = Convert.ToDouble(expected);
                return op switch
                {
                    "lt" => a < b,
                    "gt" => a > b,
                    "lte" => a <= b,
                    "gte" => a >= b,
                    _ => Math.Abs(a - b) < 0.001,
                };
            }
            catch
            {
                return string.Equals(actual?.ToString(), expected?.ToString());
            }
        }
    }
}
