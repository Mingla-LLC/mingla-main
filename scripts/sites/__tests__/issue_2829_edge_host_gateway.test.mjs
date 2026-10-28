// #2829 W9a (A16) — `run-local-sites.sh` keeps `host.docker.internal`
// resolvable inside the Core edge-runtime container (after a colima restart
// or a container recreate the entry is gone and every Core → Studio call
// times out). Runs the real shell watcher against fake `docker` and `colima`
// commands in a throwaway directory; nothing real is touched.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const COMMON = join(REPO_ROOT, "scripts/sites/local/lib/common.sh");

function fakes({ resolves }) {
  const dir = mkdtempSync(join(tmpdir(), "sites-edge-gw-"));
  const log = join(dir, "docker.log");
  writeFileSync(join(dir, "docker"), `#!/bin/bash
echo "$*" >> "${log}"
case "$1" in
  inspect) echo true ;;
  exec)
    if [[ "$*" == *"getent hosts host.docker.internal"* ]]; then ${resolves ? "echo '192.168.5.2 host.docker.internal'; exit 0" : "exit 2"}; fi
    exit 0 ;;
esac
`);
  writeFileSync(join(dir, "colima"), `#!/bin/bash
echo "colima $*" >> "${log}"
echo "192.168.5.9     host.lima.internal"
`);
  chmodSync(join(dir, "docker"), 0o755);
  chmodSync(join(dir, "colima"), 0o755);
  return { dir, log };
}

function runWatcher(dir) {
  return new Promise((done) => {
    const child = spawn("bash", ["-c", `repo_root="$1"; source "$2"; edge_host_gateway_watch`, "x", dir, COMMON], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DOCKER_HOST: "unix:///nonexistent.sock" },
    });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    setTimeout(() => { child.kill("SIGKILL"); done(out); }, 1500);
  });
}

test("#2829 W9a adds host.docker.internal to the edge container when it is missing", async () => {
  const { dir, log } = fakes({ resolves: false });
  try {
    const out = await runWatcher(dir);
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /colima ssh -p mingla-2829 -- getent hosts host\.lima\.internal/);
    assert.match(calls, /exec -u root supabase_edge_runtime_mingla-sites-core-local sh -c printf '%s host\.docker\.internal\\n' '192\.168\.5\.9' >> \/etc\/hosts/);
    assert.match(out, /added host\.docker\.internal -> 192\.168\.5\.9/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#2829 W9a leaves a container that already resolves the name alone", async () => {
  const { dir, log } = fakes({ resolves: true });
  try {
    await runWatcher(dir);
    const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
    assert.doesNotMatch(calls, /exec -u root/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
