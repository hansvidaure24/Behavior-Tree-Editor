using System.Collections.Generic;

namespace BehaviorTreeRuntime
{
    public enum NodeStatus { Success, Failure, Running }

    public abstract class BTNode
    {
        public string Id;
        public string Name;
        public Dictionary<string, object> Parameters = new();
        public List<BTNode> Children = new();

        /// <summary>Result of the most recent Tick — read by TickRecorder.</summary>
        public NodeStatus LastStatus { get; private set; }

        public NodeStatus Tick(Blackboard bb)
        {
            LastStatus = OnTick(bb);
            return LastStatus;
        }

        protected abstract NodeStatus OnTick(Blackboard bb);
    }
}
