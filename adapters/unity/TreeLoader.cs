using System.Collections.Generic;

namespace BehaviorTreeRuntime
{
    /// <summary>
    /// .bt.json → node graph. Collects every structural problem before failing, so a broken export reports
    /// all its issues at once. Disabled nodes (the editor's "Disable" toggle) are dropped as if absent.
    /// </summary>
    internal static class TreeLoader
    {
        static readonly HashSet<string> Leaves = new HashSet<string> { "action", "condition" };
        static readonly HashSet<string> Decorators = new HashSet<string> { "invert", "repeat", "cooldown", "timeout", "guard" };
        static readonly HashSet<string> Composites = new HashSet<string> { "sequence", "selector", "parallel" };

        public static BehaviorTree Load(string json, BTBindings bindings, Blackboard blackboard)
        {
            var problems = new List<string>();
            object parsed;
            try { parsed = MiniJson.Deserialize(json); }
            catch (System.FormatException e) { throw new BehaviorTreeLoadException(new[] { "Not valid JSON: " + e.Message }); }

            var doc = parsed as Dictionary<string, object>;
            // Accept a combined { "tree": {...}, "layout": {...} } file as well as a plain .bt.json.
            if (doc != null && !doc.ContainsKey("nodes") && doc.TryGetValue("tree", out var inner) && inner is Dictionary<string, object> innerTree)
                doc = innerTree;
            if (doc == null) throw new BehaviorTreeLoadException(new[] { "Expected a JSON object with \"root\" and \"nodes\"." });

            var tree = new BehaviorTree(bindings, blackboard)
            {
                Title = Str(doc, "title"),
                Description = Str(doc, "description"),
            };
            var rootId = Str(doc, "root");
            if (!(doc.TryGetValue("nodes", out var nodesObj) && nodesObj is Dictionary<string, object> nodes))
                throw new BehaviorTreeLoadException(new[] { "Missing \"nodes\" object." });
            if (string.IsNullOrEmpty(rootId)) problems.Add("Missing \"root\".");
            else if (!nodes.ContainsKey(rootId)) problems.Add($"Root \"{rootId}\" is not in nodes.");

            var built = new Dictionary<string, BTNode>();
            var disabled = new HashSet<string>();
            foreach (var kv in nodes)
            {
                if (!(kv.Value is Dictionary<string, object> nd)) { problems.Add($"Node \"{kv.Key}\" is not an object."); continue; }
                var type = Str(nd, "type").ToLowerInvariant();
                var name = Str(nd, "name");
                if (string.IsNullOrEmpty(name)) name = type;
                if (nd.TryGetValue("disabled", out var dis) && dis is bool d && d) { disabled.Add(kv.Key); continue; }

                BTNode node = Create(type);
                if (node == null) { problems.Add($"Node \"{name}\" ({kv.Key}) has unknown type \"{type}\"."); continue; }
                node.Id = kv.Key;
                node.Name = name;
                node.Type = type;
                node.BindingKey = BTBindings.Normalize(name);
                node.Params = new NodeParams(nd.TryGetValue("parameters", out var p) ? p as Dictionary<string, object> : null);
                node.Tree = tree;
                node.Context = new BTContext(node);
                if (node is Parallel par) par.Configure();
                built[kv.Key] = node;
                tree.Add(node);
            }

            var parentOf = new Dictionary<string, string>();
            foreach (var kv in nodes)
            {
                if (!built.TryGetValue(kv.Key, out var parent)) continue;
                var nd = (Dictionary<string, object>)kv.Value;
                if (!nd.TryGetValue("children", out var ch) || ch == null) continue;
                if (!(ch is List<object> children)) { problems.Add($"Node \"{parent.Name}\": \"children\" must be an array."); continue; }
                foreach (var c in children)
                {
                    var cid = c as string;
                    if (cid == null || !nodes.ContainsKey(cid)) { problems.Add($"Node \"{parent.Name}\" references missing child \"{c}\"."); continue; }
                    if (disabled.Contains(cid)) continue;
                    if (parentOf.TryGetValue(cid, out var other)) { problems.Add($"Node \"{cid}\" has two parents (\"{other}\" and \"{kv.Key}\")."); continue; }
                    parentOf[cid] = kv.Key;
                    if (built.TryGetValue(cid, out var child)) parent.Children.Add(child);
                }
            }

            foreach (var node in tree.Nodes)
            {
                if (Leaves.Contains(node.Type) && node.Children.Count > 0) problems.Add($"{node.Type} \"{node.Name}\" is a leaf but has children.");
                if (Decorators.Contains(node.Type) && node.Children.Count > 1) problems.Add($"{node.Type} \"{node.Name}\" can have only one child (has {node.Children.Count}).");
            }

            if (rootId != null && built.TryGetValue(rootId, out var root))
            {
                if (HasCycle(root, new HashSet<BTNode>(), new HashSet<BTNode>())) problems.Add("The tree contains a cycle.");
                tree.Root = root;
            }
            else if (rootId != null && disabled.Contains(rootId))
                problems.Add("The root node is disabled.");

            if (problems.Count > 0) throw new BehaviorTreeLoadException(problems);
            return tree;
        }

        static BTNode Create(string type)
        {
            switch (type)
            {
                case "sequence": return new Sequence();
                case "selector": return new Selector();
                case "parallel": return new Parallel();
                case "invert": return new Invert();
                case "repeat": return new Repeat();
                case "cooldown": return new Cooldown();
                case "timeout": return new Timeout();
                case "guard": return new Guard();
                case "action": return new ActionNode();
                case "condition": return new ConditionNode();
                default: return null;
            }
        }

        static bool HasCycle(BTNode node, HashSet<BTNode> onPath, HashSet<BTNode> done)
        {
            if (onPath.Contains(node)) return true;
            if (!done.Add(node)) return false;
            onPath.Add(node);
            foreach (var c in node.Children)
                if (HasCycle(c, onPath, done)) return true;
            onPath.Remove(node);
            return false;
        }

        static string Str(Dictionary<string, object> d, string key) =>
            d.TryGetValue(key, out var v) && v is string s ? s : "";

        internal static bool IsKnownType(string type) => Leaves.Contains(type) || Decorators.Contains(type) || Composites.Contains(type);
    }
}
