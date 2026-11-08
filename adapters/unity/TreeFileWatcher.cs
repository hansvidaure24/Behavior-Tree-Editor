#if UNITY_EDITOR
using System;
using System.IO;
using UnityEngine;

namespace BehaviorTreeRuntime
{
    /// <summary>
    /// Editor only: notices when a tree asset's file changes on disk. Unity re-imports a changed TextAsset only
    /// when its window regains focus; reading the file directly lets a tree saved from the Behavior Tree Editor
    /// update a playing scene while Unity is in the background. A change is accepted once the file has stopped
    /// changing for one poll, so a half-written file is never read.
    /// </summary>
    public sealed class TreeFileWatcher
    {
        readonly string _path;
        readonly float _interval;
        DateTime _acceptedWrite;
        long _acceptedLength;
        DateTime _pendingWrite;
        long _pendingLength = -1;
        float _nextCheck;

        public TreeFileWatcher(TextAsset asset, float interval = 0.5f)
        {
            var relative = asset != null ? UnityEditor.AssetDatabase.GetAssetPath(asset) : null;
            _path = string.IsNullOrEmpty(relative) ? null : Path.GetFullPath(relative);
            _interval = interval;
            if (_path != null && File.Exists(_path))
            {
                var info = new FileInfo(_path);
                _acceptedWrite = info.LastWriteTimeUtc;
                _acceptedLength = info.Length;
            }
        }

        public string FilePath => _path;

        /// <summary>The file's new text once it has changed and settled; otherwise null. Cheap to call every frame.</summary>
        public string Poll()
        {
            if (_path == null || Time.realtimeSinceStartup < _nextCheck) return null;
            _nextCheck = Time.realtimeSinceStartup + _interval;
            FileInfo info;
            try
            {
                info = new FileInfo(_path);
                if (!info.Exists) return null;
            }
            catch (IOException) { return null; }

            var write = info.LastWriteTimeUtc;
            var length = info.Length;
            if (write == _acceptedWrite && length == _acceptedLength) return null;
            if (write != _pendingWrite || length != _pendingLength)
            {
                // Changed since the last look: wait one more poll to be sure the writer is done.
                _pendingWrite = write;
                _pendingLength = length;
                return null;
            }
            try
            {
                using (var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var reader = new StreamReader(stream))
                {
                    var text = reader.ReadToEnd();
                    _acceptedWrite = write;
                    _acceptedLength = length;
                    return text;
                }
            }
            catch (IOException) { return null; } // locked by the writer: try again next poll
        }
    }
}
#endif
