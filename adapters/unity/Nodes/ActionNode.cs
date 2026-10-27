using System;

namespace BehaviorTreeRuntime
{
    public class ActionNode : BTNode
    {
        public Func<Blackboard, NodeStatus> Execute;

        protected override NodeStatus OnTick(Blackboard bb)
        {
            return Execute != null ? Execute(bb) : NodeStatus.Success;
        }
    }
}
