"use strict";

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const fs = require("node:fs");
const originalFs = require("original-fs");
const path = require("node:path");
const { execFile, execFileSync, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { cleanStaleDirs, swapIn, isSameOrNested } = require("./install-fs");

const execFileAsync = promisify(execFile);
const ofsCopyFile = promisify(originalFs.copyFile);
const ofsReaddir = promisify(originalFs.readdir);
const ofsStat = promisify(originalFs.stat);
const ofsMkdir = promisify(originalFs.mkdir);
const APP_EXE = "HackerTube.exe";
const APP_NAME = "HackerTube";
const UNINSTALL_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HackerTube";
const WEBSITE = "https://pandurodev.github.io/HackerTube/";
const INSTALLER_HTML = path.join(__dirname, "installer.html");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let installerWindow = null;
let installerMode = null;
let busy = false;
let ipcRegistered = false;

function defaultInstallDir() {
  const local = process.env.LOCALAPPDATA || app.getPath("appData");
  return path.join(local, "Programs", APP_NAME);
}

function normalizeInstallDir(value) {
  let dir = String(value || "").trim().replace(/^"|"$/g, "");
  if (!dir || !path.isAbsolute(dir)) throw new Error("Choose an absolute install folder.");
  dir = path.resolve(dir);
  if (path.parse(dir).root === dir) throw new Error("Choose a folder other than the drive root.");
  if (path.basename(dir).toLowerCase() !== APP_NAME.toLowerCase()) dir = path.join(dir, APP_NAME);
  return dir;
}

function sourceDir() {
  if (process.env.HACKERTUBE_INSTALL_SOURCE) return path.resolve(process.env.HACKERTUBE_INSTALL_SOURCE);
  return path.dirname(process.execPath);
}

// Where the previous install lives, so an update replaces that copy instead of adding another.
function registeredInstallDir() {
  if (process.platform !== "win32") return "";
  try {
    const output = execFileSync("reg.exe", ["query", UNINSTALL_KEY, "/v", "InstallLocation"], {
      windowsHide: true,
      encoding: "utf8",
    });
    const match = output.match(/InstallLocation\s+REG_SZ\s+(.+)/i);
    const dir = match ? match[1].trim() : "";
    return dir && fs.existsSync(path.join(dir, APP_EXE)) ? dir : "";
  } catch {
    return "";
  }
}

// Two setup windows copying into the same folder at once would corrupt the install.
function acquireLock(dir) {
  const key = Buffer.from(dir.toLowerCase()).toString("base64url").slice(-40);
  const file = path.join(app.getPath("temp"), `hackertube-setup-${key}.lock`);
  try {
    if (Date.now() - fs.statSync(file).mtimeMs > 10 * 60 * 1000) fs.rmSync(file, { force: true });
  } catch { /* no lock yet */ }
  try {
    fs.writeFileSync(file, String(process.pid), { flag: "wx" });
  } catch {
    throw new Error("Another HackerTube setup is already running.");
  }
  return () => {
    try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
  };
}

// Staging, swap and cleanup helpers live in install-fs.js so they stay unit-testable.

function removeInstallerArtifacts(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name.toLowerCase() === "uninstall hackertube.exe" || /^unins\d+\.exe$/i.test(name) || name.toLowerCase() === "uninstallericon.ico") {
      try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* ignore */ }
    }
  }
}

function trusted(event) {
  return String(event.senderFrame?.url || "").includes("installer.html");
}

function send(window, data) {
  if (window && !window.isDestroyed()) window.webContents.send("installer:progress", data);
}

async function ps(script) {
  await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    windowsHide: true,
    timeout: 60000,
  });
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function stopRunningApp(targetDir) {
  if (process.platform !== "win32") return;
  const exe = path.join(targetDir, APP_EXE);
  await ps(`
    $exe = ${quotePowerShell(exe)};
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -eq $exe -and $_.ProcessId -ne ${process.pid} } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  `).catch(() => {});
}

async function removeLegacyUninstallEntries(keepCurrent = false) {
  if (process.platform !== "win32") return;
  const filter = keepCurrent
    ? "$_.DisplayName -like 'HackerTube*' -and $_.PSChildName -ne 'HackerTube'"
    : "$_.DisplayName -like 'HackerTube*'";
  await ps(`
    Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue |
      ForEach-Object { $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue;
        if ($p -and ${filter}) { Remove-Item $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue } }
  `).catch(() => {});
}

async function walkFiles(root, relative = "") {
  const entries = await ofsReaddir(path.join(root, relative), { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      result.push(...await walkFiles(root, rel));
    } else if (entry.isFile()) {
      const stat = await ofsStat(path.join(root, rel));
      result.push({ rel, size: stat.size });
    }
  }
  return result;
}

async function copyFileWithRetry(source, destination) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await ofsCopyFile(source, destination);
      return;
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }
  throw lastError;
}

