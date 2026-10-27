namespace BehaviorTreeRuntime
{
    public class Invert : BTNode
    {
        protected override NodeStatus OnTick(Blackboard bb)
        {
            if (Children.Count == 0) return NodeStatus.Failure;
            var status = Children[0].Tick(bb);
            return status switch
            {
                NodeStatus.Success => NodeStatus.Failure,
                NodeStatus.Failure => NodeStatus.Success,
                _ => status,
            };
        }
    }
}
