using UnityEngine;

namespace BehaviorTreeRuntime
{
    public class Timeout : BTNode
    {
        protected override NodeStatus OnTick(Blackboard bb)
        {
            if (Children.Count == 0) return NodeStatus.Failure;
            var limit = Parameters.ContainsKey("seconds") ? System.Convert.ToSingle(Parameters["seconds"]) : 5f;
            var startKey = Id + "_t0";
            if (!bb.Has(startKey)) bb.Set(startKey, Time.time);
            if (Time.time - bb.Get<float>(startKey) > limit)
            {
                bb.Remove(startKey);
                return NodeStatus.Failure;
            }
            var status = Children[0].Tick(bb);
            if (status != NodeStatus.Running) bb.Remove(startKey);
            return status;
        }
    }
}
