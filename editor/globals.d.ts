// File System Access API (Chromium/WebView2) — not yet in TypeScript's DOM lib.
// The editor feature-detects these before calling them.
interface Window {
  showOpenFilePicker(options?: object): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: object): Promise<FileSystemFileHandle>;
  showDirectoryPicker(options?: object): Promise<FileSystemDirectoryHandle>;
}
