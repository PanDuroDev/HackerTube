const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { Readable, Transform } = require("node:stream");
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
let updateInFlight = false;

const installerLaunch = process.argv.includes("--installer")
  || (Boolean(process.env.PORTABLE_EXECUTABLE_FILE) && !installer.isInstalledCopy(process.env.PORTABLE_EXECUTABLE_FILE));
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

function updateDir() {
  return path.join(app.getPath("temp"), "hackertube-updates");
}

function updateFilePath(asset, version) {
  const safeVersion = String(version || "latest").replace(/[^\w.-]/g, "");
  return path.join(updateDir(), `${safeVersion}-${path.basename(asset.name)}`);
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

// Keep only the build we are about to use so temp never holds several 100 MB copies.
function pruneUpdateFiles(keep) {
  try {
    for (const name of fs.readdirSync(updateDir())) {
      const file = path.join(updateDir(), name);
      if (file !== keep) fs.rmSync(file, { recursive: true, force: true });
    }
  } catch { /* nothing to prune */ }
}

function reportDownload(received, total) {
  const percent = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0;
  win?.webContents.send("app:update-progress", { received, total, percent });
}

async function downloadUpdate(asset, version) {
  if (!update.isReleaseDownloadUrl(asset?.url)) throw new Error("Untrusted update URL");
  fs.mkdirSync(updateDir(), { recursive: true });
  const file = updateFilePath(asset, version);
  pruneUpdateFiles(file);

  const expected = Number(asset.size) || 0;
  const have = fileSize(file);
  if (update.isCompleteDownload(have, expected)) return file;

  const start = update.resumeOffset(have, expected);
  if (!start) fs.rmSync(file, { force: true });

  const headers = { "User-Agent": "HackerTube-Desktop" };
  if (start) headers.Range = `bytes=${start}-`;
  const response = await net.fetch(asset.url, { headers });
  if (!response.ok || !response.body) throw new Error(`Update download failed: HTTP ${response.status}`);

  // GitHub only honours the range when it replies 206; otherwise start the file over.
  const resumed = start > 0 && response.status === 206;
  if (start && !resumed) fs.rmSync(file, { force: true });
  let received = resumed ? start : 0;
  const total = expected || Number(response.headers.get("content-length")) + received || 0;
  let lastTick = 0;

  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      const now = Date.now();
      if (now - lastTick > 150) {
        lastTick = now;
        reportDownload(received, total);
      }
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body),
    counter,
    fs.createWriteStream(file, { flags: resumed ? "a" : "w" }),
  );

  const size = fileSize(file);
  if (total && !update.isCompleteDownload(size, total)) {
    fs.rmSync(file, { force: true });
    throw new Error("Update download was incomplete");
  }
  reportDownload(size, total || size);
  return file;
}

function spawnDetached(file, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: false });
    } catch {
      resolve(false);
      return;
    }
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

// Replace the running AppImage in place so Linux gets no manual "move the file" step.
function replaceAppImage(file) {
  const current = process.env.APPIMAGE;
  if (!current || !fs.existsSync(current)) return false;
  const staged = `${current}.new`;
  let movedCurrent = false;
  try {
    fs.copyFileSync(file, staged);
    fs.chmodSync(staged, 0o755);
    fs.renameSync(current, `${current}.old`);
    movedCurrent = true;
    fs.renameSync(staged, current);
  } catch {
    if (movedCurrent) {
      try { fs.renameSync(`${current}.old`, current); } catch { /* keep the backup for manual recovery */ }
    }
    fs.rmSync(staged, { force: true });
    return false;
  }
  app.relaunch({ execPath: current, args: [] });
  return true;
}

async function launchInstaller(file) {
  if (process.platform === "linux") return replaceAppImage(file);
  if (await spawnDetached(file, ["--installer"])) return true;
  const error = await shell.openPath(file);
  if (!error) return true;
  shell.showItemInFolder(file);
  return false;
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
  if (updateInFlight) return { ok: false, reason: "busy" };
  updateInFlight = true;

  try {
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
      detail: "The update downloads from GitHub and replaces the installed copy in place, keeping your likes, history, playlists and settings. If a download was interrupted it continues where it stopped.",
    });
    if (response !== 1) return { ok: false, canceled: true };

    try {
      const file = await downloadUpdate(info.asset, info.version);
      const launched = await launchInstaller(file);
      if (!launched) return { ok: true, version: info.version, manual: true };
      setTimeout(() => app.quit(), 700);
      return { ok: true, version: info.version };
    } catch {
      return { ok: false, reason: "download" };
    }
  } finally {
    updateInFlight = false;
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
      // The previous AppImage is replaced in place during an update; drop the leftover.
      if (process.env.APPIMAGE) {
        try { fs.rmSync(`${process.env.APPIMAGE}.old`, { force: true }); } catch { /* retry on next start */ }
      }
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
