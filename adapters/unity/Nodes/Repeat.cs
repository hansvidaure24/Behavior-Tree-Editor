namespace BehaviorTreeRuntime
{
    public class Repeat : BTNode
    {
        protected override NodeStatus OnTick(Blackboard bb)
        {
            if (Children.Count == 0) return NodeStatus.Failure;
            var maxRepeats = Parameters.ContainsKey("count") ? System.Convert.ToInt32(Parameters["count"]) : -1;
            var status = Children[0].Tick(bb);
            if (status == NodeStatus.Running) return NodeStatus.Running;
            if (maxRepeats > 0)
            {
                var done = bb.Get<int>(Id + "_reps") + 1;
                bb.Set(Id + "_reps", done);
                if (done >= maxRepeats) { bb.Set(Id + "_reps", 0); return NodeStatus.Success; }
            }
            return NodeStatus.Running;
        }
    }
}
