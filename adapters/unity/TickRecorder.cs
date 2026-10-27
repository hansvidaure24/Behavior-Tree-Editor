using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;

namespace BehaviorTreeRuntime
{
    /// <summary>
    /// Records every tick of a behavior tree for replay in the editor.
    /// Attach alongside BehaviorTreeRunner. Toggle recording at runtime.
    /// Writes a .replay.json file when stopped or on destroy.
    /// </summary>
    public class TickRecorder : MonoBehaviour
    {
        [Tooltip("Max ticks to keep in memory (ring buffer)")]
        public int maxTicks = 600; // ~10 seconds at 60fps

        public bool recording = true;

        BehaviorTreeRunner _runner;
        readonly List<TickFrame> _frames = new();
        int _tickCount;

        void Awake()
        {
            _runner = GetComponent<BehaviorTreeRunner>();
            if (_runner == null)
            {
                Debug.LogError("TickRecorder requires BehaviorTreeRunner on the same GameObject");
                enabled = false;
            }
        }

        void LateUpdate()
        {
            if (!recording || _runner == null) return;

            var frame = new TickFrame
            {
                tick = _tickCount++,
                timestamp = Time.time,
                nodes = new Dictionary<string, string>(),
                blackboard = new Dictionary<string, object>()
            };

            // Collect node statuses from the last tick
            CollectStatuses(_runner.Root, frame.nodes);

            // Snapshot blackboard
            foreach (var kv in _runner.Bb.All())
                frame.blackboard[kv.Key] = kv.Value;

            if (_frames.Count >= maxTicks)
                _frames.RemoveAt(0);
            _frames.Add(frame);
        }

        void CollectStatuses(BTNode node, Dictionary<string, string> statuses)
        {
            if (node == null) return;
            statuses[node.Id] = node.LastStatus.ToString().ToLower();
            foreach (var child in node.Children)
                CollectStatuses(child, statuses);
        }

        /// <summary>Call this to save the recording to disk.</summary>
        public string Save(string filename = null)
        {
            if (_frames.Count == 0) return null;

            filename ??= $"{gameObject.name}_replay_{System.DateTime.Now:yyyyMMdd_HHmmss}";
            var path = Path.Combine(Application.persistentDataPath, filename + ".replay.json");

            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine("  \"version\": \"1.0\",");
            sb.AppendLine($"  \"treeTitle\": \"{EscapeJson(_runner.TreeTitle)}\",");
            sb.AppendLine($"  \"agentId\": \"{EscapeJson(gameObject.name)}\",");
            sb.AppendLine("  \"ticks\": [");

            for (int i = 0; i < _frames.Count; i++)
            {
                var f = _frames[i];
                sb.Append("    {");
                sb.Append($"\"tick\":{f.tick},\"timestamp\":{f.timestamp:F3},");

                // Nodes
                sb.Append("\"nodes\":{");
                int ni = 0;
                foreach (var kv in f.nodes)
                {
                    if (ni++ > 0) sb.Append(",");
                    sb.Append($"\"{EscapeJson(kv.Key)}\":{{\"status\":\"{kv.Value}\"}}");
                }
                sb.Append("},");

                // Blackboard
                sb.Append("\"blackboard\":{");
                int bi = 0;
                foreach (var kv in f.blackboard)
                {
                    if (bi++ > 0) sb.Append(",");
                    sb.Append($"\"{EscapeJson(kv.Key)}\":{SerializeValue(kv.Value)}");
                }
                sb.Append("}");

                sb.Append(i < _frames.Count - 1 ? "},\n" : "}\n");
            }

            sb.AppendLine("  ]");
            sb.AppendLine("}");

            File.WriteAllText(path, sb.ToString());
            Debug.Log($"TickRecorder: saved {_frames.Count} ticks to {path}");
            return path;
        }

        void OnDestroy()
        {
            if (recording && _frames.Count > 0)
                Save();
        }

        public void Clear() { _frames.Clear(); _tickCount = 0; }

        static string EscapeJson(string s) => s?.Replace("\\", "\\\\").Replace("\"", "\\\"") ?? "";

        static string SerializeValue(object v)
        {
            if (v == null) return "null";
            if (v is bool b) return b ? "true" : "false";
            if (v is float f) return f.ToString("G");
            if (v is double d) return d.ToString("G");
            if (v is int i) return i.ToString();
            if (v is string s) return $"\"{EscapeJson(s)}\"";
            return $"\"{EscapeJson(v.ToString())}\"";
        }

        class TickFrame
        {
            public int tick;
            public float timestamp;
            public Dictionary<string, string> nodes;
            public Dictionary<string, object> blackboard;
        }
    }
}
