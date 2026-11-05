const { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const readline = require("node:readline");
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
if (process.env.HACKERTUBE_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.HACKERTUBE_USER_DATA));
}
let win = null;
let updateInFlight = false;
let localServer = null;
let mainWindowStarted = false;
let searchBackend = null;
const startupTimers = new Set();

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
        "Cache-Control": app.isPackaged ? "public, max-age=31536000, immutable" : "no-cache",
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

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
    await withTimeout(hidden.loadURL(url), 5000);
    const raw = await withTimeout(hidden.webContents.executeJavaScript(
      "JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])))",
    ), 5000);
    return JSON.parse(raw || "{}");
  } finally {
    hidden.destroy();
  }
}

async function migrateLegacyStorage(hadStorageAtLaunch, forcedMigration) {
  if ((!app.isPackaged && !forcedMigration) || !hadStorageAtLaunch || !APP_URL.startsWith("http://127.0.0.1:")) return;
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
    await withTimeout(shadow.loadURL(storageUrl(APP_URL)), 5000);
    await withTimeout(shadow.webContents.executeJavaScript(
      `(() => { const data = ${JSON.stringify(legacy)}; let copied = 0; for (const [key, value] of Object.entries(data)) { if (key.startsWith("ht_") && localStorage.getItem(key) === null) { localStorage.setItem(key, value); copied++; } } return copied; })()`,
    ), 5000);
    fs.writeFileSync(marker, JSON.stringify({ migratedAt: new Date().toISOString(), keys }));
  } catch {
    // Leave the marker absent so the next launch retries.
  } finally {
    shadow.destroy();
  }
}

function scheduleLegacyStorageMigration(hadStorageAtLaunch, forcedMigration) {
  const timer = setTimeout(() => {
    startupTimers.delete(timer);
    migrateLegacyStorage(hadStorageAtLaunch, forcedMigration).catch(() => {});
  }, 2500);
  timer.unref?.();
  startupTimers.add(timer);
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

const YOUTUBE_FRAME_RE = /^https:\/\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com)\/embed\//i;
const CUSTOM_CHROME_STYLE_ID = "hackertube-custom-player-chrome";
const CUSTOM_CHROME_CSS = `
ytm-cued-overlay,
.ytmCuedOverlayHost,
embedded-player-video-details,
.ytmVideoInfoHost,
player-top-controls,
.ytwPlayerTopControlsHost,
player-middle-controls,
.ytwPlayerMiddleControlsHost,
player-bottom-controls,
.ytwPlayerBottomControlsHost,
yt-progress-bar,
.ytPlayerProgressBarHost,
player-fullscreen-controls,
.ytwPlayerFullscreenControlsHost,
player-fullscreen-action-menu,
.fullscreen-action-menu,
.fullscreen-controls,
.ytFullscreenVideoRecommendationsHost,
.fullscreen-watch-next-entrypoint-wrapper,
.ytmFullscreenRelatedVideosEntryPointViewModelHost,
yt-player-seek-overlay,
.ytwPlayerSeekOverlayHost,
.player-controls-background,
.player-controls-background-container,
.watch-on-youtube-button-wrapper,
.watch-on-youtube-button,
.ytp-chrome-top,
.ytp-chrome-controls,
.ytp-progress-bar-container,
.ytp-gradient-top,
.ytp-gradient-bottom,
.ytp-cued-thumbnail-overlay,
.ytp-large-play-button,
.ytp-watermark,
.ytp-pause-overlay,
.ytp-endscreen-content,
.ytp-ce-element,
.ytp-title,
yt-bigboard,
.ytp-bezel,
.ytp-bezel-text-wrapper,
.ytp-popup,
.ytp-settings-menu,
.ytp-contextmenu,
.ytp-tooltip {
  display: none !important;
}
`;
const customChromeWindows = new WeakMap();

function customChromeScript(enabled) {
  if (!enabled) {
    return `document.getElementById(${JSON.stringify(CUSTOM_CHROME_STYLE_ID)})?.remove(); true;`;
  }
  return `(() => {
    const id = ${JSON.stringify(CUSTOM_CHROME_STYLE_ID)};
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      (document.head || document.documentElement).append(style);
    }
    style.textContent = ${JSON.stringify(CUSTOM_CHROME_CSS)};
    return true;
  })()`;
}

function youtubeFrames(webContents) {
  if (!webContents || webContents.isDestroyed?.()) return [];
  const root = webContents.mainFrame;
  if (!root) return [];
  let frames = [];
  try {
    frames = [...(root.framesInSubtree || root.frames || [])];
  } catch {
    return [];
  }
  return frames.filter((frame) => {
    try {
      return YOUTUBE_FRAME_RE.test(frame.url || "");
    } catch {
      return false;
    }
  });
}

function applyCustomPlayerChrome(webContents) {
  if (!webContents || webContents.isDestroyed?.()) return;
  const enabled = customChromeWindows.get(webContents) === true;
  for (const frame of youtubeFrames(webContents)) {
    try {
      frame.executeJavaScript(customChromeScript(enabled)).catch(() => {});
    } catch {
      // The frame can be detached between discovery and execution.
    }
  }
}

