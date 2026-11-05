const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SearchIndex } = require("../public/search.js");
const { mainSearchFields, mainSearchOptions } = require("../public/search-fields.js");
const os = require("node:os");
const { startBackend } = require("../benchmarks/backend-client.js");

const dataFile = path.join(__dirname, "..", "public", "data", "videos.json");

test("catalog search index builds and answers within the performance budget", { timeout: 30000 }, () => {
  if (!fs.existsSync(dataFile)) {
    return;
  }
  const videos = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const started = performance.now();
  const index = new SearchIndex(videos, mainSearchFields, mainSearchOptions());
  const buildMs = performance.now() - started;
  assert.ok(buildMs < 5000, `index build took ${buildMs.toFixed(0)} ms`);

  const queries = ["python", "javascript", "data structures", "بايثون", "sql database", "flutter"];
  const times = [];
  for (const query of queries) {
    const before = performance.now();
    const results = index.search(query);
    times.push(performance.now() - before);
    assert.ok(results.length > 0, `no results for ${query}`);
  }
  times.sort((left, right) => left - right);
  const p95 = times[Math.floor(times.length * 0.95)];
  assert.ok(p95 < 200, `search p95 took ${p95.toFixed(0)} ms`);
});

test("benchmark backend client reports spawn failures instead of waiting", async () => {
  const backend = startBackend("definitely-missing-hackertube-backend", []);
  await assert.rejects(() => backend.waitReady());
});

test("benchmark backend client rejects requests when the child exits", async () => {
  const script = path.join(os.tmpdir(), `hackertube-backend-exit-test-${process.pid}.js`);
  fs.writeFileSync(script, `
    process.stdout.write(JSON.stringify({ type: "ready", ok: true }) + "\\n");
    process.stdin.resume();
    process.stdin.on("data", () => process.exit(0));
  `);
  const backend = startBackend(process.execPath, [script]);
  try {
    await backend.waitReady();
    await assert.rejects(() => backend.request("stats"));
  } finally {
    backend.stop();
    fs.rmSync(script, { force: true });
  }
});
