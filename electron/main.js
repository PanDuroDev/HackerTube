const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("node:path");

const APP_URL = (process.env.HACKERTUBE_URL || "https://pandurodev.github.io/HackerTube/").replace(/\/?$/, "/");
const APP_ID = "com.pandurodev.hackertube";
let win = null;

function isTrusted(event) {
  return String(event.senderFrame?.url || "").startsWith(APP_URL);
}

function createWindow() {
  win = new BrowserWindow({
    title: "HackerTube",
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    backgroundColor: "#0f0f0f",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win?.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("maximize", () => win?.webContents.send("window:maximized", true));
  win.on("unmaximize", () => win?.webContents.send("window:maximized", false));
  win.on("closed", () => { win = null; });

  win.loadURL(APP_URL);
}

ipcMain.on("window:minimize", (event) => {
  if (isTrusted(event)) win?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  if (!isTrusted(event) || !win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on("window:close", (event) => {
  if (isTrusted(event)) win?.close();
});

ipcMain.handle("window:is-maximized", (event) => (
  isTrusted(event) && win ? win.isMaximized() : false
));

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      { role: "windowMenu" },
    ]));
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
