using UnityEngine;

namespace BehaviorTreeRuntime
{
    public class Cooldown : BTNode
    {
        protected override NodeStatus OnTick(Blackboard bb)
        {
            if (Children.Count == 0) return NodeStatus.Failure;
            var duration = Parameters.ContainsKey("duration") ? System.Convert.ToSingle(Parameters["duration"]) : 1f;
            var readyAt = bb.Get<float>(Id + "_cd");
            if (Time.time < readyAt) return NodeStatus.Failure;
            var status = Children[0].Tick(bb);
            if (status != NodeStatus.Running)
                bb.Set(Id + "_cd", Time.time + duration);
            return status;
        }
    }
}
