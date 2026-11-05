const fs = require("node:fs");
const path = require("node:path");
const { SearchIndex } = require("../public/search.js");
const { mainSearchFields, mainSearchOptions } = require("../public/search-fields.js");
const { startBackend } = require("./backend-client.js");

const root = path.join(__dirname, "..");
const binary = path.join(root, "electron", "backend-bin", process.platform === "win32" ? "hackertube-backend.exe" : "hackertube-backend");
const dataFile = path.join(root, "public", "data", "videos.json");
const queries = [
  "python", "javascript", "react", "machine learning", "data structures",
  "بايثون", "هياكل البيانات", "c++", "linux docker", "rust ownership",
  "تعلم الالة", "computer science algorithms", "web development", "sql database",
  "cybersecurity", "net ninja", "freecodecamp", "flutter", "php laravel", "go golang",
];

async function main() {
  if (!fs.existsSync(binary)) {
    throw new Error(`Missing backend binary at ${binary}. Run npm run build:backend in electron/.`);
  }
  const videos = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const started = performance.now();
  const index = new SearchIndex(videos, mainSearchFields, mainSearchOptions());
  const buildMs = performance.now() - started;
  const backend = startBackend(binary, ["--data", dataFile]);
  let stats = null;
  let mismatches = 0;

  try {
    await backend.waitReady();
    for (const query of queries) {
      const expected = index.search(query).map((result) => result.item.id);
      const response = await backend.request("search", { query, limit: 20000 });
      if (!response.ok) throw new Error(`Backend search failed for "${query}": ${response.error || "unknown error"}`);
      const actual = (response.indices || []).map((position) => videos[position].id);
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        mismatches += 1;
        const first = expected.findIndex((value, position) => value !== actual[position]);
        console.error(`Mismatch for "${query}" at ${first}: JS=${expected[first]} Go=${actual[first]}`);
      }
    }
    stats = await backend.request("stats");
    if (!stats?.ok) throw new Error(`Backend stats failed: ${stats?.error || "unknown error"}`);
  } finally {
    backend.stop();
  }

  console.log(`JS index build: ${buildMs.toFixed(1)} ms`);
  console.log(`Go document count: ${stats?.stats?.docs ?? 0}`);
  console.log(`Queries compared: ${queries.length}; mismatches: ${mismatches}`);
  if (mismatches) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
