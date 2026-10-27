namespace BehaviorTreeRuntime
{
    public class Sequence : BTNode
    {
        protected override NodeStatus OnTick(Blackboard bb)
        {
            foreach (var child in Children)
            {
                var status = child.Tick(bb);
                if (status != NodeStatus.Success)
                    return status;
            }
            return NodeStatus.Success;
        }
    }
}
