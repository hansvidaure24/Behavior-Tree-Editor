namespace BehaviorTreeRuntime
{
    public class Guard : BTNode
    {
        public System.Func<Blackboard, bool> Condition;

        protected override NodeStatus OnTick(Blackboard bb)
        {
            if (Children.Count == 0) return NodeStatus.Failure;
            if (Condition != null && !Condition(bb)) return NodeStatus.Failure;
            return Children[0].Tick(bb);
        }
    }
}
