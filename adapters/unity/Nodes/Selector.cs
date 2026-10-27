namespace BehaviorTreeRuntime
{
    public class Selector : BTNode
    {
        protected override NodeStatus OnTick(Blackboard bb)
        {
            foreach (var child in Children)
            {
                var status = child.Tick(bb);
                if (status != NodeStatus.Failure)
                    return status;
            }
            return NodeStatus.Failure;
        }
    }
}
