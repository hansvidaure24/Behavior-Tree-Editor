using System;
using System.Collections.Generic;
using System.Globalization;

namespace BehaviorTreeRuntime
{
    /// <summary>
    /// Per-agent key/value memory shared by every node of a tree (and kept across hot reloads).
    /// Numeric reads convert between int/float/double, so a value set as an int can be read as a float.
    /// </summary>
    public class Blackboard
    {
        readonly Dictionary<string, object> _data = new Dictionary<string, object>();

        public void Set<T>(string key, T value) => _data[key] = value;

        public T Get<T>(string key, T fallback = default)
        {
            return TryGet(key, out T value) ? value : fallback;
        }

        public bool TryGet<T>(string key, out T value)
        {
            value = default;
            if (!_data.TryGetValue(key, out var raw) || raw == null) return false;
            if (raw is T typed) { value = typed; return true; }
            var target = Nullable.GetUnderlyingType(typeof(T)) ?? typeof(T);
            if (raw is IConvertible && typeof(IConvertible).IsAssignableFrom(target) && !target.IsEnum)
            {
                try
                {
                    value = (T)Convert.ChangeType(raw, target, CultureInfo.InvariantCulture);
                    return true;
                }
                catch (Exception e) when (e is InvalidCastException || e is FormatException || e is OverflowException) { }
            }
            return false;
        }

        public bool TryGetRaw(string key, out object value) => _data.TryGetValue(key, out value);

        public bool Has(string key) => _data.ContainsKey(key);
        public bool Remove(string key) => _data.Remove(key);
        public void Clear() => _data.Clear();
        public int Count => _data.Count;

        /// <summary>All entries — used by TickRecorder for snapshots.</summary>
        public IEnumerable<KeyValuePair<string, object>> All() => _data;
    }
}
