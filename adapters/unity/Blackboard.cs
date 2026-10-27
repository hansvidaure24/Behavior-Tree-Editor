using System.Collections.Generic;

namespace BehaviorTreeRuntime
{
    public class Blackboard
    {
        readonly Dictionary<string, object> _data = new();

        public void Set<T>(string key, T value) => _data[key] = value;

        public T Get<T>(string key, T fallback = default)
        {
            if (_data.TryGetValue(key, out var val) && val is T typed)
                return typed;
            return fallback;
        }

        public bool Has(string key) => _data.ContainsKey(key);
        public void Remove(string key) => _data.Remove(key);
        public void Clear() => _data.Clear();

        /// <summary>Enumerate all entries — used by TickRecorder for snapshots.</summary>
        public IEnumerable<KeyValuePair<string, object>> All() => _data;
    }
}
