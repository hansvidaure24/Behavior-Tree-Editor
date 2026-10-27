/** Local-first storage — File System Access API + IndexedDB + bundled examples. No server needed. */
export const Storage = (() => {
  const DB_NAME = "bt-editor";
  const DB_VERSION = 1;
  const TREES_STORE = "trees";
  const VERSIONS_STORE = "versions";
  const MAX_VERSIONS = 20;
  let _db = null;
  let _dirHandle = null;
  let _examples = null;

  function _openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TREES_STORE)) db.createObjectStore(TREES_STORE, { keyPath: "name" });
        if (!db.objectStoreNames.contains(VERSIONS_STORE)) db.createObjectStore(VERSIONS_STORE, { keyPath: "key" });
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function _tx(store, mode) {
    return _db.transaction(store, mode).objectStore(store);
  }

  function _idbGet(store, key) {
    return new Promise((resolve, reject) => {
      const req = _tx(store, "readonly").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function _idbPut(store, val) {
    return new Promise((resolve, reject) => {
      const req = _tx(store, "readwrite").put(val);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function _idbDelete(store, key) {
    return new Promise((resolve, reject) => {
      const req = _tx(store, "readwrite").delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function _idbGetAll(store) {
    return new Promise((resolve, reject) => {
      const req = _tx(store, "readonly").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Bundled examples (fetched once from /examples/) ---

  async function _loadExamples() {
    if (_examples) return _examples;
    try {
      const resp = await fetch("examples.json");
      if (resp.ok) {
        _examples = await resp.json();
        return _examples;
      }
    } catch {}
    _examples = [];
    return _examples;
  }

  // --- Directory handle persistence ---

  async function openDirectory() {
    if (!("showDirectoryPicker" in window)) return null;
    try {
      _dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      try { localStorage.setItem("bt-dir-handle-name", _dirHandle.name); } catch {}
      return _dirHandle;
    } catch { return null; }
  }

  function getDirectoryName() {
    return _dirHandle ? _dirHandle.name : null;
  }

  function hasDirectory() { return _dirHandle !== null; }

  async function _writeToDirHandle(filename, data) {
    if (!_dirHandle) return;
    try {
      const fh = await _dirHandle.getFileHandle(filename + ".bt.json", { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(data.tree, null, 2) + "\n");
      await w.close();
      if (data.layout && Object.keys(data.layout.nodes || {}).length > 0) {
        const lh = await _dirHandle.getFileHandle(filename + ".bt.layout.json", { create: true });
        const lw = await lh.createWritable();
        await lw.write(JSON.stringify(data.layout, null, 2) + "\n");
        await lw.close();
      }
    } catch {}
  }

  async function _readFromDirHandle(filename) {
    if (!_dirHandle) return null;
    try {
      const fh = await _dirHandle.getFileHandle(filename + ".bt.json");
      const file = await fh.getFile();
      const tree = JSON.parse(await file.text());
      let layout = { version: "1.0", nodes: {} };
      try {
        const lh = await _dirHandle.getFileHandle(filename + ".bt.layout.json");
        layout = JSON.parse(await (await lh.getFile()).text());
      } catch {}
      return { tree, layout };
    } catch { return null; }
  }

  async function _listDirHandleTrees() {
    if (!_dirHandle) return [];
    const files = [];
    try {
      for await (const [name, handle] of _dirHandle) {
        if (handle.kind === "file" && name.endsWith(".bt.json") && !name.endsWith(".layout.json")) {
          const treeName = name.replace(".bt.json", "");
          try {
            const file = await handle.getFile();
            const tree = JSON.parse(await file.text());
            files.push({ name: treeName, dir: "folder", nodeCount: Object.keys(tree.nodes || {}).length });
          } catch {
            files.push({ name: treeName, dir: "folder" });
          }
        }
      }
    } catch {}
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function _deleteFromDirHandle(filename) {
    if (!_dirHandle) return;
    try { await _dirHandle.removeEntry(filename + ".bt.json"); } catch {}
    try { await _dirHandle.removeEntry(filename + ".bt.layout.json"); } catch {}
  }

  async function _listDirHandleReplays() {
    if (!_dirHandle) return [];
    const files = [];
    try {
      for await (const [name, handle] of _dirHandle) {
        if (handle.kind === "file" && name.endsWith(".replay.json")) {
          files.push({ name: name.replace(".replay.json", ""), dir: "folder" });
        }
      }
    } catch {}
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function _readReplayFromDirHandle(name) {
    if (!_dirHandle) return null;
    try {
      const fh = await _dirHandle.getFileHandle(name + ".replay.json");
      return JSON.parse(await (await fh.getFile()).text());
    } catch { return null; }
  }

  // --- Public API ---

  async function init() {
    await _openDB();
    await _loadExamples();
  }

  async function listTrees() {
    const results = [];
    const examples = await _loadExamples();
    for (const ex of examples) {
      results.push({ name: ex.name, dir: "examples", nodeCount: Object.keys((ex.tree || {}).nodes || {}).length });
    }
    const saved = await _idbGetAll(TREES_STORE);
    for (const s of saved.sort((a, b) => a.name.localeCompare(b.name))) {
      results.push({ name: s.name, dir: "local", nodeCount: Object.keys((s.tree || {}).nodes || {}).length });
    }
    if (_dirHandle) {
      const dirTrees = await _listDirHandleTrees();
      for (const dt of dirTrees) results.push(dt);
    }
    return results;
  }

  async function loadTree(dir, name) {
    if (dir === "examples") {
      const examples = await _loadExamples();
      const ex = examples.find(e => e.name === name);
      if (ex) return { tree: ex.tree, layout: ex.layout || { version: "1.0", nodes: {} } };
      return null;
    }
    if (dir === "folder") return _readFromDirHandle(name);
    const saved = await _idbGet(TREES_STORE, name);
    if (saved) return { tree: saved.tree, layout: saved.layout || { version: "1.0", nodes: {} } };
    return null;
  }

  async function saveTree(name, tree, layout) {
    // Version the old one first
    const existing = await _idbGet(TREES_STORE, name);
    if (existing) {
      const vKey = name + "/" + Date.now();
      await _idbPut(VERSIONS_STORE, { key: vKey, name, tree: existing.tree, layout: existing.layout, ts: Date.now() });
      await _pruneVersions(name);
    }
    await _idbPut(TREES_STORE, { name, tree, layout });
    await _writeToDirHandle(name, { tree, layout });
  }

  async function deleteTree(name) {
    await _idbDelete(TREES_STORE, name);
    await _deleteFromDirHandle(name);
  }

  async function _pruneVersions(name) {
    const all = await _idbGetAll(VERSIONS_STORE);
    const mine = all.filter(v => v.name === name).sort((a, b) => b.ts - a.ts);
    for (const old of mine.slice(MAX_VERSIONS)) {
      await _idbDelete(VERSIONS_STORE, old.key);
    }
  }

  async function listVersions(name) {
    const all = await _idbGetAll(VERSIONS_STORE);
    return all.filter(v => v.name === name)
      .sort((a, b) => b.ts - a.ts)
      .map(v => ({ timestamp: Math.floor(v.ts / 1000), nodeCount: Object.keys((v.tree || {}).nodes || {}).length, _ts: v.ts }));
  }

  async function loadVersion(name, timestamp) {
    const all = await _idbGetAll(VERSIONS_STORE);
    const match = all.find(v => v.name === name && Math.floor(v.ts / 1000) === timestamp);
    if (match) return { tree: match.tree, layout: match.layout || { version: "1.0", nodes: {} } };
    return null;
  }

  async function listReplays() {
    const results = [];
    const examples = await _loadExamples();
    for (const ex of examples) {
      if (ex.replay) results.push({ name: ex.name, dir: "examples" });
    }
    if (_dirHandle) {
      const dirReplays = await _listDirHandleReplays();
      for (const dr of dirReplays) results.push(dr);
    }
    return results;
  }

  async function loadReplay(dir, name) {
    if (dir === "examples") {
      const examples = await _loadExamples();
      const ex = examples.find(e => e.name === name);
      if (ex && ex.replay) return ex.replay;
      return null;
    }
    if (dir === "folder") return _readReplayFromDirHandle(name);
    return null;
  }

  return {
    init, listTrees, loadTree, saveTree, deleteTree,
    listVersions, loadVersion,
    listReplays, loadReplay,
    openDirectory, getDirectoryName, hasDirectory,
  };
})();
