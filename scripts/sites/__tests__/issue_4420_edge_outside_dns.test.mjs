// #4420 — when the colima VM's resolver stops answering for outside names,
// the edge watcher adds public resolver fallbacks inside the Core edge
// container only (Docker's 127.0.0.11 stays first for container names).
// Runs the real shell watcher against a fake `docker` in a throwaway
// directory; nothing real is touched.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const COMMON = join(REPO_ROOT, "scripts/sites/local/lib/common.sh");

function fakes({ outsideResolves }) {
  const dir = mkdtempSync(join(tmpdir(), "sites-edge-dns-"));
  const log = join(dir, "docker.log");
  const fixed = join(dir, "fixed");
  writeFileSync(join(dir, "docker"), `#!/bin/bash
echo "$*" >> "${log}"
case "$1" in
  inspect) echo true ;;
  exec)
    if [[ "$*" == *"getent hosts host.docker.internal"* ]]; then exit 0; fi
    if [[ "$*" == *"/etc/resolv.conf"* ]]; then touch "${fixed}"; exit 0; fi
    if [[ "$*" == *"getent hosts api.stripe.com"* ]]; then
      ${outsideResolves ? "exit 0" : `[[ -f "${fixed}" ]] && exit 0 || exit 2`}
    fi
    exit 0 ;;
esac
`);
  writeFileSync(join(dir, "colima"), "#!/bin/bash\nexit 0\n");
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

test("#4420 adds public resolver fallbacks inside the edge container when outside names fail", async () => {
  const { dir, log } = fakes({ outsideResolves: false });
  try {
    const out = await runWatcher(dir);
    const calls = readFileSync(log, "utf8");
    assert.match(calls, /exec -u root supabase_edge_runtime_mingla-sites-core-local sh -c printf 'nameserver 127\.0\.0\.11\\nnameserver 1\.1\.1\.1/);
    assert.match(out, /added public resolver fallbacks/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#4420 leaves the container resolver alone when outside names resolve", async () => {
  const { dir, log } = fakes({ outsideResolves: true });
  try {
    const out = await runWatcher(dir);
    assert.doesNotMatch(readFileSync(log, "utf8"), /resolv\.conf/);
    assert.doesNotMatch(out, /resolver fallbacks/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
