const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const update = require("./update");
const installer = require("./installer");

// The desktop app loads the bundled site from disk instead of GitHub Pages.
const LOCAL_ORIGIN = "app://hackertube";
const APP_URL = (process.env.HACKERTUBE_URL || `${LOCAL_ORIGIN}/`).replace(/\/?$/, "/");
const SITE_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "public")
  : path.join(__dirname, "..", "public");
const APP_ID = "com.pandurodev.hackertube";
let win = null;

const installerLaunch = Boolean(process.env.PORTABLE_EXECUTABLE_FILE) || process.argv.includes("--installer");
const uninstallLaunch = process.argv.includes("--uninstall");
const standaloneInstaller = installerLaunch || uninstallLaunch;

protocol.registerSchemesAsPrivileged([{
  scheme: "app",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

function serveLocalSite() {
  if (!APP_URL.startsWith(`${LOCAL_ORIGIN}/`)) return;
  const root = path.resolve(SITE_ROOT);
  protocol.handle("app", (request) => {
    const relative = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

function isTrusted(event) {
  return String(event.senderFrame?.url || "").startsWith(APP_URL);
}

async function latestReleaseInfo() {
  const response = await net.fetch(update.RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "HackerTube-Desktop",
    },
  });
  if (!response.ok) return { ok: false, reason: `http-${response.status}` };

  const release = await response.json();
  const current = app.getVersion();
  const tag = String(release.tag_name || release.name || "");
  if (!update.isNewerVersion(current, tag)) return { ok: true, available: false, current };

  const asset = update.pickReleaseAsset(release.assets || [], process.platform, process.arch);
  if (!asset) return { ok: false, reason: "no-asset", current };

  return {
    ok: true,
    available: true,
    current,
    version: tag.replace(/^v/i, ""),
    asset: {
      name: path.basename(asset.name),
      url: asset.browser_download_url,
      size: asset.size,
    },
  };
}

async function downloadUpdate(asset) {
  if (!update.isReleaseDownloadUrl(asset?.url)) throw new Error("Untrusted update URL");
  const response = await net.fetch(asset.url, { headers: { "User-Agent": "HackerTube-Desktop" } });
  if (!response.ok || !response.body) throw new Error(`Update download failed: HTTP ${response.status}`);

  const file = path.join(app.getPath("temp"), `hackertube-${Date.now()}-${path.basename(asset.name)}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file));
  return file;
}

async function launchInstaller(file) {
  if (process.platform === "linux") {
    // Running the new AppImage from temp would not replace the installed one.
    fs.chmodSync(file, 0o755);
    shell.showItemInFolder(file);
    return false;
  }
  const error = await shell.openPath(file);
  if (error) {
    shell.showItemInFolder(file);
    return false;
  }
  return true;
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
      spellcheck: false,
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

ipcMain.handle("app:version", (event) => (isTrusted(event) ? app.getVersion() : null));

ipcMain.handle("app:check-update", async (event) => {
  if (!isTrusted(event)) return { ok: false, reason: "untrusted" };
  try {
    return await latestReleaseInfo();
  } catch {
    return { ok: false, reason: "network" };
  }
});

ipcMain.handle("app:install-update", async (event) => {
  if (!isTrusted(event) || !win) return { ok: false, reason: "untrusted" };

  let info;
  try {
    info = await latestReleaseInfo();
  } catch {
    return { ok: false, reason: "network" };
  }
  if (!info.available) return info;
  if (!update.isReleaseDownloadUrl(info.asset.url)) return { ok: false, reason: "untrusted-asset" };

  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Cancel", "Install update"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    title: "Update HackerTube",
    message: `Install HackerTube ${info.version}?`,
    detail: "The update downloads from GitHub. The app will close while the installer opens. Your likes, history, playlists and settings are kept.",
  });
  if (response !== 1) return { ok: false, canceled: true };

  try {
    const file = await downloadUpdate(info.asset);
    const launched = await launchInstaller(file);
    if (!launched) return { ok: true, version: info.version, manual: true };
    setTimeout(() => app.quit(), 700);
    return { ok: true, version: info.version };
  } catch {
    return { ok: false, reason: "download" };
  }
});

ipcMain.handle("app:uninstall", (event) => {
  if (!isTrusted(event) || !win) return { ok: false, reason: "untrusted" };
  installer.openWindow("uninstall", win);
  return { ok: true, handled: true };
});

if (standaloneInstaller) {
  app.whenReady().then(() => {
    app.setAppUserModelId(APP_ID);
    installer.start(uninstallLaunch ? "uninstall" : "install");
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
} else {
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
      serveLocalSite();
      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });
  }
}
