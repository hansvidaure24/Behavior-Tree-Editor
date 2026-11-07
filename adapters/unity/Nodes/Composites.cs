namespace BehaviorTreeRuntime
{
    /// <summary>
    /// Reactive priority list: every tick it tries children from the top, so a higher-priority branch
    /// pre-empts (aborts) a running lower one. A committed (non-interruptible) branch is left to finish.
    /// </summary>
    public sealed class Selector : CompositeNode
    {
        protected override NodeStatus OnTick()
        {
            if (RunningIndex >= 0 && !Children[RunningIndex].CanBeInterrupted)
            {
                var committed = Children[RunningIndex].Tick();
                if (committed != NodeStatus.Failure)
                {
                    if (committed == NodeStatus.Success) RunningIndex = -1;
                    return committed;
                }
                RunningIndex = -1;
            }

            for (int i = 0; i < Children.Count; i++)
            {
                var status = Children[i].Tick();
                if (status == NodeStatus.Failure) continue;
                if (RunningIndex >= 0 && RunningIndex != i) Children[RunningIndex].Abort();
                RunningIndex = status == NodeStatus.Running ? i : -1;
                return status;
            }
            RunningIndex = -1;
            return NodeStatus.Failure;
        }
    }

    /// <summary>
    /// Runs children in order and fails on the first failure. While a child is Running, the conditions
    /// before it are re-checked every tick (so a chase stops when the target leaves range) but actions
    /// that already succeeded are not re-run. A committed branch is not re-checked.
    /// </summary>
    public sealed class Sequence : CompositeNode
    {
        protected override NodeStatus OnTick()
        {
            int start = RunningIndex >= 0 && !Children[RunningIndex].CanBeInterrupted ? RunningIndex : 0;
            for (int i = start; i < Children.Count; i++)
            {
                if (i < RunningIndex && !Children[i].IsCondition) continue;

                var status = Children[i].Tick();
                if (status == NodeStatus.Success) continue;

                if (RunningIndex > i) Children[RunningIndex].Abort();
                RunningIndex = status == NodeStatus.Running ? i : -1;
                return status;
            }
            RunningIndex = -1;
            return NodeStatus.Success;
        }
    }

    /// <summary>
    /// Ticks every unfinished child each tick. <c>policy</c> parameter:
    /// <c>fail_on_one</c> (default) fails as soon as one child fails, succeeds when all succeed;
    /// <c>succeed_on_one</c> succeeds as soon as one succeeds, fails when all fail;
    /// <c>succeed_on_all</c> waits for every child, then succeeds only if all succeeded.
    /// Children still running when the parallel finishes are aborted.
    /// </summary>
    public sealed class Parallel : CompositeNode
    {
        enum Policy { FailOnOne, SucceedOnOne, SucceedOnAll }

        Policy _policy;
        NodeStatus[] _results;

        internal void Configure()
        {
            var p = Params.GetString("policy", "fail_on_one").ToLowerInvariant();
            _policy = p == "succeed_on_one" ? Policy.SucceedOnOne : p == "succeed_on_all" ? Policy.SucceedOnAll : Policy.FailOnOne;
        }

        public override bool CanBeInterrupted
        {
            get
            {
                foreach (var child in Children)
                    if (child.IsActive && !child.CanBeInterrupted) return false;
                return true;
            }
        }

        protected override void OnEnter()
        {
            base.OnEnter();
            if (_results == null || _results.Length != Children.Count) _results = new NodeStatus[Children.Count];
            for (int i = 0; i < _results.Length; i++) _results[i] = NodeStatus.Running;
        }

        protected override NodeStatus OnTick()
        {
            int successes = 0, failures = 0, n = Children.Count;
            for (int i = 0; i < n; i++)
            {
                if (_results[i] == NodeStatus.Running) _results[i] = Children[i].Tick();
                if (_results[i] == NodeStatus.Success) successes++;
                else if (_results[i] == NodeStatus.Failure) failures++;
            }

            var result = NodeStatus.Running;
            switch (_policy)
            {
                case Policy.FailOnOne:
                    if (failures > 0) result = NodeStatus.Failure;
                    else if (successes == n) result = NodeStatus.Success;
                    break;
                case Policy.SucceedOnOne:
                    if (successes > 0) result = NodeStatus.Success;
                    else if (failures == n) result = NodeStatus.Failure;
                    break;
                case Policy.SucceedOnAll:
                    if (successes + failures == n) result = failures == 0 ? NodeStatus.Success : NodeStatus.Failure;
                    break;
            }
            if (result != NodeStatus.Running)
                foreach (var child in Children) child.Abort();
            return result;
        }
    }
}
