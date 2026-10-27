using System;
using System.Collections.Generic;
using UnityEngine;

namespace BehaviorTreeRuntime
{
    public class BehaviorTreeRunner : MonoBehaviour
    {
        [Tooltip("Drag your .bt.json TextAsset here")]
        public TextAsset jsonAsset;

        public Blackboard Bb { get; private set; } = new();
        public BTNode Root { get; private set; }
        public string TreeTitle { get; private set; } = "";

        readonly Dictionary<string, Func<Blackboard, NodeStatus>> _actions = new();
        readonly Dictionary<string, Func<Blackboard, bool>> _conditions = new();

        public void RegisterAction(string name, Func<Blackboard, NodeStatus> fn) => _actions[name] = fn;
        public void RegisterCondition(string name, Func<Blackboard, bool> fn) => _conditions[name] = fn;

        void Start()
        {
            if (jsonAsset == null) { Debug.LogError("BehaviorTreeRunner: no jsonAsset assigned"); return; }
            Root = LoadFromJson(jsonAsset.text);
        }

        void Update()
        {
            Root?.Tick(Bb);
        }

        BTNode LoadFromJson(string json)
        {
            var parsed = MiniJson.Deserialize(json) as Dictionary<string, object>;
            if (parsed == null) { Debug.LogError("Failed to parse tree JSON"); return null; }

            TreeTitle = parsed.ContainsKey("title") ? parsed["title"] as string ?? "" : "";
            var rootId = parsed["root"] as string;
            var nodesDict = parsed["nodes"] as Dictionary<string, object>;

            var built = new Dictionary<string, BTNode>();

            foreach (var kv in nodesDict)
            {
                var nd = kv.Value as Dictionary<string, object>;
                var type = nd["type"] as string;
                var name = nd.ContainsKey("name") ? nd["name"] as string : type;
                var parameters = nd.ContainsKey("parameters") ? nd["parameters"] as Dictionary<string, object> : new();

                BTNode node = type switch
                {
                    "sequence" => new Sequence(),
                    "selector" => new Selector(),
                    "parallel" => new Parallel(),
                    "invert" => new Invert(),
                    "repeat" => new Repeat(),
                    "cooldown" => new Cooldown(),
                    "timeout" => new Timeout(),
                    "guard" => new Guard { Condition = _conditions.GetValueOrDefault(name) },
                    "action" => new ActionNode { Execute = _actions.GetValueOrDefault(name) },
                    "condition" => new ConditionNode { Check = _conditions.GetValueOrDefault(name) },
                    _ => new ActionNode(),
                };
                node.Id = kv.Key;
                node.Name = name;
                if (parameters != null)
                    foreach (var p in parameters)
                        node.Parameters[p.Key] = p.Value;
                built[kv.Key] = node;
            }

            foreach (var kv in nodesDict)
            {
                var nd = kv.Value as Dictionary<string, object>;
                if (nd.ContainsKey("children") && nd["children"] is List<object> children)
                {
                    foreach (var cid in children)
                    {
                        if (built.TryGetValue(cid as string, out var child))
                            built[kv.Key].Children.Add(child);
                    }
                }
            }

            return built.GetValueOrDefault(rootId);
        }
    }
}
