using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEngine;

namespace BehaviorTreeRuntime
{
    /// <summary>
    /// Records every tick of a behavior tree for the editor's replay debugger (.replay.json).
    /// Add it next to a <see cref="BehaviorTreeRunner"/>, or call <see cref="Attach"/> with any
    /// <see cref="BehaviorTree"/>. Nodes that did not run in a tick are recorded as "skipped".
    /// </summary>
    public class TickRecorder : MonoBehaviour
    {
        [Tooltip("Max ticks kept in memory (oldest dropped first).")]
        public int maxTicks = 600;

        public bool recording = true;

        [Tooltip("Folder for saved replays. Empty = Application.persistentDataPath.")]
        public string outputFolder = "";

        [Tooltip("Save automatically when this object is destroyed (e.g. leaving Play mode).")]
        public bool saveOnDestroy = true;

        BehaviorTreeRunner _runner;
        BehaviorTree _tree;
        readonly List<Frame> _frames = new List<Frame>();
        int _tick;

        public int FrameCount => _frames.Count;

        void Awake()
        {
            _runner = GetComponent<BehaviorTreeRunner>();
            if (_runner != null)
            {
                _runner.TreeLoaded += Attach;
                if (_runner.Tree != null) Attach(_runner.Tree);
            }
        }

        /// <summary>Start recording ticks of this tree (replaces any tree recorded before).</summary>
        public void Attach(BehaviorTree tree)
        {
            if (_tree != null) _tree.Ticked -= Record;
            _tree = tree;
            if (_tree != null) _tree.Ticked += Record;
        }

        void Record(BehaviorTree tree)
        {
            if (!recording) return;
            var frame = new Frame { tick = _tick++, timestamp = tree.Time };
            foreach (var node in tree.Nodes)
                frame.nodes.Add(new KeyValuePair<string, string>(node.Id, node.LastTick == tree.TickCount ? Lower(node.LastStatus) : "skipped"));
            foreach (var kv in tree.Blackboard.All())
                frame.blackboard.Add(new KeyValuePair<string, string>(kv.Key, SerializeValue(kv.Value)));
            if (_frames.Count >= maxTicks) _frames.RemoveAt(0);
            _frames.Add(frame);
        }

        static string Lower(NodeStatus s) => s == NodeStatus.Success ? "success" : s == NodeStatus.Failure ? "failure" : "running";

        /// <summary>Write the recording to disk and return the file path (null if nothing was recorded).</summary>
        [ContextMenu("Save Recording")]
        public string Save() => Save(null);

        public string Save(string filename)
        {
            if (_frames.Count == 0 || _tree == null) return null;
            filename ??= $"{gameObject.name}_replay_{System.DateTime.Now:yyyyMMdd_HHmmss}";
            var folder = string.IsNullOrEmpty(outputFolder) ? Application.persistentDataPath : outputFolder;
            Directory.CreateDirectory(folder);
            var path = Path.Combine(folder, filename + ".replay.json");
            File.WriteAllText(path, ToJson());
            Debug.Log($"TickRecorder: saved {_frames.Count} ticks to {path}", this);
            return path;
        }

        public string ToJson()
        {
            var sb = new StringBuilder();
            sb.Append("{\n  \"version\": \"1.0\",\n");
            sb.Append($"  \"treeTitle\": {Quote(_tree != null ? _tree.Title : "")},\n");
            sb.Append($"  \"agentId\": {Quote(gameObject.name)},\n");
            sb.Append("  \"ticks\": [\n");
            for (int i = 0; i < _frames.Count; i++)
            {
                var f = _frames[i];
                sb.Append("    {\"tick\":").Append(f.tick).Append(",\"timestamp\":").Append(f.timestamp.ToString("F3", CultureInfo.InvariantCulture)).Append(",\"nodes\":{");
                for (int n = 0; n < f.nodes.Count; n++)
                {
                    if (n > 0) sb.Append(',');
                    sb.Append(Quote(f.nodes[n].Key)).Append(":{\"status\":\"").Append(f.nodes[n].Value).Append("\"}");
                }
                sb.Append("},\"blackboard\":{");
                for (int b = 0; b < f.blackboard.Count; b++)
                {
                    if (b > 0) sb.Append(',');
                    sb.Append(Quote(f.blackboard[b].Key)).Append(':').Append(f.blackboard[b].Value);
                }
                sb.Append(i < _frames.Count - 1 ? "}},\n" : "}}\n");
            }
            sb.Append("  ]\n}\n");
            return sb.ToString();
        }

        void OnDestroy()
        {
            if (_runner != null) _runner.TreeLoaded -= Attach;
            if (_tree != null) _tree.Ticked -= Record;
            if (saveOnDestroy && recording && _frames.Count > 0) Save();
        }

        public void Clear() { _frames.Clear(); _tick = 0; }

        static string Quote(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (var c in s ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }

        static string SerializeValue(object v)
        {
            switch (v)
            {
                case null: return "null";
                case bool b: return b ? "true" : "false";
                case float f: return float.IsFinite(f) ? f.ToString("R", CultureInfo.InvariantCulture) : "null";
                case double d: return double.IsFinite(d) ? d.ToString("R", CultureInfo.InvariantCulture) : "null";
                case int i: return i.ToString(CultureInfo.InvariantCulture);
                case long l: return l.ToString(CultureInfo.InvariantCulture);
                case string s: return Quote(s);
                case Vector3 v3: return $"[{v3.x.ToString("R", CultureInfo.InvariantCulture)},{v3.y.ToString("R", CultureInfo.InvariantCulture)},{v3.z.ToString("R", CultureInfo.InvariantCulture)}]";
                default: return Quote(v.ToString());
            }
        }

        sealed class Frame
        {
            public int tick;
            public float timestamp;
            public readonly List<KeyValuePair<string, string>> nodes = new List<KeyValuePair<string, string>>();
            public readonly List<KeyValuePair<string, string>> blackboard = new List<KeyValuePair<string, string>>();
        }
    }
}