function scheduleCustomPlayerChrome(webContents) {
  // The embed attaches its frame after the navigation events, so retry briefly.
  for (const delay of [0, 250, 750, 1800, 3500]) {
    const timer = setTimeout(() => applyCustomPlayerChrome(webContents), delay);
    timer.unref?.();
  }
}

function trackCustomPlayerChrome(webContents) {
  webContents.on("did-frame-finish-load", () => scheduleCustomPlayerChrome(webContents));
  webContents.on("did-frame-navigate", () => scheduleCustomPlayerChrome(webContents));
  webContents.on("did-finish-load", () => scheduleCustomPlayerChrome(webContents));
}

ipcMain.handle("app:custom-player-chrome", (event, enabled) => {
  if (!isTrusted(event)) return { ok: false };
  customChromeWindows.set(event.sender, enabled === true);
  scheduleCustomPlayerChrome(event.sender);
  return { ok: true };
});

ipcMain.handle("app:custom-player-chrome-applied", async (event) => {
  if (!isTrusted(event)) return false;
  const frames = youtubeFrames(event.sender);
  if (!frames.length) return false;
  const results = await Promise.all(frames.map(async (frame) => {
    try {
      return await frame
        .executeJavaScript(`!!document.getElementById(${JSON.stringify(CUSTOM_CHROME_STYLE_ID)})`)
        .catch(() => false);
    } catch {
      return false;
    }
  }));
  return results.some(Boolean);
});

const YOUTUBE_CHAPTERS_SCRIPT = `(() => {
  const line = document.querySelector("yt-chaptered-progress-bar-line");
  if (!line) return [];
  const segments = Array.from(line.querySelectorAll(".ytChapteredProgressBarChapteredPlayerBarChapter"));
  if (segments.length < 2) return [];
  const widths = segments.map((node) => Number.parseFloat(node.style.width) || 0);
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (!(total > 0)) return [];
  let elapsed = 0;
  const marks = [];
  for (let index = 0; index < widths.length - 1; index += 1) {
    elapsed += widths[index];
    const percent = (elapsed / total) * 100;
    if (percent > 0.5 && percent < 99.5) marks.push(Math.round(percent * 100) / 100);
    if (marks.length >= 80) break;
  }
  return marks;
})()`;

ipcMain.handle("app:youtube-chapters", async (event) => {
  if (!isTrusted(event)) return [];
  for (const frame of youtubeFrames(event.sender)) {
    try {
      const marks = await frame.executeJavaScript(YOUTUBE_CHAPTERS_SCRIPT);
      if (Array.isArray(marks) && marks.length) return marks.slice(0, 80);
    } catch {
      // Chapters are optional; other frames may still expose them.
    }
  }
  return [];
});

const YOUTUBE_QUALITY_LEVELS = new Set([
  "auto", "default", "tiny", "small", "medium", "large",
  "hd720", "hd1080", "hd1440", "hd2160", "highres",
]);

function youtubeQualityScript(level) {
  const normalized = level === "default" || level === "auto" ? "auto" : level;
  return `(() => new Promise((resolve) => {
    const player = document.querySelector("#movie_player");
    if (!player) {
      resolve(null);
      return;
    }
    const level = ${JSON.stringify(normalized)};
    if (typeof player.setPlaybackQualityRange === "function") player.setPlaybackQualityRange(level);
    if (typeof player.setPlaybackQuality === "function") player.setPlaybackQuality(level);
    setTimeout(() => {
      resolve(typeof player.getPlaybackQuality === "function" ? player.getPlaybackQuality() : null);
    }, 350);
  }))()`;
}

ipcMain.handle("app:youtube-quality", async (event, level) => {
  if (!isTrusted(event)) return null;
  const requested = String(level || "");
  if (!YOUTUBE_QUALITY_LEVELS.has(requested)) return null;
  for (const frame of youtubeFrames(event.sender)) {
    try {
      const actual = await frame.executeJavaScript(youtubeQualityScript(requested));
      if (actual) return actual;
    } catch {
      // The iframe may be replacing its internal player.
    }
  }
  return null;
});

const BACKEND_BINARY = process.platform === "win32" ? "hackertube-backend.exe" : "hackertube-backend";

function backendBinaryPath() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "backend", BACKEND_BINARY)]
    : [
      path.join(__dirname, "backend-bin", BACKEND_BINARY),
      path.join(__dirname, "..", "backend-bin", BACKEND_BINARY),
    ];
  return candidates.find((file) => fs.existsSync(file)) || "";
}

function stopSearchBackend() {
  const backend = searchBackend;
  searchBackend = null;
  if (!backend) return;
  backend.stopped = true;
  try {
    backend.child.stdin.write(`${JSON.stringify({ id: 0, method: "shutdown" })}\n`);
  } catch { /* already gone */ }
  for (const request of backend.pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("backend stopped"));
  }
  backend.pending.clear();
  for (const waiter of backend.waiters.splice(0)) waiter.reject(new Error("backend stopped"));
  try { backend.child.kill(); } catch { /* already exited */ }
}

