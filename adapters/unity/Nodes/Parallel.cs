namespace BehaviorTreeRuntime
{
    public class Parallel : BTNode
    {
        protected override NodeStatus OnTick(Blackboard bb)
        {
            int successCount = 0, runningCount = 0;
            foreach (var child in Children)
            {
                var status = child.Tick(bb);
                if (status == NodeStatus.Failure) return NodeStatus.Failure;
                if (status == NodeStatus.Running) runningCount++;
                else successCount++;
            }
            return runningCount > 0 ? NodeStatus.Running : NodeStatus.Success;
        }
    }
}
