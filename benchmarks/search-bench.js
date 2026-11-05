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
const rounds = 5;
const jsonOutput = process.argv.includes("--json");
const assertions = process.argv.includes("--assert");

function percentile(values, value) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))];
}

function startBackend() {
  if (!fs.existsSync(binary)) throw new Error(`Missing backend binary at ${binary}`);
  const child = spawn(binary, ["--data", dataFile], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: child.stdout });
  let ready = false;
  let readyMessage = null;
  let nextId = 0;
  const pending = new Map();
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.type === "ready") {
      if (!message.ok) throw new Error(message.error || "backend failed to start");
      ready = true;
      readyMessage = message;
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    request.resolve(message);
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return {
    get readyMessage() { return readyMessage; },
    async waitReady() {
      while (!ready) {
        if (child.exitCode !== null) throw new Error(`backend exited with ${child.exitCode}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    request(method, params = {}) {
      return new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, { resolve });
        child.stdin.write(`${JSON.stringify({ id, method, ...params })}\n`);
      });
    },
    stop() {
      try { child.stdin.write(`${JSON.stringify({ id: 0, method: "shutdown" })}\n`); } catch { /* closed */ }
      child.stdin.end();
      child.kill();
    },
  };
}

async function main() {
  const raw = fs.readFileSync(dataFile, "utf8");
  const parseStarted = performance.now();
  const videos = JSON.parse(raw);
  const parseMs = performance.now() - parseStarted;

  const beforeHeap = process.memoryUsage().heapUsed;
  const buildStarted = performance.now();
  const index = new SearchIndex(videos, mainSearchFields, mainSearchOptions());
  const jsBuildMs = performance.now() - buildStarted;
  const afterHeap = process.memoryUsage().heapUsed;

  const jsTimes = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const query of queries) {
      const started = performance.now();
      index.search(query);
      jsTimes.push(performance.now() - started);
    }
  }

  const backend = startBackend();
  await backend.waitReady();
  const goBuildMs = Number(backend.readyMessage.build_ms) || 0;
  const goInternal = [];
  const goIpc = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const query of queries) {
      const started = performance.now();
      const response = await backend.request("search", { query, limit: 20000 });
      goIpc.push(performance.now() - started);
      goInternal.push(Number(response.took_ms) || 0);
    }
  }
  const stats = await backend.request("stats");
  const trimmed = await backend.request("trim");
  backend.stop();

  const result = {
    videos: videos.length,
    parse_ms: Number(parseMs.toFixed(1)),
    js: {
      build_ms: Number(jsBuildMs.toFixed(1)),
      heap_delta_mb: Number(((afterHeap - beforeHeap) / 1048576).toFixed(1)),
      query_p50_ms: Number(percentile(jsTimes, 0.5).toFixed(2)),
      query_p95_ms: Number(percentile(jsTimes, 0.95).toFixed(2)),
      query_max_ms: Number(Math.max(...jsTimes).toFixed(2)),
    },
    go: {
      build_ms: Number(goBuildMs.toFixed(1)),
      heap_mb: Number(stats.stats?.heap_mb || 0),
      query_p50_ms: Number(percentile(goInternal, 0.5).toFixed(2)),
      query_p95_ms: Number(percentile(goInternal, 0.95).toFixed(2)),
      query_max_ms: Number(Math.max(...goInternal).toFixed(2)),
      ipc_p50_ms: Number(percentile(goIpc, 0.5).toFixed(2)),
      ipc_p95_ms: Number(percentile(goIpc, 0.95).toFixed(2)),
      ipc_max_ms: Number(Math.max(...goIpc).toFixed(2)),
      trim_freed_mb: Number(trimmed.freed_mb || 0),
    },
  };

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Videos: ${result.videos} (JSON parse ${result.parse_ms} ms)`);
    console.log(`JS  build ${result.js.build_ms} ms | heap +${result.js.heap_delta_mb} MB | p50 ${result.js.query_p50_ms} ms | p95 ${result.js.query_p95_ms} ms`);
    console.log(`Go  build ${result.go.build_ms} ms | heap ${result.go.heap_mb} MB | p50 ${result.go.query_p50_ms} ms | p95 ${result.go.query_p95_ms} ms | IPC p95 ${result.go.ipc_p95_ms} ms | trim freed ${result.go.trim_freed_mb} MB`);
  }

  if (assertions) {
    const failures = [];
    if (result.js.build_ms > 5000) failures.push(`JS build ${result.js.build_ms} ms`);
    if (result.js.query_p95_ms > 200) failures.push(`JS p95 ${result.js.query_p95_ms} ms`);
    if (result.js.heap_delta_mb > 128) failures.push(`JS heap ${result.js.heap_delta_mb} MB`);
    if (result.go.build_ms > 5000) failures.push(`Go build ${result.go.build_ms} ms`);
    if (result.go.query_p95_ms > 100) failures.push(`Go p95 ${result.go.query_p95_ms} ms`);
    if (result.go.ipc_p95_ms > 200) failures.push(`Go IPC p95 ${result.go.ipc_p95_ms} ms`);
    if (failures.length) {
      console.error(`Performance budgets exceeded: ${failures.join(", ")}`);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
