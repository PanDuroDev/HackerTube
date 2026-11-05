"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("installer", {
  getDefaults: () => ipcRenderer.invoke("installer:defaults"),
  chooseDirectory: (current) => ipcRenderer.invoke("installer:choose-dir", String(current || "")),
  install: (options) => ipcRenderer.invoke("installer:install", options),
  uninstall: () => ipcRenderer.invoke("installer:uninstall"),
  finishUninstall: () => ipcRenderer.invoke("installer:finish-uninstall"),
  launch: (dir) => ipcRenderer.invoke("installer:launch", String(dir || "")),
  close: () => ipcRenderer.send("installer:close"),
  minimize: () => ipcRenderer.send("installer:minimize"),
  openSite: () => ipcRenderer.send("installer:open-site"),
  onProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("installer:progress", listener);
    return () => ipcRenderer.removeListener("installer:progress", listener);
  },
});
