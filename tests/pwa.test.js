"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "public");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function pngSize(file) {
  const bytes = fs.readFileSync(path.join(ROOT, file));
  assert.equal(bytes.toString("ascii", 1, 4), "PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("the web app manifest provides install metadata and maskable icons", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.start_url, "./");
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(manifest.theme_color && manifest.background_color);
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.type === "image/png"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.type === "image/png"));
  assert.ok(manifest.icons.some((icon) => String(icon.purpose).includes("maskable")));
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 1);
});

test("the PWA icons have the expected PNG dimensions", () => {
  assert.deepEqual(pngSize("icons/icon-192.png"), { width: 192, height: 192 });
  assert.deepEqual(pngSize("icons/icon-512.png"), { width: 512, height: 512 });
  assert.deepEqual(pngSize("icons/icon-maskable-512.png"), { width: 512, height: 512 });
  assert.deepEqual(pngSize("icons/apple-touch-icon.png"), { width: 180, height: 180 });
});

test("the document metadata keeps the em dash intact", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /â€”/);
  assert.match(html, /<title[^>]*>[^<]*—[^<]*<\/title>/);
  assert.match(html, /property="og:title" content="[^"]*—/);
  assert.match(html, /name="twitter:title" content="[^"]*—/);
});

test("the document links the install manifest and Apple metadata", () => {
  const html = read("index.html");
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/);
  assert.match(html, /rel="icon" type="image\/svg\+xml" href="icons\/icon\.svg"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /name="theme-color" content="#0f0f0f"/);
});

test("the app registers the service worker and exposes an install action", () => {
  const app = read("app.js");
  assert.match(app, /serviceWorker\.register\("sw\.js"\)/);
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /data-install-app/);
  assert.match(app, /settings\.installTitle/);
  assert.match(app, /function setupWebUpdates\(registration\)/);
  assert.match(app, /navigator\.serviceWorker\.controller/);
  assert.match(app, /postMessage\(\{ type: "SKIP_WAITING" \}\)/);
  assert.match(app, /registration\.addEventListener\("updatefound"/);

  const sw = read("sw.js");
  assert.match(sw, /addEventListener\("install"/);
  assert.match(sw, /addEventListener\("fetch"/);
  assert.match(sw, /const VERSION = "v3"/);
  assert.match(sw, /ht-shell-\$\{VERSION\}/);
  assert.match(sw, /networkFirst/);
  assert.match(sw, /searchParams\.has\("v"\)/);
  assert.match(sw, /addEventListener\("message"/);
  assert.match(sw, /SKIP_WAITING/);
  assert.doesNotMatch(sw, /cache\.addAll\(PRECACHE\)\)\s*\.then\(\(\) => self\.skipWaiting\(\)\)/);
});
