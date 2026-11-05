"use strict";

const RELEASES_API = "https://api.github.com/repos/PanDuroDev/HackerTube/releases/latest";
const RELEASE_DOWNLOAD_PREFIX = "https://github.com/PanDuroDev/HackerTube/releases/download/";

const ASSET_PATTERNS = {
  win32: /^HackerTube-win-(x64|ia32|arm64)\.exe$/i,
  darwin: /^HackerTube-mac-(universal|x64|arm64)\.dmg$/i,
  linux: /^HackerTube-linux-(x86_64|x64|arm64)\.AppImage$/i,
};

function parseVersion(value) {
  const match = String(value ?? "").trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

function isNewerVersion(current, latest) {
  const have = parseVersion(current);
  const next = parseVersion(latest);
  if (!have || !next) return false;
  for (let i = 0; i < have.length; i += 1) {
    if (next[i] > have[i]) return true;
    if (next[i] < have[i]) return false;
  }
  return false;
}

function isCompleteDownload(size, expected) {
  const total = Number(expected);
  return Number.isFinite(total) && total > 0 && Number(size) === total;
}

// Byte offset to continue a partial download from; 0 starts over.
function resumeOffset(size, expected) {
  const have = Number(size);
  const total = Number(expected);
  if (!Number.isFinite(have) || !Number.isFinite(total)) return 0;
  return have > 0 && have < total ? Math.floor(have) : 0;
}

function isReleaseDownloadUrl(value) {
  if (typeof value !== "string" || !value.startsWith(RELEASE_DOWNLOAD_PREFIX)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
}

function pickReleaseAsset(assets = [], platform = process.platform, arch = process.arch) {
  const pattern = ASSET_PATTERNS[platform];
  if (!pattern) return null;
  const named = assets.filter((asset) => asset && typeof asset.name === "string" && pattern.test(asset.name));
  if (!named.length) return null;

  let archPattern = null;
  if (arch === "x64") archPattern = /x64|x86_64|universal/i;
  else if (arch === "arm64") archPattern = /arm64|aarch64|universal/i;
  else if (arch) archPattern = new RegExp(String(arch).replace(/[^a-z0-9]/gi, ""), "i");

  return (archPattern && named.find((asset) => archPattern.test(asset.name)))
    || named.find((asset) => /universal/i.test(asset.name))
    || named[0];
}

module.exports = {
  RELEASES_API,
  RELEASE_DOWNLOAD_PREFIX,
  ASSET_PATTERNS,
  parseVersion,
  isNewerVersion,
  isCompleteDownload,
  resumeOffset,
  isReleaseDownloadUrl,
  pickReleaseAsset,
};
