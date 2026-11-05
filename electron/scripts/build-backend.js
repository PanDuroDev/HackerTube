const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..", "..");
const backend = path.join(root, "backend");
const outputDir = path.join(__dirname, "..", "backend-bin");

function flag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function normalizeTarget(value) {
  if (!value || value === "current") return process.platform;
  const aliases = { win: "win32", windows: "win32", mac: "darwin", darwin: "darwin", linux: "linux" };
  return aliases[String(value).toLowerCase()] || String(value);
}

function normalizeArchitecture(value, target) {
  const requested = value && value !== "current" ? String(value).toLowerCase() : process.arch;
  if (requested === "universal" && target === "darwin") return "universal";
  return { x64: "amd64", ia32: "386", arm: "arm", arm64: "arm64", amd64: "amd64" }[requested] || requested;
}

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

const targetOs = normalizeTarget(flag("--target"));
const targetArch = normalizeArchitecture(flag("--arch"), targetOs);
const binaryName = targetOs === "win32" ? "hackertube-backend.exe" : "hackertube-backend";
const goOs = targetOs === "win32" ? "windows" : targetOs;

fs.mkdirSync(outputDir, { recursive: true });
const target = path.join(outputDir, binaryName);

if (targetArch === "universal") {
  if (process.platform !== "darwin") throw new Error("Universal macOS binaries must be built on macOS.");
  const arm = path.join(outputDir, `${binaryName}-arm64`);
  const intel = path.join(outputDir, `${binaryName}-amd64`);
  build("darwin", "arm64", arm);
  build("darwin", "amd64", intel);
  const lipo = spawnSync("lipo", ["-create", "-output", target, arm, intel], { stdio: "inherit" });
  fs.rmSync(arm, { force: true });
  fs.rmSync(intel, { force: true });
  if (lipo.error) throw lipo.error;
  if (lipo.status !== 0) process.exit(lipo.status || 1);
} else {
  build(goOs, targetArch, target);
  if (targetOs !== "win32") fs.chmodSync(target, 0o755);
}
console.log(`Built ${target}`);
