using System.Collections.Generic;

namespace BehaviorTreeRuntime
{
    public enum NodeStatus { Success, Failure, Running }

    /// <summary>
    /// Base node. <see cref="OnEnter"/> runs on the first tick after the node was inactive,
    /// <see cref="OnExit"/> when it finishes (Success/Failure), <see cref="OnAbort"/> when a parent
    /// cuts it off while it is still Running. Nodes hold per-agent state: build one tree per agent.
    /// </summary>
    public abstract class BTNode
    {
        /// <summary>Node id from the .bt.json file.</summary>
        public string Id { get; internal set; }
        /// <summary>Display name from the editor. Leaves bind to game code by this name.</summary>
        public string Name { get; internal set; }
        /// <summary>Editor node type ("sequence", "action", ...).</summary>
        public string Type { get; internal set; }
        public NodeParams Params { get; internal set; } = NodeParams.Empty;
        public BehaviorTree Tree { get; internal set; }
        /// <summary>What game code sees when it runs for this node (see <see cref="BTBindings"/>).</summary>
        public BTContext Context { get; internal set; }
        /// <summary>Name normalized for binding lookup: "Move To Target" and "MoveToTarget" both become "movetotarget".</summary>
        public string BindingKey { get; internal set; }
        public readonly List<BTNode> Children = new List<BTNode>();

        /// <summary>True between OnEnter and OnExit/OnAbort (i.e. while Running).</summary>
        public bool IsActive { get; private set; }
        /// <summary>Result of the most recent tick of this node.</summary>
        public NodeStatus LastStatus { get; private set; }
        /// <summary><see cref="BehaviorTree.TickCount"/> when this node last ran; -1 if never.</summary>
        public int LastTick { get; private set; } = -1;
        /// <summary>Tree time when the node was entered (see <see cref="BTContext.ElapsedInNode"/>).</summary>
        public float EnteredAt { get; private set; }

        /// <summary>
        /// False while the node is running something that must finish (a committed attack). Selectors and
        /// sequences leave such a branch alone instead of pre-empting it.
        /// </summary>
        public virtual bool CanBeInterrupted => true;

        /// <summary>True for condition-like leaves, which sequences re-check every tick while a later child runs.</summary>
        public virtual bool IsCondition => false;

        public NodeStatus Tick()
        {
            if (!IsActive)
            {
                IsActive = true;
                EnteredAt = Tree.Time;
                OnEnter();
            }
            var status = OnTick();
            if (status != NodeStatus.Running)
            {
                IsActive = false;
                OnExit(status);
            }
            var previous = LastStatus;
            bool firstRun = LastTick < 0;
            LastStatus = status;
            LastTick = Tree.TickCount;
            Tree.ReportStatus(this, previous, status, firstRun);
            return status;
        }

        /// <summary>Stop this node (and its running descendants) without letting it finish.</summary>
        public void Abort()
        {
            if (!IsActive) return;
            IsActive = false;
            OnAbort();
            Tree.ReportAbort(this);
        }

        protected virtual void OnEnter() { }
        protected abstract NodeStatus OnTick();
        protected virtual void OnExit(NodeStatus status) { }
        protected virtual void OnAbort() { }

        public override string ToString() => $"{Type} \"{Name}\" ({Id})";
    }

    public abstract class CompositeNode : BTNode
    {
        /// <summary>Index of the child left Running on the previous tick, or -1.</summary>
        protected int RunningIndex = -1;

        public override bool CanBeInterrupted => RunningIndex < 0 || Children[RunningIndex].CanBeInterrupted;

        protected override void OnEnter() => RunningIndex = -1;

        protected override void OnAbort()
        {
            foreach (var child in Children) child.Abort();
            RunningIndex = -1;
        }
    }

    public abstract class DecoratorNode : BTNode
    {
        protected BTNode Child => Children.Count > 0 ? Children[0] : null;

        public override bool CanBeInterrupted => Child == null || Child.CanBeInterrupted;

        protected override void OnAbort() => Child?.Abort();
    }
}