async function copyApplication(source, target, window) {
  const files = await walkFiles(source);
  if (!files.some((file) => file.rel.toLowerCase() === APP_EXE.toLowerCase())) {
    throw new Error("The installer payload is missing. Download the latest release and try again.");
  }
  const total = files.reduce((sum, file) => sum + file.size, 0) || 1;
  let done = 0;
  let lastTick = 0;

  for (const file of files) {
    const destination = path.join(target, file.rel);
    await ofsMkdir(path.dirname(destination), { recursive: true });
    await copyFileWithRetry(path.join(source, file.rel), destination);
    done += file.size;
    const now = Date.now();
    if (now - lastTick > 120) {
      lastTick = now;
      send(window, {
        stage: "copy",
        percent: 6 + (done / total) * 78,
        label: "Copying application files…",
      });
    }
  }
}

function addRegistryValue(name, type, value) {
  return execFileAsync("reg.exe", ["add", UNINSTALL_KEY, "/v", name, "/t", type, "/d", String(value), "/f"], { windowsHide: true });
}

async function registerUninstall(dir) {
  if (process.platform !== "win32") return;
  const exe = path.join(dir, APP_EXE);
  const values = [
    ["DisplayName", "REG_SZ", APP_NAME],
    ["DisplayVersion", "REG_SZ", app.getVersion()],
    ["DisplayIcon", "REG_SZ", `${exe},0`],
    ["InstallLocation", "REG_SZ", dir],
    ["Publisher", "REG_SZ", "PanDuroDev"],
    ["URLInfoAbout", "REG_SZ", WEBSITE],
    ["UninstallString", "REG_SZ", `"${exe}" --uninstall`],
    ["QuietUninstallString", "REG_SZ", `"${exe}" --uninstall --silent`],
    ["NoModify", "REG_DWORD", "1"],
    ["NoRepair", "REG_DWORD", "1"],
  ];
  for (const [name, type, value] of values) await addRegistryValue(name, type, value);
}

function shortcuts(dir) {
  const exe = path.join(dir, APP_EXE);
  return [
    path.join(app.getPath("desktop"), `${APP_NAME}.lnk`),
    path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", `${APP_NAME}.lnk`),
  ];
}

function createShortcuts(dir, desktop) {
  if (process.platform !== "win32") return;
  const exe = path.join(dir, APP_EXE);
  const options = { target: exe, cwd: dir, icon: exe, iconIndex: 0, description: APP_NAME };
  const [desktopLink, startLink] = shortcuts(dir);
  if (desktop) shell.writeShortcutLink(desktopLink, "create", options);
  shell.writeShortcutLink(startLink, "create", options);
}

function removeShortcuts(dir) {
  for (const link of shortcuts(dir)) {
    try { fs.rmSync(link, { force: true }); } catch { /* ignore */ }
  }
}

async function install(options, window) {
  if (process.platform !== "win32") {
    return { ok: false, error: "The desktop installer is available for Windows only." };
  }
  const source = sourceDir();
  const dir = normalizeInstallDir(options?.dir);
  if (path.resolve(source) === dir || dir.startsWith(`${path.resolve(source)}${path.sep}`)) {
    throw new Error("Choose a folder outside the installer files.");
  }
  if (!fs.existsSync(path.join(source, APP_EXE))) {
    throw new Error("The installer payload is missing. Download the latest release and try again.");
  }

  const releaseLock = acquireLock(dir);
  const previous = registeredInstallDir();
  const staging = `${dir}.new-${process.pid}`;

  try {
    send(window, { stage: "prepare", percent: 2, label: "Preparing the installer…" });
    await stopRunningApp(dir);
    if (previous && path.resolve(previous) !== dir) await stopRunningApp(previous);
    await delay(350);
    cleanStaleDirs(dir);

    fs.rmSync(staging, { recursive: true, force: true });
    await ofsMkdir(staging, { recursive: true });

    send(window, { stage: "copy", percent: 6, label: "Copying application files…" });
    await copyApplication(source, staging, window);

    send(window, { stage: "swap", percent: 84, label: "Replacing the previous version…" });
    await swapIn(staging, dir);
    removeInstallerArtifacts(dir);

    await removeLegacyUninstallEntries();

    send(window, { stage: "shortcuts", percent: 88, label: "Creating shortcuts…" });
    createShortcuts(dir, Boolean(options?.desktopShortcut));

    send(window, { stage: "finish", percent: 95, label: "Finishing setup…" });
    await registerUninstall(dir);

    // Only after the new copy is in place: drop the copy the registry pointed at before.
    if (previous && !isSameOrNested(previous, dir)) {
      try { fs.rmSync(previous, { recursive: true, force: true }); } catch { /* harmless leftover */ }
    }

    send(window, { stage: "finish", percent: 100, label: "HackerTube is ready." });

    if (options?.launch) {
      spawn(path.join(dir, APP_EXE), [], { detached: true, stdio: "ignore" }).unref();
    }
    return { ok: true, dir };
  } finally {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* already swapped */ }
    releaseLock();
  }
}

async function uninstall() {
  const dir = path.dirname(process.execPath);
  await removeLegacyUninstallEntries(true);
  if (process.platform === "win32") {
    await execFileAsync("reg.exe", ["delete", UNINSTALL_KEY, "/f"], { windowsHide: true }).catch(() => {});
  }
  removeShortcuts(dir);
  try { fs.rmSync(path.join(app.getPath("temp"), "hackertube-updates"), { recursive: true, force: true }); } catch { /* ignore */ }
  return { ok: true, dir };
}

