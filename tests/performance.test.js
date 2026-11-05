const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SearchIndex } = require("../public/search.js");
const { mainSearchFields, mainSearchOptions } = require("../public/search-fields.js");

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
