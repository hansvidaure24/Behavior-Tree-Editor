using System;
using UnityEngine;

namespace BehaviorTreeRuntime
{
    /// <summary>
    /// Runs a .bt.json tree on a GameObject. Register game code on <see cref="Bindings"/> (any time before the
    /// nodes first run — Awake or Start of another component is fine), then the runner ticks the tree.
    /// In the Editor it rebuilds the tree whenever the .bt.json asset changes, keeping the blackboard,
    /// so saving from the Behavior Tree Editor updates a playing scene.
    /// </summary>
    [AddComponentMenu("Behavior Tree/Behavior Tree Runner")]
    public class BehaviorTreeRunner : MonoBehaviour
    {
        [Tooltip("The .bt.json exported from the Behavior Tree Editor.")]
        public TextAsset treeAsset;

        [Tooltip("Seconds between ticks. 0 = tick every frame.")]
        [Min(0f)] public float tickInterval;

        [Tooltip("Log every node status change to the Console.")]
        public bool debugLog;

        [Tooltip("Editor only: rebuild the tree when the .bt.json asset is re-imported.")]
        public bool reloadOnChange = true;

        public BTBindings Bindings { get; } = new BTBindings();
        public Blackboard Blackboard { get; } = new Blackboard();
        public BehaviorTree Tree { get; private set; }
        public string TreeTitle => Tree != null ? Tree.Title : "";

        /// <summary>Raised whenever a tree is (re)built — first load and every hot reload.</summary>
        public event Action<BehaviorTree> TreeLoaded;

        float _accumulator;
        string _lastSeenText;
        float _nextReloadCheck;
#if UNITY_EDITOR
        TreeFileWatcher _watcher;
        TextAsset _watchedAsset;
#endif

        public BTBindings RegisterAction(string name, Func<BTContext, NodeStatus> onTick,
            Action<BTContext> onEnter = null, Action<BTContext> onAbort = null, bool interruptible = true) =>
            Bindings.RegisterAction(name, onTick, onEnter, onAbort, interruptible);

        public BTBindings RegisterCondition(string name, Func<BTContext, bool> check) => Bindings.RegisterCondition(name, check);

        protected virtual void Start()
        {
            if (Tree == null && treeAsset != null) LoadFromJson(treeAsset.text);
            else if (Tree == null) Debug.LogWarning($"[BT {name}] No tree asset assigned.", this);
        }

        /// <summary>
        /// Build a tree from JSON text and swap it in (the old tree is aborted first). On failure the error is
        /// logged and the current tree keeps running.
        /// </summary>
        public bool LoadFromJson(string json)
        {
            _lastSeenText = json;
            BehaviorTree next;
            try
            {
                next = BehaviorTree.FromJson(json, Bindings, Blackboard);
            }
            catch (BehaviorTreeLoadException e)
            {
                Debug.LogError($"[BT {name}] Could not load tree: {e.Message}", this);
                return false;
            }
            Tree?.Abort();
            next.Owner = gameObject;
            next.DebugName = name;
            next.DebugContext = this;
            next.DebugLog = debugLog;
            Tree = next;
            _accumulator = 0f;
            TreeLoaded?.Invoke(Tree);
            return true;
        }

        /// <summary>Rebuild from <see cref="treeAsset"/>.</summary>
        public bool Reload() => treeAsset != null && LoadFromJson(treeAsset.text);

        /// <summary>Tick once now, outside the normal schedule (debug stepping, tests).</summary>
        public NodeStatus TickNow(float deltaTime) => Tree != null ? Tree.Tick(deltaTime) : NodeStatus.Failure;

        protected virtual void Update()
        {
#if UNITY_EDITOR
            if (reloadOnChange && treeAsset != null && Tree != null) CheckForReload();
#endif
            if (Tree == null) return;
            Tree.DebugLog = debugLog;
            if (tickInterval <= 0f)
            {
                Tree.Tick(Time.deltaTime);
                return;
            }
            _accumulator += Time.deltaTime;
            for (int i = 0; i < 4 && _accumulator >= tickInterval; i++)
            {
                _accumulator -= tickInterval;
                Tree.Tick(tickInterval);
            }
            if (_accumulator > tickInterval) _accumulator = 0f; // don't spiral after a hitch
        }

        protected virtual void OnDisable() => Tree?.Abort();

#if UNITY_EDITOR
        // The file on disk (saved from the Behavior Tree Editor, even with Unity in the background), or the
        // re-imported asset text when the asset has no file of its own.
        void CheckForReload()
        {
            if (_watchedAsset != treeAsset)
            {
                _watchedAsset = treeAsset;
                _watcher = new TreeFileWatcher(treeAsset);
            }
            string text = _watcher.FilePath != null ? _watcher.Poll() : null;
            if (text == null && _watcher.FilePath == null && Time.realtimeSinceStartup >= _nextReloadCheck)
            {
                _nextReloadCheck = Time.realtimeSinceStartup + 0.5f;
                text = treeAsset.text;
            }
            if (text != null && text != _lastSeenText && LoadFromJson(text))
                Debug.Log($"[BT {name}] Reloaded \"{Tree.Title}\" from {treeAsset.name}.", this);
        }
#endif
    }
}
