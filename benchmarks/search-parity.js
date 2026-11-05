const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { SearchIndex } = require("../public/search.js");
const { mainSearchFields, mainSearchOptions } = require("../public/search-fields.js");

const root = path.join(__dirname, "..");
const binary = path.join(root, "electron", "backend-bin", process.platform === "win32" ? "hackertube-backend.exe" : "hackertube-backend");
const dataFile = path.join(root, "public", "data", "videos.json");
const queries = [
  "python", "javascript", "react", "machine learning", "data structures",
  "بايثون", "هياكل البيانات", "c++", "linux docker", "rust ownership",
  "تعلم الالة", "computer science algorithms", "web development", "sql database",
  "cybersecurity", "net ninja", "freecodecamp", "flutter", "php laravel", "go golang",
];

function startBackend() {
  if (!fs.existsSync(binary)) {
    throw new Error(`Missing backend binary at ${binary}. Run npm run build:backend in electron/.`);
  }
  const child = spawn(binary, ["--data", dataFile], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: child.stdout });
  let ready = false;
  let nextId = 0;
  const pending = new Map();
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.type === "ready") {
      if (!message.ok) throw new Error(message.error || "backend failed to start");
      ready = true;
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    request.resolve(message);
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const waitReady = async () => {
    while (!ready) {
      if (child.exitCode !== null) throw new Error(`backend exited with ${child.exitCode}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const request = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, { resolve });
    child.stdin.write(`${JSON.stringify({ id, method, ...params })}\n`);
  });
  return {
    waitReady,
    request,
    stop: () => {
      try { child.stdin.write(`${JSON.stringify({ id: 0, method: "shutdown" })}\n`); } catch { /* closed */ }
      child.stdin.end();
      child.kill();
    },
  };
}

async function main() {
  const videos = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const started = performance.now();
  const index = new SearchIndex(videos, mainSearchFields, mainSearchOptions());
  const buildMs = performance.now() - started;
  const backend = startBackend();
  await backend.waitReady();

  let mismatches = 0;
  for (const query of queries) {
    const expected = index.search(query).map((result) => result.item.id);
    const response = await backend.request("search", { query, limit: 20000 });
    const actual = response.indices.map((position) => videos[position].id);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      mismatches += 1;
      const first = expected.findIndex((value, position) => value !== actual[position]);
      console.error(`Mismatch for "${query}" at ${first}: JS=${expected[first]} Go=${actual[first]}`);
    }
  }
  const stats = await backend.request("stats");
  backend.stop();

  console.log(`JS index build: ${buildMs.toFixed(1)} ms`);
  console.log(`Go document count: ${stats.stats?.docs ?? 0}`);
  console.log(`Queries compared: ${queries.length}; mismatches: ${mismatches}`);
  if (mismatches) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
