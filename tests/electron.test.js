"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

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

  const preload = read("electron/preload.js");
  assert.match(preload, /contextBridge\.exposeInMainWorld\("electronWindow"/);
  assert.match(preload, /ipcRenderer\.send\("window:minimize"\)/);
  assert.match(preload, /ipcRenderer\.invoke\("window:is-maximized"\)/);
  assert.match(preload, /ipcRenderer\.invoke\("app:uninstall"\)/);
  assert.doesNotMatch(preload, /nodeIntegration|require\("node:fs"\)/);

  const pkg = JSON.parse(read("electron/package.json"));
  assert.equal(pkg.main, "main.js");
  assert.ok(pkg.build?.appId);
  assert.ok(pkg.build?.win?.target);
  assert.ok(fs.existsSync(path.join(ROOT, "electron/build/icon.ico")));
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

  const css = read("public/styles.css");
  assert.match(css, /html\.electron-app \.topbar \{ -webkit-app-region: drag; \}/);
  assert.match(css, /html\.electron-app \.window-controls \{ display: flex; \}/);

  for (const file of ["public/i18n/en.json", "public/i18n/ar.json"]) {
    const dict = JSON.parse(read(file));
    for (const key of ["minimize", "maximize", "restore", "close"]) {
      assert.ok(dict.window?.[key], `${file} is missing window.${key}`);
    }
  }
});
