namespace BehaviorTreeRuntime
{
    /// <summary>Success ↔ Failure; Running passes through. Inverting a condition is still a condition.</summary>
    public sealed class Invert : DecoratorNode
    {
        public override bool IsCondition => Child != null && Child.IsCondition;

        protected override NodeStatus OnTick()
        {
            if (Child == null) return NodeStatus.Failure;
            var status = Child.Tick();
            if (status == NodeStatus.Running) return status;
            return status == NodeStatus.Success ? NodeStatus.Failure : NodeStatus.Success;
        }
    }

    /// <summary>
    /// Runs the child <c>count</c> times (one run per tick), succeeding after the last success.
    /// Fails as soon as the child fails. <c>count</c> ≤ 0 repeats forever.
    /// </summary>
    public sealed class Repeat : DecoratorNode
    {
        int _done;

        protected override void OnEnter() => _done = 0;

        protected override NodeStatus OnTick()
        {
            if (Child == null) return NodeStatus.Failure;
            var status = Child.Tick();
            if (status != NodeStatus.Success) return status;
            int count = Params.GetInt("count", -1);
            if (count > 0 && ++_done >= count) return NodeStatus.Success;
            return NodeStatus.Running;
        }
    }

    /// <summary>
    /// Fails while cooling down. The cooldown starts when the child succeeds and lasts <c>duration</c>
    /// seconds, or a random time between <c>min</c> and <c>max</c> if those are set. A child that is
    /// already running is never blocked.
    /// </summary>
    public sealed class Cooldown : DecoratorNode
    {
        float _readyAt = float.NegativeInfinity;

        protected override NodeStatus OnTick()
        {
            if (Child == null) return NodeStatus.Failure;
            if (Tree.Time < _readyAt && !Child.IsActive) return NodeStatus.Failure;
            var status = Child.Tick();
            if (status == NodeStatus.Success) _readyAt = Tree.Time + NextDuration();
            return status;
        }

        float NextDuration()
        {
            if (Params.Has("min") || Params.Has("max"))
            {
                float min = Params.GetFloat("min", 0f);
                float max = Params.GetFloat("max", min);
                if (max < min) max = min;
                return min + (max - min) * Tree.Random();
            }
            return Params.GetFloat("duration", 1f);
        }

        /// <summary>Seconds left before the branch may run again (0 when ready).</summary>
        public float Remaining => Tree == null ? 0f : UnityEngine.Mathf.Max(0f, _readyAt - Tree.Time);
    }

    /// <summary>Fails (and aborts the child) if the child has been running for more than <c>seconds</c>.</summary>
    public sealed class Timeout : DecoratorNode
    {
        protected override NodeStatus OnTick()
        {
            if (Child == null) return NodeStatus.Failure;
            if (Tree.Time - EnteredAt > Params.GetFloat("seconds", 5f) && Child.CanBeInterrupted)
            {
                Child.Abort();
                return NodeStatus.Failure;
            }
            return Child.Tick();
        }
    }

    /// <summary>
    /// Runs the child only while its condition holds, re-checked every tick. The condition is a game
    /// binding registered under the guard's name if there is one, otherwise the blackboard check in its
    /// <c>key</c>/<c>op</c>/<c>value</c> parameters. A committed child is allowed to finish.
    /// </summary>
    public sealed class Guard : DecoratorNode
    {
        readonly ConditionCheck _check = new ConditionCheck();

        protected override NodeStatus OnTick()
        {
            if (Child == null) return NodeStatus.Failure;
            if (!_check.Evaluate(this))
            {
                if (Child.IsActive && !Child.CanBeInterrupted) return Child.Tick();
                Child.Abort();
                return NodeStatus.Failure;
            }
            return Child.Tick();
        }
    }
}
