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
  assert.match(main, /dialog\.showMessageBox/);
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
  assert.equal(pkg.version, "1.0.2");
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

test("desktop updates compare versions, validate URLs and pick platform assets", () => {  assert.equal(update.isNewerVersion("1.0.0", "v1.0.1"), true);
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

  const main = read("electron/main.js");
  assert.match(main, /PORTABLE_EXECUTABLE_FILE/);
  assert.match(main, /process\.argv\.includes\("--uninstall"\)/);
  assert.match(main, /installer\.openWindow\("uninstall", win\)/);
  assert.match(main, /standaloneInstaller/);

  const preload = read("electron/installer-preload.js");
  assert.match(preload, /installer:install/);
  assert.match(preload, /installer:uninstall/);
  assert.match(preload, /installer:finish-uninstall/);
});
