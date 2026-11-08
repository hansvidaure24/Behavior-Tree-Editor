using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace BehaviorTreeRuntime.Tests
{
    public sealed class BehaviorTreeRuntimeTests
    {
        // --- tiny .bt.json builder: N("id", "type", "Name", new[]{"child"}, "'param': 1") ---
        static string Json(string root, params string[] nodes) =>
            "{\"version\":\"1.0\",\"title\":\"Test\",\"root\":\"" + root + "\",\"nodes\":{" + string.Join(",", nodes) + "}}";

        static string N(string id, string type, string name = null, string[] children = null, string param = "", bool disabled = false)
        {
            var kids = children == null ? "" : string.Join(",", children.Select(c => "\"" + c + "\""));
            return $"\"{id}\":{{\"id\":\"{id}\",\"type\":\"{type}\",\"name\":\"{name ?? id}\",\"children\":[{kids}]," +
                   $"\"parameters\":{{{param.Replace('\'', '"')}}}{(disabled ? ",\"disabled\":true" : "")}}}";
        }

        /// <summary>Scriptable action that records what the tree did to it.</summary>
        sealed class Probe
        {
            public NodeStatus Result = NodeStatus.Success;
            public int Enters, Ticks, Aborts;
            public bool Interruptible = true;

            public void Bind(BTBindings b, string name) =>
                b.RegisterAction(name, _ => { Ticks++; return Result; }, _ => Enters++, _ => Aborts++, Interruptible);
        }

        static BehaviorTree Build(string json, BTBindings b) => BehaviorTree.FromJson(json, b);

        [Test]
        public void Sequence_RechecksConditions_SkipsFinishedActions_AbortsWhenConditionFails()
        {
            var b = new BTBindings();
            bool near = true;
            b.RegisterCondition("Near", _ => near);
            var prep = new Probe();
            var walk = new Probe { Result = NodeStatus.Running };
            prep.Bind(b, "Prep");
            walk.Bind(b, "Walk");
            var t = Build(Json("s", N("s", "sequence", "S", new[] { "c", "p", "w" }), N("c", "condition", "Near"), N("p", "action", "Prep"), N("w", "action", "Walk")), b);

            Assert.AreEqual(NodeStatus.Running, t.Tick(0.1f));
            Assert.AreEqual(NodeStatus.Running, t.Tick(0.1f));
            Assert.AreEqual(1, prep.Ticks, "an action that already succeeded must not re-run while a later child runs");
            Assert.AreEqual(2, walk.Ticks);

            near = false;
            Assert.AreEqual(NodeStatus.Failure, t.Tick(0.1f));
            Assert.AreEqual(1, walk.Aborts, "the running action is aborted when an earlier condition fails");
        }

        [Test]
        public void Selector_HigherPriorityPreemptsAndAbortsLowerBranch()
        {
            var b = new BTBindings();
            bool threat = false;
            b.RegisterCondition("Threat", _ => threat);
            var flee = new Probe { Result = NodeStatus.Running };
            var patrol = new Probe { Result = NodeStatus.Running };
            flee.Bind(b, "Flee");
            patrol.Bind(b, "Patrol");
            var t = Build(Json("sel", N("sel", "selector", "Root", new[] { "s", "pat" }), N("s", "sequence", "S", new[] { "c", "f" }),
                N("c", "condition", "Threat"), N("f", "action", "Flee"), N("pat", "action", "Patrol")), b);

            t.Tick(0.1f);
            Assert.AreEqual(1, patrol.Ticks);
            threat = true;
            t.Tick(0.1f);
            Assert.AreEqual(1, flee.Ticks);
            Assert.AreEqual(1, patrol.Aborts);
        }

        [Test]
        public void Selector_LeavesCommittedBranchAlone()
        {
            var b = new BTBindings();
            bool threat = false;
            b.RegisterCondition("Threat", _ => threat);
            var flee = new Probe { Result = NodeStatus.Running };
            var swing = new Probe { Result = NodeStatus.Running, Interruptible = false };
            flee.Bind(b, "Flee");
            swing.Bind(b, "Swing");
            var t = Build(Json("sel", N("sel", "selector", "Root", new[] { "s", "sw" }), N("s", "sequence", "S", new[] { "c", "f" }),
                N("c", "condition", "Threat"), N("f", "action", "Flee"), N("sw", "action", "Swing")), b);

            t.Tick(0.1f);
            threat = true;
            t.Tick(0.1f);
            Assert.AreEqual(0, flee.Ticks, "a committed action is not pre-empted");
            Assert.AreEqual(0, swing.Aborts);
            swing.Result = NodeStatus.Success;
            t.Tick(0.1f);
            t.Tick(0.1f);
            Assert.AreEqual(1, flee.Ticks, "once it finishes, priorities apply again");
        }

        [TestCase("fail_on_one", NodeStatus.Running, NodeStatus.Failure, NodeStatus.Failure)]
        [TestCase("succeed_on_one", NodeStatus.Running, NodeStatus.Success, NodeStatus.Success)]
        [TestCase("succeed_on_all", NodeStatus.Success, NodeStatus.Failure, NodeStatus.Failure)]
        public void Parallel_Policies(string policy, NodeStatus firstChildResult, NodeStatus secondChildLater, NodeStatus expected)
        {
            var b = new BTBindings();
            var a = new Probe { Result = firstChildResult };
            var c = new Probe { Result = NodeStatus.Running };
            a.Bind(b, "A");
            c.Bind(b, "B");
            var t = Build(Json("p", N("p", "parallel", "P", new[] { "a", "b" }, $"'policy':'{policy}'"), N("a", "action", "A"), N("b", "action", "B")), b);

            Assert.AreEqual(NodeStatus.Running, t.Tick(0.1f));
            c.Result = secondChildLater;
            Assert.AreEqual(expected, t.Tick(0.1f));
            Assert.IsFalse(t.Root.IsActive);
            if (firstChildResult == NodeStatus.Success) Assert.AreEqual(1, a.Ticks, "finished children are not re-ticked");
            if (firstChildResult == NodeStatus.Running) Assert.AreEqual(1, a.Aborts, "still-running children are aborted when the parallel finishes");
        }

        [Test]
        public void Repeat_RunsCountTimesThenSucceeds_FailsOnChildFailure()
        {
            var b = new BTBindings();
            var hit = new Probe();
            hit.Bind(b, "Hit");
            var t = Build(Json("r", N("r", "repeat", "R", new[] { "h" }, "'count':3"), N("h", "action", "Hit")), b);
            Assert.AreEqual(NodeStatus.Running, t.Tick(0.1f));
            Assert.AreEqual(NodeStatus.Running, t.Tick(0.1f));
            Assert.AreEqual(NodeStatus.Success, t.Tick(0.1f));
            Assert.AreEqual(3, hit.Ticks);

            hit.Result = NodeStatus.Failure;
            Assert.AreEqual(NodeStatus.Failure, t.Tick(0.1f));
        }

        [Test]
        public void Cooldown_StartsOnSuccessOnly()
        {
            var b = new BTBindings();
            var shot = new Probe();
            shot.Bind(b, "Shoot");
            var t = Build(Json("cd", N("cd", "cooldown", "CD", new[] { "s" }, "'duration':2"), N("s", "action", "Shoot")), b);

            Assert.AreEqual(NodeStatus.Success, t.Tick(1f));   // t=1, ready again at 3
            Assert.AreEqual(NodeStatus.Failure, t.Tick(1f));   // t=2
            Assert.AreEqual(NodeStatus.Success, t.Tick(1f));   // t=3
            Assert.AreEqual(2, shot.Ticks);

            shot.Result = NodeStatus.Failure;
            t.Tick(2f);                                        // t=5: runs, fails, no cooldown
            t.Tick(1f);                                        // t=6: runs again
            Assert.AreEqual(4, shot.Ticks);
        }

        [Test]
        public void Timeout_AbortsChildAfterSeconds()
        {
            var b = new BTBindings();
            var chase = new Probe { Result = NodeStatus.Running };
            chase.Bind(b, "Chase");
            var t = Build(Json("to", N("to", "timeout", "TO", new[] { "c" }, "'seconds':2"), N("c", "action", "Chase")), b);
            Assert.AreEqual(NodeStatus.Running, t.Tick(1f));
            Assert.AreEqual(NodeStatus.Running, t.Tick(1f));
            Assert.AreEqual(NodeStatus.Running, t.Tick(1f));
            Assert.AreEqual(NodeStatus.Failure, t.Tick(1f));
            Assert.AreEqual(1, chase.Aborts);
            Assert.AreEqual(NodeStatus.Running, t.Tick(1f), "re-entering starts a fresh timer");
        }

        [Test]
        public void Guard_UsesBlackboardParams_AndAbortsChildWhenFalse()
        {
            var b = new BTBindings();
            var attack = new Probe { Result = NodeStatus.Running };
            attack.Bind(b, "Attack");
            var t = Build(Json("g", N("g", "guard", "Has Target", new[] { "a" }, "'key':'has_target','op':'eq','value':true"), N("a", "action", "Attack")), b);
            Assert.AreEqual(NodeStatus.Failure, t.Tick(0.1f), "missing key fails");
            t.Blackboard.Set("has_target", true);
            Assert.AreEqual(NodeStatus.Running, t.Tick(0.1f));
            t.Blackboard.Set("has_target", false);
            Assert.AreEqual(NodeStatus.Failure, t.Tick(0.1f));
            Assert.AreEqual(1, attack.Aborts);
        }

        [TestCase("'key':'hp','op':'lt','value':50", true)]
        [TestCase("'key':'hp','op':'le','value':30", true)]
        [TestCase("'key':'hp','op':'ge','value':31", false)]
        [TestCase("'key':'hp','op':'ne','value':30", false)]
        [TestCase("'key':'hp','op':'eq','value':30.0", true)]
        [TestCase("'key':'hp','op':'gt','value':29", true)]
        [TestCase("'key':'alert','op':'eq','value':true", true)]
        [TestCase("'key':'alert'", true)]
        [TestCase("'key':'state','op':'eq','value':'attack'", true)]
        [TestCase("'key':'state','op':'ne','value':'flee'", true)]
        [TestCase("'key':'missing','op':'ne','value':1", false)]
        public void Condition_BlackboardOps(string param, bool expected)
        {
            var t = Build(Json("c", N("c", "condition", "Check", null, param)), new BTBindings());
            t.Blackboard.Set("hp", 30);
            t.Blackboard.Set("alert", true);
            t.Blackboard.Set("state", "attack");
            Assert.AreEqual(expected ? NodeStatus.Success : NodeStatus.Failure, t.Tick(0.1f));
        }

        [Test]
        public void UnboundAction_FailsAndWarnsOnce()
        {
            var t = Build(Json("a", N("a", "action", "Ghost")), new BTBindings());
            LogAssert.Expect(LogType.Warning, new Regex("No action registered for \"Ghost\""));
            Assert.AreEqual(NodeStatus.Failure, t.Tick(0.1f));
            Assert.AreEqual(NodeStatus.Failure, t.Tick(0.1f));
            LogAssert.NoUnexpectedReceived();
        }

        [Test]
        public void Bindings_ResolveLazily_AndMatchNamesLoosely()
        {
            var b = new BTBindings();
            var t = Build(Json("a", N("a", "action", "Move To Target")), b);
            float speed = 0;
            b.RegisterAction("MoveToTarget", ctx => { speed = ctx.Params.GetFloat("speed", 1f); return NodeStatus.Success; });
            Assert.AreEqual(NodeStatus.Success, t.Tick(0.1f));
            Assert.AreEqual(1f, speed);
        }

        [Test]
        public void ActionReceivesItsParameters()
        {
            var b = new BTBindings();
            float speed = 0; int index = -1; string anim = null;
            b.RegisterAction("Attack", ctx =>
            {
                speed = ctx.Params.GetFloat("speed");
                index = ctx.Params.GetInt("attack");
                anim = ctx.Params.GetString("animation");
                return NodeStatus.Success;
            });
            var t = Build(Json("a", N("a", "action", "Attack", null, "'speed':5.5,'attack':1,'animation':'swing'")), b);
            t.Tick(0.1f);
            Assert.AreEqual(5.5f, speed);
            Assert.AreEqual(1, index);
            Assert.AreEqual("swing", anim);
        }

        [Test]
        public void DisabledNodes_AreLeftOut()
        {
            var b = new BTBindings();
            var a = new Probe();
            var off = new Probe { Result = NodeStatus.Failure };
            a.Bind(b, "A");
            off.Bind(b, "Off");
            var t = Build(Json("s", N("s", "sequence", "S", new[] { "a", "o" }), N("a", "action", "A"), N("o", "action", "Off", null, "", disabled: true)), b);
            Assert.AreEqual(NodeStatus.Success, t.Tick(0.1f));
            Assert.AreEqual(0, off.Ticks);
            Assert.AreEqual(2, t.Nodes.Count);
        }

        [Test]
        public void Loader_ReportsEveryProblem()
        {
            var json = Json("s", N("s", "sequence", "S", new[] { "a", "nope" }), N("a", "action", "A", new[] { "x" }), N("x", "wobble", "X"));
            var e = Assert.Throws<BehaviorTreeLoadException>(() => BehaviorTree.FromJson(json));
            StringAssert.Contains("unknown type \"wobble\"", e.Message);
            StringAssert.Contains("missing child \"nope\"", e.Message);
            Assert.GreaterOrEqual(e.Problems.Count, 2);
        }

        [Test, Timeout(5000)]
        public void Loader_RejectsTruncatedJsonWithoutHanging()
        {
            var json = Json("s", N("s", "sequence", "S", new[] { "a" }), N("a", "action", "A"));
            for (int cut = 1; cut < json.Length; cut += 7)
                Assert.Throws<BehaviorTreeLoadException>(() => BehaviorTree.FromJson(json.Substring(0, cut)));
        }

        [Test]
        public void Loader_AcceptsEditorExportWithLayoutWrapper()
        {
            var inner = Json("a", N("a", "action", "A"));
            var t = BehaviorTree.FromJson("{\"tree\":" + inner + ",\"layout\":{\"nodes\":{}}}");
            Assert.AreEqual("A", t.Root.Name);
            Assert.AreEqual("Test", t.Title);
        }

        [Test]
        public void Blackboard_ConvertsNumbers()
        {
            var bb = new Blackboard();
            bb.Set("i", 3);
            bb.Set("d", 2.5);
            Assert.AreEqual(3f, bb.Get<float>("i"));
            Assert.AreEqual(2.5f, bb.Get<float>("d"));
            Assert.AreEqual(7, bb.Get("missing", 7));
            Assert.IsFalse(bb.TryGet<Vector3>("i", out _));
        }

        [Test]
        public void Runner_HotReloadKeepsBlackboard_AbortsOldTree_SurvivesBadJson()
        {
            var go = new GameObject("Runner");
            try
            {
                var runner = go.AddComponent<BehaviorTreeRunner>();
                var walk = new Probe { Result = NodeStatus.Running };
                walk.Bind(runner.Bindings, "Walk");
                Assert.IsTrue(runner.LoadFromJson(Json("w", N("w", "action", "Walk"))));
                runner.Blackboard.Set("seen", 1);
                runner.TickNow(0.1f);

                Assert.IsTrue(runner.LoadFromJson(Json("s", N("s", "sequence", "S", new[] { "w" }), N("w", "action", "Walk"))));
                Assert.AreEqual(1, walk.Aborts);
                Assert.AreEqual(1, runner.Blackboard.Get<int>("seen"));
                Assert.AreEqual("sequence", runner.Tree.Root.Type);

                var before = runner.Tree;
                LogAssert.Expect(LogType.Error, new Regex("Could not load tree"));
                Assert.IsFalse(runner.LoadFromJson("{\"root\": \"s\", \"nodes\": {"));
                Assert.AreSame(before, runner.Tree, "a bad file keeps the current tree running");
            }
            finally { Object.DestroyImmediate(go); }
        }

        [Test]
        public void Recorder_MarksNodesThatDidNotRunAsSkipped()
        {
            var go = new GameObject("Agent");
            try
            {
                var b = new BTBindings();
                new Probe { Result = NodeStatus.Running }.Bind(b, "Walk");
                new Probe().Bind(b, "Never");
                var t = Build(Json("sel", N("sel", "selector", "Root", new[] { "w", "n" }), N("w", "action", "Walk"), N("n", "action", "Never")), b);
                var rec = go.AddComponent<TickRecorder>();
                rec.saveOnDestroy = false;
                rec.Attach(t);
                t.Tick(0.1f);
                var json = rec.ToJson();
                StringAssert.Contains("\"w\":{\"status\":\"running\"}", json);
                StringAssert.Contains("\"n\":{\"status\":\"skipped\"}", json);
                Assert.IsInstanceOf<Dictionary<string, object>>(MiniJson.Deserialize(json));
            }
            finally { Object.DestroyImmediate(go); }
        }

        [Test]
        public void DebugLog_ReportsStatusChanges()
        {
            var b = new BTBindings();
            new Probe { Result = NodeStatus.Running }.Bind(b, "Walk");
            var t = Build(Json("w", N("w", "action", "Walk")), b);
            t.DebugLog = true;
            t.DebugName = "Gravewarden";
            LogAssert.Expect(LogType.Log, new Regex(@"\[BT Gravewarden\] t=0\.10 action ""Walk"" → Running"));
            t.Tick(0.1f);
            t.Tick(0.1f); // no change, no log
            LogAssert.NoUnexpectedReceived();
        }
    }
}
