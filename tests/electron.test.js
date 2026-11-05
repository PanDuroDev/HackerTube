"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const update = require("../electron/update");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

test("the Electron shell is frameless and exposes only window controls", () => {
  const main = read("electron/main.js");
  assert.match(main, /frame: false/);
  assert.match(main, /preload: path\.join\(__dirname, "preload\.js"\)/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /window:toggle-maximize/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /ipcMain\.handle\("app:uninstall"/);
  assert.doesNotMatch(main, /dialog\.showMessageBox/, "the app must install updates without a native confirmation");
  assert.match(main, /spawnDetached\(file, \["--installer", "--auto"\]\)/, "the update setup must run unattended");
  assert.match(main, /const autoInstall = process\.argv\.includes\("--auto"\)/);
  assert.match(main, /ipcMain\.handle\("app:version"/);
  assert.match(main, /ipcMain\.handle\("app:check-update"/);
  assert.match(main, /ipcMain\.handle\("app:install-update"/);
  assert.match(main, /update\.isReleaseDownloadUrl/);
  assert.match(main, /Readable\.fromWeb/);
  assert.match(main, /require\("\.\/update"\)/);

  const preload = read("electron/preload.js");
  assert.match(preload, /contextBridge\.exposeInMainWorld\("electronWindow"/);
  assert.match(preload, /ipcRenderer\.send\("window:minimize"\)/);
  assert.match(preload, /ipcRenderer\.invoke\("window:is-maximized"\)/);
  assert.match(preload, /ipcRenderer\.invoke\("app:version"\)/);
  assert.match(preload, /ipcRenderer\.invoke\("app:check-update"\)/);
  assert.match(preload, /ipcRenderer\.invoke\("app:install-update"\)/);
  assert.match(preload, /ipcRenderer\.invoke\("app:uninstall"\)/);
  assert.doesNotMatch(preload, /nodeIntegration|require\("node:fs"\)/);

  const pkg = JSON.parse(read("electron/package.json"));
  assert.equal(pkg.version, "1.0.4");
  assert.equal(pkg.main, "main.js");
  assert.ok(pkg.build?.files?.includes("update.js"));
  assert.ok(pkg.build?.appId);
  assert.ok(pkg.build?.win?.target);
  assert.equal(pkg.build?.win?.artifactName, "HackerTube-win-${arch}.${ext}");
  assert.equal(pkg.build?.mac?.artifactName, "HackerTube-mac-${arch}.${ext}");
  assert.equal(pkg.build?.linux?.artifactName, "HackerTube-linux-${arch}.${ext}");
  assert.ok(fs.existsSync(path.join(ROOT, "electron/build/icon.ico")));

  const workflow = read(".github/workflows/electron-release.yml");
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /npm run dist:win/);
  assert.match(workflow, /--universal/);
  assert.match(workflow, /softprops\/action-gh-release/);
});

test("the web app renders window controls and hides the PWA install row in Electron", () => {
  const html = read("public/index.html");
  assert.match(html, /id="windowControls"/);
  assert.match(html, /id="windowMinimize"/);
  assert.match(html, /id="windowMaximize"/);
  assert.match(html, /id="windowClose"/);
  assert.match(html, /id="i-window-minimize"/);
  assert.match(html, /id="i-window-maximize"/);
  assert.match(html, /id="i-window-restore"/);

  const app = read("public/app.js");
  assert.match(app, /function setupElectronWindow\(\)/);
  assert.match(app, /window\.electronWindow/);
  assert.match(app, /api\.toggleMaximize\(\)/);
  assert.match(app, /async function uninstallApp\(\)/);
  assert.match(app, /data-uninstall-app/);
  assert.match(app, /data-uninstall-pwa/);
  assert.match(app, /const appGroup = window\.electronWindow \? electronAppGroup : installGroup/);
  assert.match(app, /data-desktop-download/);
  assert.match(app, /function desktopDownloadHref\(platform = desktopPlatform\(\)\)/);
  assert.match(app, /const showBrowserInstall = !window\.electronWindow/);

  const css = read("public/styles.css");
  assert.match(css, /html\.electron-app \.topbar \{ -webkit-app-region: drag; \}/);
  assert.match(css, /html\.electron-app \.window-controls \{ display: flex; \}/);

  assert.match(app, /function checkDesktopUpdate\(manual = false\)/);
  assert.match(app, /data-check-updates/);
  assert.match(app, /api\.installUpdate\(\)/);
  assert.match(app, /api\.getAppVersion\(\)/);

  const updateAt = html.indexOf('id="updateBtn"');
  const themeAt = html.indexOf('id="themeBtn"');
  assert.ok(updateAt > 0 && updateAt < themeAt, "the update button should sit beside the theme toggle");
  assert.match(html.slice(updateAt, themeAt), /data-i18n="header\.update"/);
  assert.match(html.slice(updateAt, themeAt), /#i-download/);
  assert.doesNotMatch(html.slice(updateAt, themeAt), /#i-refresh/);
  assert.match(css, /\.update-btn \{/);
  assert.match(css, /\.update-btn\[hidden\] \{ display: none; \}/);

  for (const file of ["public/i18n/en.json", "public/i18n/ar.json"]) {
    const dict = JSON.parse(read(file));
    for (const key of ["minimize", "maximize", "restore", "close"]) {
      assert.ok(dict.window?.[key], `${file} is missing window.${key}`);
    }
    for (const key of ["update", "updateTo", "updating"]) {
      assert.ok(dict.header?.[key], `${file} is missing header.${key}`);
    }
    for (const key of ["version", "checkUpdates", "upToDate", "updateAvailable", "updateWebReady", "updateInstalling", "updateManual", "updateFailed"]) {
      assert.ok(dict.settings?.[key], `${file} is missing settings.${key}`);
    }
  }
});

test("the desktop app serves the bundled site locally instead of the network", () => {
  const main = read("electron/main.js");
  assert.match(main, /protocol\.registerSchemesAsPrivileged/);
  assert.match(main, /scheme: "app"/);
  assert.match(main, /standard: true/, "the app scheme must be standard so hash routes and storage work");
  assert.match(main, /secure: true/);
  assert.match(main, /supportFetchAPI: true/, "the site fetches JSON, so the scheme must allow fetch");
  assert.match(main, /protocol\.handle\("app"/);
  assert.match(main, /path\.resolve\(root, relative\)/);
  assert.match(main, /file\.startsWith\(root \+ path\.sep\)/, "path traversal must be rejected");
  assert.match(main, /app\.isPackaged[\s\S]*?process\.resourcesPath/);

  const pkg = JSON.parse(read("electron/package.json"));
  const resources = pkg.build?.extraResources || [];
  assert.ok(
    resources.some((entry) => entry.from === "../public" && entry.to === "public"),
    "the build should copy public/ into the app resources",
  );

  const app = read("public/app.js");
  assert.match(app, /if \("serviceWorker" in navigator && !window\.electronWindow\)/);
  assert.match(app, /location\.protocol === "app:" \? SITE_URL \+ location\.hash/, "sharing must copy the public web URL, not app://");
});

test("desktop updates resume, verify and replace the installed copy cleanly", () => {
  assert.equal(update.resumeOffset(0, 1000), 0, "no partial file means a full download");
  assert.equal(update.resumeOffset(400, 1000), 400, "a partial file resumes at its size");
  assert.equal(update.resumeOffset(1000, 1000), 0, "a complete file never resumes");
  assert.equal(update.resumeOffset(1200, 1000), 0, "an oversized file starts over");
  assert.equal(update.resumeOffset(Number.NaN, 1000), 0);
  assert.equal(update.resumeOffset(400, 0), 0);
  assert.equal(update.isCompleteDownload(1000, 1000), true);
  assert.equal(update.isCompleteDownload(999, 1000), false);
  assert.equal(update.isCompleteDownload(1000, 0), false);

  const main = read("electron/main.js");
  assert.match(main, /headers\.Range = `bytes=\$\{start\}-`/, "a partial download must ask for the missing bytes only");
  assert.match(main, /response\.status === 206/, "an ignored range must restart the file instead of appending");
  assert.match(main, /update\.isCompleteDownload\(have, expected\)/, "an already downloaded build must be reused");
  assert.match(main, /pruneUpdateFiles\(file\)/, "older update copies must be cleaned up");
  assert.match(main, /"app:update-progress"/, "download progress must reach the renderer");
  assert.match(main, /updateInFlight/, "a second install click must not start another download");
  assert.match(main, /Update download was incomplete/);
  assert.match(main, /function spawnDetached/);
  assert.match(main, /process\.env\.APPIMAGE[\s\S]*?renameSync/, "Linux should replace the running AppImage in place");
  assert.match(main, /downloadUpdate\(info\.asset, info\.version\)/);

  const installer = read("electron/installer.js");
  assert.match(installer, /function registeredInstallDir\(\)/);
  assert.match(installer, /dir: registeredInstallDir\(\) \|\| defaultInstallDir\(\)/, "setup must reuse the folder of the previous install");
  assert.match(installer, /function acquireLock\(dir\)/, "concurrent setups must be blocked");
  assert.match(installer, /const staging = `\$\{dir\}\.new-\$\{process\.pid\}`/);
  assert.match(installer, /await swapIn\(staging, dir\)/);
  assert.match(installer, /require\("\.\/install-fs"\)/);
  assert.match(installer, /fs\.rmSync\(previous, \{ recursive: true, force: true \}\)/, "installing elsewhere must drop the old copy");

  const pkg = JSON.parse(read("electron/package.json"));
  assert.ok(pkg.build.files.includes("install-fs.js"), "the swap helper must be packaged");

  const preload = read("electron/preload.js");
  assert.match(preload, /onUpdateProgress: \(callback\)/);
  assert.match(preload, /ipcRenderer\.on\("app:update-progress"/);

  const app = read("public/app.js");
  assert.match(app, /api\.onUpdateProgress\?\.\(\(data\) => \{/);
  assert.match(app, /setProperty\("--update-progress", String\(percent\)\)/, "the header ring shows download progress");
  assert.match(app, /confirmAction\(\{[\s\S]*?icon: "download"/, "the update asks with the in-app dialog, not a native one");

  const installerUi = read("electron/installer-ui.js");
  assert.match(installerUi, /params\.get\("auto"\) === "1"/);
  assert.match(installerUi, /if \(autoInstall\) startInstall\(\);/, "an update must install without a click");
  assert.match(read("electron/installer.js"), /query: auto \? \{ mode, auto: "1" \} : \{ mode \}/);
});

test("the staged install replaces the folder and rolls back when the swap fails", async () => {
  const installFs = require("../electron/install-fs");
  const os = require("node:os");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ht-swap-"));
  const target = path.join(base, "HackerTube");
  const staging = path.join(base, "staging");

  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "HackerTube.exe"), "old");
  fs.writeFileSync(path.join(target, "removed-in-1.1.txt"), "stale");
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "HackerTube.exe"), "new");
  fs.writeFileSync(path.join(staging, "added-in-1.1.txt"), "fresh");

  await installFs.swapIn(staging, target);
  assert.equal(fs.readFileSync(path.join(target, "HackerTube.exe"), "utf8"), "new");
  assert.ok(fs.existsSync(path.join(target, "added-in-1.1.txt")));
  assert.equal(fs.existsSync(path.join(target, "removed-in-1.1.txt")), false, "files dropped by the new version must not survive");
  assert.equal(fs.existsSync(staging), false, "the staging folder moves into place");
  assert.deepEqual(fs.readdirSync(base), ["HackerTube"], "no backup folder is left behind");

  const failedStaging = path.join(base, "missing-staging");
  await assert.rejects(installFs.swapIn(failedStaging, target));
  assert.equal(fs.readFileSync(path.join(target, "HackerTube.exe"), "utf8"), "new", "a failed swap must leave the working install intact");

  fs.mkdirSync(path.join(base, "HackerTube.new-999"), { recursive: true });
  fs.mkdirSync(path.join(base, "HackerTube.old-999"), { recursive: true });
  fs.mkdirSync(path.join(base, "HackerTube.new-" + process.pid), { recursive: true });
  installFs.cleanStaleDirs(target, path.join(base, "HackerTube.new-" + process.pid));
  assert.equal(fs.existsSync(path.join(base, "HackerTube.new-999")), false);
  assert.equal(fs.existsSync(path.join(base, "HackerTube.old-999")), false);
  assert.ok(fs.existsSync(path.join(base, "HackerTube.new-" + process.pid)), "the active staging folder is kept");

  fs.rmSync(base, { recursive: true, force: true });
});

test("desktop updates compare versions, validate URLs and pick platform assets", () => {
  assert.equal(update.isNewerVersion("1.0.0", "v1.0.1"), true);
  assert.equal(update.isNewerVersion("1.0.1", "v1.0.1"), false);
  assert.equal(update.isNewerVersion("1.2.0", "v1.1.9"), false);
  assert.equal(update.isNewerVersion("1.0.9", "1.1.0"), true);
  assert.equal(update.isNewerVersion("bad", "v1.0.1"), false);

  assert.equal(
    update.isReleaseDownloadUrl("https://github.com/PanDuroDev/HackerTube/releases/download/v1.0.1/HackerTube-win-x64.exe"),
    true,
  );
  assert.equal(update.isReleaseDownloadUrl("http://github.com/PanDuroDev/HackerTube/releases/download/v1.0.1/a.exe"), false);
  assert.equal(update.isReleaseDownloadUrl("https://evil.example/PanDuroDev/HackerTube/releases/download/v1.0.1/a.exe"), false);
  assert.equal(update.isReleaseDownloadUrl("https://github.com/Other/Repo/releases/download/v1.0.1/a.exe"), false);

  const assets = [
    { name: "HackerTube-linux-x86_64.AppImage" },
    { name: "HackerTube-linux-arm64.AppImage" },
    { name: "HackerTube-mac-universal.dmg" },
    { name: "HackerTube-win-x64.exe" },
    { name: "notes.txt" },
  ];
  assert.equal(update.pickReleaseAsset(assets, "win32", "x64").name, "HackerTube-win-x64.exe");
  assert.equal(update.pickReleaseAsset(assets, "darwin", "arm64").name, "HackerTube-mac-universal.dmg");
  assert.equal(update.pickReleaseAsset(assets, "linux", "x64").name, "HackerTube-linux-x86_64.AppImage");
  assert.equal(update.pickReleaseAsset(assets, "linux", "arm64").name, "HackerTube-linux-arm64.AppImage");
  assert.equal(update.pickReleaseAsset(assets, "freebsd", "x64"), null);
});

test("the Windows build ships a custom Electron installer and uninstaller", () => {
  const pkg = JSON.parse(read("electron/package.json"));
  assert.equal(pkg.build.nsis, undefined, "the old NSIS target should be gone");
  assert.equal(pkg.build.win.target[0].target, "portable");
  assert.equal(pkg.build.win.artifactName, "HackerTube-win-${arch}.${ext}");
  for (const file of ["installer.js", "installer.html", "installer.css", "installer-ui.js", "installer-preload.js"]) {
    assert.ok(pkg.build.files.includes(file), `${file} should be packaged`);
    assert.ok(fs.existsSync(path.join(ROOT, "electron", file)), `${file} should exist`);
  }

  const html = read("electron/installer.html");
  for (const token of [
    'id="installView"', 'id="progressView"', 'id="successView"', 'id="uninstallView"',
    'id="installBtn"', 'id="uninstallBtn"', 'id="desktopShortcut"', 'id="launchApp"',
    '#i-download', '#i-folder-2', '#i-shield', '#i-trash', '#i-window-minimize', '#i-close',
  ]) {
    assert.ok(html.includes(token), `installer.html should include ${token}`);
  }
  assert.doesNotMatch(html, /cdn\.|unpkg|fonts\.googleapis/i, "the installer must use local assets");

  const ui = read("electron/installer-ui.js");
  assert.match(ui, /window\.installer/);
  assert.match(ui, /api\.install\(/);
  assert.match(ui, /api\.uninstall\(/);
  assert.match(ui, /api\.finishUninstall\(/);
  assert.match(ui, /onProgress/);

  const installer = read("electron/installer.js");
  assert.match(installer, /require\("original-fs"\)/);
  assert.match(installer, /function install\(options, window\)/);
  assert.match(installer, /shell\.writeShortcutLink/);
  assert.match(installer, /UNINSTALL_KEY = .*HackerTube/);
  assert.match(installer, /--uninstall --silent/);
  assert.match(installer, /Remove-Item/);
  assert.match(installer, /function isInstalledCopy\(file\)/, "the installed copy must be told apart from the portable launch");
  assert.match(installer, /InstallLocation\\s\+REG_SZ/);
  assert.match(installer, /function appEnv\(\)/);
  assert.match(installer, /key\.startsWith\("PORTABLE_EXECUTABLE"\)/);
  assert.equal((installer.match(/env: appEnv\(\)/g) || []).length, 2, "both app launches must drop the portable env");

  const main = read("electron/main.js");
  assert.match(main, /PORTABLE_EXECUTABLE_FILE/);
  assert.match(main, /!installer\.isInstalledCopy\(process\.env\.PORTABLE_EXECUTABLE_FILE\)/, "the installed copy must boot the app, not the setup window");
  assert.match(main, /process\.argv\.includes\("--uninstall"\)/);
  assert.match(main, /installer\.openWindow\("uninstall", win\)/);
  assert.match(main, /standaloneInstaller/);

  const preload = read("electron/installer-preload.js");
  assert.match(preload, /installer:install/);
  assert.match(preload, /installer:uninstall/);
  assert.match(preload, /installer:finish-uninstall/);
});

test("install path containment handles same, nested, and case-variant folders", () => {
  const { isSameOrNested } = require("../electron/install-fs");
  const base = path.join(path.sep, "tmp", "hackertube-path-test");
  assert.equal(isSameOrNested(base, base), true);
  assert.equal(isSameOrNested(base, path.join(base, "sub")), true);
  assert.equal(isSameOrNested(base, `${base}-other`), false);
  assert.equal(isSameOrNested("", base), false);
  if (process.platform === "win32") {
    assert.equal(isSameOrNested("C:/Apps/HackerTube", "c:/apps/hackertube"), true);
    assert.equal(isSameOrNested("C:/Apps/HackerTube", "c:/apps/hackertube/sub"), true);
  }
});

test("the AppImage updater restores the backup and relaunches only after exit", () => {
  const main = read("electron/main.js");
  assert.match(main, /let movedCurrent = false/);
  assert.match(main, /fs\.renameSync\(`\$\{current\}\.old`, current\)/);
  assert.match(main, /app\.relaunch\(\{ execPath: current, args: \[\] \}\)/);
  assert.match(main, /try \{ fs\.rmSync\(`\$\{process\.env\.APPIMAGE\}\.old`, \{ force: true \}\); \}/);
  const installer = read("electron/installer.js");
  assert.match(installer, /!isSameOrNested\(previous, dir\)/);
});
