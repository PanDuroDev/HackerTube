"use strict";

const api = window.installer;
const $ = (selector) => document.querySelector(selector);
const views = {
  install: $("#installView"),
  progress: $("#progressView"),
  success: $("#successView"),
  uninstall: $("#uninstallView"),
  uninstallProgress: $("#uninstallProgress"),
  uninstallDone: $("#uninstallDone"),
  error: $("#errorView"),
};

const params = new URLSearchParams(location.search);
let mode = params.get("mode") === "uninstall" ? "uninstall" : "install";
const autoInstall = mode === "install" && params.get("auto") === "1";
let installDir = "";
let busy = false;
let lastAction = "install";

function show(name) {
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
  views[name].style.animation = "none";
  void views[name].offsetWidth;
  views[name].style.animation = "";
}

function setBusy(value) {
  busy = value;
  $("#closeBtn").disabled = value;
  $("#minBtn").disabled = false;
}

function showError(message) {
  setBusy(false);
  $("#errorText").textContent = message || "The operation could not be completed.";
  show("error");
}

function setProgress({ percent = 0, stage = "", label = "" } = {}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  $("#progressBar").style.width = `${value}%`;
  $("#progressPct").textContent = `${value}%`;
  if (label) $("#progressText").textContent = label;
}

async function startInstall() {
  if (busy || !installDir) return;
  lastAction = "install";
  setBusy(true);
  setProgress({ percent: 0, stage: "prepare", label: "Preparing the installer…" });
  show("progress");
  try {
    const result = await api.install({
      dir: installDir,
      desktopShortcut: $("#desktopShortcut").checked,
      launch: $("#launchApp").checked,
    });
    if (!result || result.ok === false) {
      showError(result?.error);
      return;
    }
    installDir = result.dir || installDir;
    $("#successPath").textContent = installDir;
    setBusy(false);
    // Started by an update: the app is already open again, so the setup gets out of the way.
    if (autoInstall) {
      api.close();
      return;
    }
    show("success");
  } catch (error) {
    showError(error?.message);
  }
}

async function startUninstall() {
  if (busy) return;
  lastAction = "uninstall";
  setBusy(true);
  show("uninstallProgress");
  try {
    const result = await api.uninstall();
    if (!result || result.ok === false) {
      showError(result?.error);
      return;
    }
    setBusy(false);
    show("uninstallDone");
  } catch (error) {
    showError(error?.message);
  }
}

async function init() {
  $("#modeChip").textContent = mode === "uninstall" ? "Uninstall" : "Setup";
  document.title = mode === "uninstall" ? "HackerTube Uninstall" : "HackerTube Setup";

  $("#browseBtn").addEventListener("click", async () => {
    if (busy) return;
    const dir = await api.chooseDirectory(installDir);
    if (dir) {
      installDir = dir;
      $("#installDir").textContent = dir;
    }
  });

  $("#installBtn").addEventListener("click", startInstall);
  $("#retryBtn").addEventListener("click", () => {
    show(lastAction === "uninstall" ? "uninstall" : "install");
    setBusy(false);
  });
  $("#laterBtn").addEventListener("click", () => api.close());
  $("#launchBtn").addEventListener("click", async () => {
    await api.launch(installDir);
    api.close();
  });
  $("#cancelUninstall").addEventListener("click", () => api.close());
  $("#uninstallBtn").addEventListener("click", startUninstall);
  $("#finishUninstall").addEventListener("click", () => api.finishUninstall());
  $("#errorClose").addEventListener("click", () => api.close());
  $("#minBtn").addEventListener("click", () => api.minimize());
  $("#closeBtn").addEventListener("click", () => {
    if (!busy) api.close();
  });

  api.onProgress((data) => setProgress(data));

  // An update restarts the setup by itself: keep the app installed, reopen it, and skip the form.
  if (autoInstall) {
    $("#launchApp").checked = true;
    setProgress({ percent: 0, label: "Preparing the installer…" });
    show("progress");
  }

  try {
    const defaults = await api.getDefaults();
    if (defaults.mode === "uninstall") mode = "uninstall";
    installDir = defaults.dir || "";
    $("#installDir").textContent = installDir;
    $("#version").textContent = defaults.version ? `v${defaults.version}` : "";
    if (autoInstall) startInstall();
    else show(mode === "uninstall" ? "uninstall" : "install");
  } catch (error) {
    showError(error?.message);
  }
}

init();
