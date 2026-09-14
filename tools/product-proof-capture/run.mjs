#!/usr/bin/env node
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const sourceRoot = resolve(toolRoot, "../..");
const surface = process.argv[2];
if (surface !== "explorer" && surface !== "host") throw new Error("usage: run.mjs <explorer|host>");
const baseline = "925aab769cd4970336c16d80391db15773012607";
const appDir = surface === "explorer" ? "app-mobile" : "mingla-business";
const port = surface === "explorer" ? 8092 : 8093;
const tempRoot = mkdtempSync(join(tmpdir(), `mingla-3176-${surface}-`));

const git = (...args) => spawnSync("git", args, { cwd: sourceRoot, encoding: "utf8" });
const add = git("worktree", "add", "--detach", tempRoot, baseline);
if (add.status !== 0) throw new Error(`capture_worktree_add_failed:${add.stderr.trim()}`);

let child;
const cleanup = () => {
  if (child && child.exitCode === null) child.kill("SIGTERM");
  const remove = git("worktree", "remove", "--force", tempRoot);
  if (remove.status !== 0 && existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
};
process.once("SIGINT", () => { cleanup(); process.exit(130); });
process.once("SIGTERM", () => { cleanup(); process.exit(143); });
process.once("exit", cleanup);

// The requested proof is pinned to the pre-addendum application commit. Overlay
// only this audited harness and its opt-in Metro seam; production app source in
// the detached worktree is never altered.
cpSync(join(sourceRoot, "tools/product-proof-capture"), join(tempRoot, "tools/product-proof-capture"), { recursive: true });
cpSync(join(sourceRoot, appDir, "metro.config.js"), join(tempRoot, appDir, "metro.config.js"));
const sourceModules = join(sourceRoot, appDir, "node_modules");
const tempModules = join(tempRoot, appDir, "node_modules");
if (!existsSync(sourceModules)) throw new Error(`missing_node_modules:${sourceModules}`);
if (existsSync(tempModules)) rmSync(tempModules, { recursive: true, force: true });
symlinkSync(sourceModules, tempModules, "dir");
const rootModules = join(sourceRoot, "node_modules");
if (existsSync(rootModules) && !existsSync(join(tempRoot, "node_modules"))) symlinkSync(rootModules, join(tempRoot, "node_modules"), "dir");

const packagePath = join(tempRoot, appDir, "package.json");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const bridgeName = ".mingla-product-proof-entry.tsx";
writeFileSync(
  join(tempRoot, appDir, bridgeName),
  `globalThis.__MINGLA_CAPTURE_HARNESS__ = "1";\n` +
    `globalThis.__MINGLA_CAPTURE_BASELINE__ = "${baseline}";\n` +
    `require("../tools/product-proof-capture/${surface}/index");\n`,
);
pkg.main = bridgeName;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const env = {
  ...process.env,
  MINGLA_CAPTURE_HARNESS: "1",
  MINGLA_CAPTURE_SURFACE: surface,
  MINGLA_CAPTURE_BASELINE: baseline,
  NODE_ENV: "development",
  CI: "0",
};
child = spawn("npx", ["expo", "start", "--dev-client", "--localhost", "--port", String(port), "--clear"], {
  cwd: join(tempRoot, appDir), env, stdio: "inherit",
});
console.log(JSON.stringify({ surface, pid: child.pid, port, url: `http://127.0.0.1:${port}`, worktree: tempRoot, baseline }));
const [code] = await new Promise((done) => child.once("exit", (...args) => done(args)));
cleanup();
process.exit(code ?? 0);
