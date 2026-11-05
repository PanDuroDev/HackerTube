const { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const update = require("./update");
const installer = require("./installer");

// The desktop app loads the bundled site from a stable loopback origin.
// YouTube rejects the custom app:// origin with player error 153.
const LEGACY_ORIGIN = "app://hackertube";
const LOCAL_PORT = 47821;
let APP_URL = process.env.HACKERTUBE_URL ? process.env.HACKERTUBE_URL.replace(/\/?$/, "/") : "";
const SITE_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "public")
  : path.join(__dirname, "..", "public");
const APP_ID = "com.pandurodev.hackertube";
let win = null;
let updateInFlight = false;
let localServer = null;

const installerLaunch = process.argv.includes("--installer")
  || (Boolean(process.env.PORTABLE_EXECUTABLE_FILE) && !installer.isInstalledCopy(process.env.PORTABLE_EXECUTABLE_FILE));
const uninstallLaunch = process.argv.includes("--uninstall");
const autoInstall = process.argv.includes("--auto");
const standaloneInstaller = installerLaunch || uninstallLaunch;

protocol.registerSchemesAsPrivileged([{
  scheme: "app",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function resolveSiteFile(root, pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return null;
  }
  return file;
}

// Kept only for migrating localStorage written by v1.0.3 under app://.
function registerLegacySite() {
  const root = path.resolve(SITE_ROOT);
  protocol.handle("app", (request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/__storage") {
      return new Response("<!doctype html><meta charset=\"utf-8\"><title>storage</title>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    const file = resolveSiteFile(root, pathname);
    if (!file) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function startLocalSite() {
  if (APP_URL) return Promise.resolve(APP_URL);
  const root = path.resolve(SITE_ROOT);
  const handler = (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      if (pathname === "/__storage") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<!doctype html><meta charset=\"utf-8\"><title>storage</title>");
        return;
      }
      const file = resolveSiteFile(root, pathname);
      if (!file) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      fs.createReadStream(file).pipe(response);
    } catch {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Server error");
    }
  };

  return new Promise((resolve, reject) => {
    let port = LOCAL_PORT;
    const attempt = () => {
      const server = http.createServer(handler);
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE" && port < LOCAL_PORT + 20) {
          port += 1;
          attempt();
          return;
        }
        reject(error);
      });
      server.listen(port, "127.0.0.1", () => {
        localServer = server;
        APP_URL = `http://127.0.0.1:${port}/`;
        resolve(APP_URL);
      });
    };
    attempt();
  });
}

function storageUrl(origin) {
  return `${origin.replace(/\/?$/, "/")}__storage`;
}

async function readStorage(url) {
  const hidden = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await hidden.loadURL(url);
    const raw = await hidden.webContents.executeJavaScript(
      "JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])))",
    );
    return JSON.parse(raw || "{}");
  } finally {
    hidden.destroy();
  }
}

async function migrateLegacyStorage() {
  if (!app.isPackaged || !APP_URL.startsWith("http://127.0.0.1:")) return;
  const marker = path.join(app.getPath("userData"), "http-storage-migrated-v1.json");
  if (fs.existsSync(marker)) return;

  let legacy = {};
  try {
    legacy = await readStorage(storageUrl(LEGACY_ORIGIN));
  } catch {
    legacy = {};
  }
  const keys = Object.keys(legacy).filter((key) => key.startsWith("ht_"));
  if (!keys.length) {
    try { fs.writeFileSync(marker, "{}"); } catch { /* retry next launch */ }
    return;
  }

  const shadow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await shadow.loadURL(storageUrl(APP_URL));
    await shadow.webContents.executeJavaScript(
      `(() => { const data = ${JSON.stringify(legacy)}; for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value); })()`,
    );
    fs.writeFileSync(marker, JSON.stringify({ migratedAt: new Date().toISOString(), keys }));
  } catch {
    // Leave the marker absent so the next launch retries.
  } finally {
    shadow.destroy();
  }
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
  if (process.platform === "darwin") {
    // A DMG cannot replace the running .app automatically; open it for a manual drag install.
    const error = await shell.openPath(file);
    if (error) shell.showItemInFolder(file);
    return "manual";
  }
  if (process.platform === "linux") return replaceAppImage(file);
  if (await spawnDetached(file, ["--installer", "--auto"])) return true;
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

    try {
      const file = await downloadUpdate(info.asset, info.version);
      const launched = await launchInstaller(file);
      if (launched === "manual") {
        return { ok: true, version: info.version, manual: true, manualType: process.platform === "darwin" ? "macos" : "file" };
      }
      if (!launched) return { ok: true, version: info.version, manual: true, manualType: "file" };
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
    installer.start(uninstallLaunch ? "uninstall" : "install", null, autoInstall);
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

    app.whenReady().then(async () => {
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
      registerLegacySite();
      try {
        await startLocalSite();
      } catch (error) {
        console.error("Local site server failed", error);
        APP_URL = "https://pandurodev.github.io/HackerTube/";
      }
      await migrateLegacyStorage();
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