async function finishUninstall() {
  const dir = path.dirname(process.execPath);
  if (process.platform === "win32") {
    const temp = app.getPath("temp");
    const scriptPath = path.join(temp, `hackertube-uninstall-${Date.now()}.ps1`);
    const logPath = path.join(temp, "hackertube-uninstall.log");
    const script = [
      "Set-Location $env:TEMP",
      `$target = ${quotePowerShell(dir)}`,
      `$log = ${quotePowerShell(logPath)}`,
      `"start $(Get-Date -Format o)" | Out-File -LiteralPath $log -Append`,
      "Start-Sleep -Milliseconds 700",
      "$exe = Join-Path $target 'HackerTube.exe'",
      "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      "for ($i = 0; $i -lt 60; $i++) {",
      "  try {",
      "    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop",
      "  } catch {",
      '    ("attempt ${i}: " + $_.Exception.Message) | Out-File -LiteralPath $log -Append',
      "  }",
      "  if (-not (Test-Path -LiteralPath $target)) { break }",
      "  Start-Sleep -Milliseconds 500",
      "}",
      '"done: " + (-not (Test-Path -LiteralPath $target)) | Out-File -LiteralPath $log -Append',
      "",
    ].join("\n");
    try {
      fs.writeFileSync(scriptPath, script, "utf8");
      spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    } catch (error) {
      console.error("cleanup script failed", error);
    }
  }
  app.quit();
  return { ok: true };
}

function registerIpc() {
  ipcMain.handle("installer:defaults", (event) => (trusted(event) ? {
    mode: installerMode || "install",
    version: app.getVersion(),
    dir: registeredInstallDir() || defaultInstallDir(),
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  } : null));

  ipcMain.handle("installer:choose-dir", async (event, current) => {
    if (!trusted(event) || !installerWindow) return "";
    const result = await dialog.showOpenDialog(installerWindow, {
      title: "Choose the install folder",
      defaultPath: String(current || defaultInstallDir()),
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? "" : result.filePaths[0] || "";
  });

  ipcMain.handle("installer:install", async (event, options) => {
    if (!trusted(event) || busy) return { ok: false, error: "Setup is already running." };
    busy = true;
    try {
      return await install(options, installerWindow);
    } catch (error) {
      console.error(error);
      return { ok: false, error: error.message || "The installation could not be completed." };
    } finally {
      busy = false;
    }
  });

  ipcMain.handle("installer:uninstall", async (event) => {
    if (!trusted(event) || busy) return { ok: false, error: "Uninstall is already running." };
    busy = true;
    try {
      return await uninstall();
    } catch (error) {
      console.error(error);
      return { ok: false, error: error.message || "HackerTube could not be removed." };
    } finally {
      busy = false;
    }
  });

  ipcMain.handle("installer:finish-uninstall", (event) => {
    if (!trusted(event)) return { ok: false };
    return finishUninstall();
  });

  ipcMain.handle("installer:launch", (event, dir) => {
    if (!trusted(event)) return { ok: false };
    const exe = path.join(String(dir || path.dirname(process.execPath)), APP_EXE);
    if (!fs.existsSync(exe)) return { ok: false, error: "HackerTube is not installed in that folder." };
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    return { ok: true };
  });

  ipcMain.on("installer:close", (event) => {
    if (!trusted(event) || busy) return;
    if (installerWindow) installerWindow.close();
  });

  ipcMain.on("installer:minimize", (event) => {
    if (trusted(event)) installerWindow?.minimize();
  });

  ipcMain.on("installer:open-site", (event) => {
    if (trusted(event)) shell.openExternal(WEBSITE);
  });
}

function ensureIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;
  registerIpc();
}

function openWindow(mode = "install", parent = null) {
  ensureIpc();
  if (installerWindow && !installerWindow.isDestroyed()) {
    installerWindow.focus();
    return installerWindow;
  }
  installerMode = mode;
  const uninstallMode = mode === "uninstall";
  installerWindow = new BrowserWindow({
    width: uninstallMode ? 560 : 660,
    height: uninstallMode ? 390 : 440,
    minWidth: 520,
    minHeight: uninstallMode ? 360 : 410,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    frame: false,
    title: uninstallMode ? "HackerTube Uninstall" : "HackerTube Setup",
    backgroundColor: "#0f0f0f",
    parent: parent || undefined,
    modal: Boolean(parent),
    webPreferences: {
      preload: path.join(__dirname, "installer-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  installerWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);
  installerWindow.once("ready-to-show", () => installerWindow?.show());
  installerWindow.on("closed", () => { installerWindow = null; });
  installerWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  installerWindow.loadFile(INSTALLER_HTML, { query: { mode } });
  return installerWindow;
}

function start(mode = "install", parent = null) {
  ensureIpc();
  return openWindow(mode, parent);
}

module.exports = {
  start,
  openWindow,
  defaultInstallDir,
  normalizeInstallDir,
  sourceDir,
  install,
  uninstall,
  finishUninstall,
};
