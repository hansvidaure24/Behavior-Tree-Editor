// @ts-check
/**
 * Native file access in the desktop app (Tauri): file dialogs, reading/writing the chosen .bt.json directly, and
 * watching it for outside changes. Uses the `window.__TAURI__` globals so the editor still runs unbundled in a
 * browser, where `isDesktop` is false and the File System Access / download paths are used instead.
 */
const tauri = /** @type {any} */ (window).__TAURI__;

/** True inside the desktop app. */
export const isDesktop = !!(tauri && tauri.dialog && tauri.fs);

const FILTERS = [{ name: "Behavior Tree (.bt.json)", extensions: ["json"] }];
const LAST_DIR_KEY = "bt-desktop-last-dir";

/** @param {string} p */
export function dirname(p) {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : "";
}

/** @param {string} p */
export function basename(p) {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** @param {string} dir @param {string} name */
function join(dir, name) {
  return dir ? dir + (dir.includes("\\") ? "\\" : "/") + name : name;
}

/**
 * The layout sidecar for a tree file: guard.bt.json → guard.bt.layout.json.
 * @param {string} path
 */
export function layoutPathFor(path) {
  return /\.bt\.json$/i.test(path) ? path.replace(/\.bt\.json$/i, ".bt.layout.json") : path.replace(/\.json$/i, "") + ".layout.json";
}

function lastDir() {
  try { return localStorage.getItem(LAST_DIR_KEY) || ""; } catch { return ""; }
}

/** @param {string} path */
function rememberDir(path) {
  try { localStorage.setItem(LAST_DIR_KEY, dirname(path)); } catch { /* storage unavailable */ }
}

/**
 * Native "Open" dialog, starting in the folder last used (e.g. a Unity project's Assets folder).
 * @returns {Promise<string | null>} The chosen path, or null if cancelled.
 */
export async function pickOpenPath() {
  const dir = lastDir();
  const path = await tauri.dialog.open({ multiple: false, directory: false, filters: FILTERS, defaultPath: dir || undefined });
  if (typeof path !== "string") return null;
  rememberDir(path);
  return path;
}

/**
 * Native "Save As" dialog.
 * @param {string} suggestedName e.g. "gravewarden.bt.json"
 * @returns {Promise<string | null>}
 */
export async function pickSavePath(suggestedName) {
  const dir = lastDir();
  let path = await tauri.dialog.save({ filters: FILTERS, defaultPath: dir ? join(dir, suggestedName) : suggestedName });
  if (typeof path !== "string" || !path) return null;
  if (!/\.json$/i.test(path)) path += ".bt.json";
  rememberDir(path);
  return path;
}

/** @param {string} path @returns {Promise<string>} */
export function readText(path) {
  return tauri.fs.readTextFile(path);
}

/** @param {string} path @returns {Promise<boolean>} */
export function exists(path) {
  return tauri.fs.exists(path);
}

/**
 * Write via a hidden temp file and a rename, so a game engine watching the file never reads half of it.
 * (Unity ignores dot-files, so the temp file is never imported.)
 * @param {string} path
 * @param {string} text
 */
export async function writeTextAtomic(path, text) {
  const tmp = join(dirname(path), "." + basename(path) + ".tmp");
  await tauri.fs.writeTextFile(tmp, text);
  await tauri.fs.rename(tmp, path);
}

/**
 * Call `onChange` when the file changes on disk (debounced).
 * @param {string} path
 * @param {() => void} onChange
 * @returns {Promise<() => void>} Stops watching.
 */
export function watchFile(path, onChange) {
  return tauri.fs.watch(path, () => onChange(), { delayMs: 400 });
}
