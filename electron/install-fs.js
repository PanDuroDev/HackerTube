"use strict";

const fs = require("node:fs");
const path = require("node:path");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function renameWithRetry(from, to) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError;
}

// Staging and backup folders from an interrupted setup are always leftovers.
function cleanStaleDirs(target, keep = "") {
  const parent = path.dirname(target);
  const base = path.basename(target);
  try {
    for (const name of fs.readdirSync(parent)) {
      if (name.startsWith(base) && /\.(new|old)-\d+$/.test(name) && path.join(parent, name) !== keep) {
        fs.rmSync(path.join(parent, name), { recursive: true, force: true });
      }
    }
  } catch { /* parent may not exist yet */ }
}

// Stage first, then swap the whole folder so files dropped by a new version cannot survive.
async function swapIn(staging, target) {
  const backup = `${target}.old-${process.pid}`;
  fs.rmSync(backup, { recursive: true, force: true });
  const hadTarget = fs.existsSync(target);
  if (hadTarget) await renameWithRetry(target, backup);
  try {
    await renameWithRetry(staging, target);
  } catch (error) {
    if (hadTarget) await renameWithRetry(backup, target).catch(() => {});
    throw error;
  }
  try { fs.rmSync(backup, { recursive: true, force: true }); } catch { /* cleaned next run */ }
}


// Windows paths are case-insensitive; treat a target as "contained" in itself or a parent.
function isSameOrNested(parent, child) {
  if (!parent || !child) return false;
  const normalize = (value) => {
    const resolved = path.resolve(value).replace(/[\/]+$/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const base = normalize(parent);
  const target = normalize(child);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

module.exports = { renameWithRetry, cleanStaleDirs, swapIn, isSameOrNested };
