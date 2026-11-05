const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..", "..");
const backend = path.join(root, "backend");
const outputDir = path.join(__dirname, "..", "backend-bin");
const name = process.platform === "win32" ? "hackertube-backend.exe" : "hackertube-backend";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: backend, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function build(goos, goarch, output) {
  run("go", ["build", "-trimpath", "-ldflags", "-s -w", "-o", output, "."], {
    env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: "0" },
  });
}

fs.mkdirSync(outputDir, { recursive: true });
const target = path.join(outputDir, name);

if (process.platform === "darwin") {
  const arm = path.join(outputDir, `${name}-arm64`);
  const intel = path.join(outputDir, `${name}-amd64`);
  build("darwin", "arm64", arm);
  build("darwin", "amd64", intel);
  const lipo = spawnSync("lipo", ["-create", "-output", target, arm, intel], { stdio: "inherit" });
  fs.rmSync(arm, { force: true });
  fs.rmSync(intel, { force: true });
  if (lipo.error) throw lipo.error;
  if (lipo.status !== 0) process.exit(lipo.status || 1);
} else {
  const goos = process.platform === "win32" ? "windows" : process.platform;
  const goarch = { x64: "amd64", ia32: "386", arm: "arm" }[process.arch] || process.arch;
  build(goos, goarch, target);
  if (process.platform !== "win32") fs.chmodSync(target, 0o755);
}
console.log(`Built ${target}`);
