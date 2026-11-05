const { contextBridge, ipcRenderer } = require("electron");

if (window.top === window) {
  contextBridge.exposeInMainWorld("electronWindow", {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    getAppVersion: () => ipcRenderer.invoke("app:version"),
    checkForUpdate: () => ipcRenderer.invoke("app:check-update"),
    installUpdate: () => ipcRenderer.invoke("app:install-update"),
    onUpdateProgress: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("app:update-progress", listener);
      return () => ipcRenderer.removeListener("app:update-progress", listener);
    },
    uninstall: () => ipcRenderer.invoke("app:uninstall"),
    setCustomPlayerChrome: (enabled) => ipcRenderer.invoke("app:custom-player-chrome", Boolean(enabled)),
    isCustomPlayerChromeApplied: () => ipcRenderer.invoke("app:custom-player-chrome-applied"),
    getYouTubeChapters: () => ipcRenderer.invoke("app:youtube-chapters"),
    setYouTubeQuality: (level) => ipcRenderer.invoke("app:youtube-quality", String(level)),
    searchBackendStatus: () => ipcRenderer.invoke("app:search-backend-status"),
    searchCatalog: (query, limit) => ipcRenderer.invoke("app:search-catalog", String(query), Number(limit) || 0),
    searchBackendStats: () => ipcRenderer.invoke("app:search-backend-stats"),
    trimSearchBackend: () => ipcRenderer.invoke("app:search-backend-trim"),
    onMaximizedChange: (callback) => {
      const listener = (_event, maximized) => callback(Boolean(maximized));
      ipcRenderer.on("window:maximized", listener);
      return () => ipcRenderer.removeListener("window:maximized", listener);
    },
  });
}