function startSearchBackend() {
  if (searchBackend) return searchBackend;
  const binary = backendBinaryPath();
  const dataFile = path.join(SITE_ROOT, "data", "videos.json");
  if (!binary || !fs.existsSync(dataFile)) return null;

  const child = spawn(binary, ["--data", dataFile], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const backend = {
    child,
    ready: false,
    available: true,
    info: null,
    error: "",
    nextId: 0,
    pending: new Map(),
    waiters: [],
    stopped: false,
  };
  searchBackend = backend;

  child.stdin.on("error", () => {
    // The process may exit between a request check and the write; exit handling owns the error.
  });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === "ready") {
      backend.ready = message.ok === true;
      backend.available = message.ok === true;
      backend.info = message;
      if (!backend.ready) backend.error = String(message.error || "backend failed");
      for (const waiter of backend.waiters.splice(0)) waiter.resolve(backend);
      return;
    }
    const request = backend.pending.get(message.id);
    if (!request) return;
    backend.pending.delete(message.id);
    clearTimeout(request.timer);
    request.resolve(message);
  });
  child.stderr.on("data", (chunk) => {
    console.error("Search backend:", String(chunk).trim());
  });
  child.once("error", (error) => {
    backend.available = false;
    backend.error = error.message;
    for (const waiter of backend.waiters.splice(0)) waiter.reject(error);
  });
  child.once("exit", (code) => {
    backend.available = false;
    backend.error = backend.error || `exit-${code}`;
    if (!backend.stopped) console.error("Search backend exited", code);
    for (const request of backend.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(backend.error));
    }
    backend.pending.clear();
    for (const waiter of backend.waiters.splice(0)) waiter.reject(new Error(backend.error));
    if (searchBackend === backend) searchBackend = null;
  });
  return backend;
}

function waitForBackend(backend, timeout = 8000) {
  if (!backend) return Promise.reject(new Error("backend unavailable"));
  if (backend.ready) return Promise.resolve(backend);
  if (!backend.available) return Promise.reject(new Error(backend.error || "backend failed"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("backend timeout")), timeout);
    backend.waiters.push({
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
  });
}

async function backendRequest(method, params = {}, timeout = 5000) {
  const backend = searchBackend || startSearchBackend();
  if (!backend) return null;
  await waitForBackend(backend);
  const id = ++backend.nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      backend.pending.delete(id);
      reject(new Error("backend timeout"));
    }, timeout);
    backend.pending.set(id, { resolve, reject, timer });
    backend.child.stdin.write(`${JSON.stringify({ id, method, ...params })}\n`, (error) => {
      if (!error) return;
      clearTimeout(timer);
      backend.pending.delete(id);
      reject(error);
    });
  });
}

ipcMain.handle("app:search-backend-status", (event) => {
  if (!isTrusted(event)) return { available: false };
  const backend = searchBackend || startSearchBackend();
  if (!backend) return { available: false };
  return {
    available: backend.available,
    ready: backend.ready,
    docs: backend.info?.stats?.docs || 0,
    buildMs: backend.info?.build_ms || 0,
    error: backend.error,
  };
});

ipcMain.handle("app:search-catalog", async (event, query, limit) => {
  if (!isTrusted(event)) return { ok: false };
  const text = String(query || "").trim().slice(0, 200);
  if (!text) return { ok: true, indices: [], total: 0 };
  const count = Math.min(20000, Math.max(1, Number(limit) || 20000));
  try {
    const result = await backendRequest("search", { query: text, limit: count });
    if (!result?.ok) return { ok: false };
    return { ok: true, indices: result.indices || [], ids: result.ids || [], total: result.total || 0, tookMs: result.took_ms || 0 };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle("app:search-backend-stats", async (event) => {
  if (!isTrusted(event)) return { ok: false };
  try {
    const result = await backendRequest("stats");
    return { ok: Boolean(result?.ok), stats: result?.stats || null };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle("app:search-backend-trim", async (event) => {
  if (!isTrusted(event)) return { ok: false };
  try {
    const result = await backendRequest("trim", {}, 10000);
    return { ok: Boolean(result?.ok), stats: result?.stats || null, freedMb: result?.freed_mb || 0 };
  } catch {
    return { ok: false };
  }
});

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
  trackCustomPlayerChrome(win.webContents);
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

    app.on("before-quit", () => {
      stopSearchBackend();
      for (const timer of startupTimers) clearTimeout(timer);
      startupTimers.clear();
    });

    app.whenReady().then(async () => {
      app.setAppUserModelId(APP_ID);
      startSearchBackend();
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
      const forcedMigration = !app.isPackaged && process.env.HACKERTUBE_FORCE_MIGRATION === "1";
      const hadStorageAtLaunch = fs.existsSync(path.join(app.getPath("userData"), "Local Storage", "leveldb"));
      mainWindowStarted = true;
      createWindow();
      scheduleLegacyStorageMigration(hadStorageAtLaunch, forcedMigration);
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on("window-all-closed", () => {
      // Hidden migration windows close before the main window opens.
      if (!mainWindowStarted) return;
      if (process.platform !== "darwin") app.quit();
    });
  }
}
