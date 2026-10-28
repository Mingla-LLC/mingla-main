// #2829 W8 — `run-local-sites.sh --frozen` serves the edge functions from a
// snapshot of the current commit, so editing code in the checkout cannot
// restart a long-lived preview (incident 2026-10-26: `functions serve` watches
// the folder it serves; edits to the live symlinked tree restarted the edge
// runtime under Seth's preview and the site 404'd while workers cold-started).
// Runs the real shell function in a throwaway git repo (mktemp), never the
// anchor or this checkout.
// #2829 W11 — the snapshots (and the Core workdir) live OUTSIDE the repository
// tree: a snapshot copies every test and *.ci-suite.json declaration, and
// in-tree copies broke CI discovery and jest's ci-discovery suites.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const COMMON = join(REPO_ROOT, "scripts/sites/local/lib/common.sh");

function throwawayRepo() {
  const root = mkdtempSync(join(tmpdir(), "sites-frozen-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "fixture");
  mkdirSync(join(root, "supabase/functions/demo"), { recursive: true });
  mkdirSync(join(root, "packages/shared"), { recursive: true });
  writeFileSync(join(root, "supabase/functions/demo/index.ts"), "export const v = 'committed';\n");
  writeFileSync(join(root, "packages/shared/x.ts"), "export const x = 1;\n");
  writeFileSync(join(root, "supabase/functions/.env.local"), "SECRET=never-archived\n");
  writeFileSync(join(root, ".gitignore"), "supabase/functions/.env.local\n");
  git("add", ".");
  git("commit", "-q", "-m", "fixture");
  const home = mkdtempSync(join(tmpdir(), "sites-frozen-home-"));
  const core = join(shell(root, home, 'printf "%s\\n" "$CORE_WORKDIR"').stdout.trim().split("\n").pop(), "supabase");
  mkdirSync(core, { recursive: true });
  writeFileSync(join(core, "config.toml"), 'project_id = "fixture-local"\n');
  return { root, home };
}

function shell(root, home, command, extraEnv = {}) {
  return spawnSync("bash", ["-c", `repo_root="$1"; source "$2"; ${command}`, "x", root, COMMON], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, SITES_LOCAL_STACKS_DIR: "", DOCKER_HOST: "unix:///nonexistent.sock", ...extraEnv },
  });
}

function prepare({ root, home }) {
  return shell(root, home, "prepare_frozen_functions_workdir");
}

function cleanup({ root, home }) {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

test("#2829 W8 --frozen snapshots the commit, not the working tree", () => {
  const fx = throwawayRepo();
  const { root, home } = fx;
  try {
    const first = prepare(fx);
    assert.equal(first.status, 0, first.stderr);
    const workdir = first.stdout.trim().split("\n").pop();
    assert.match(workdir, /\/\.mingla-sites-local\/sites-frozen-[^/]+-[0-9a-f]{12}\/frozen-[0-9a-f]{12}$/);
    assert.ok(workdir.startsWith(`${home}/`), "snapshot lives under the user's home");
    assert.ok(!workdir.startsWith(`${root}/`), "snapshot is outside the repository tree");
    assert.ok(!existsSync(join(root, "scripts/sites/local/.stacks")), "nothing generated inside the checkout");
    assert.equal(readFileSync(join(workdir, "supabase/functions/demo/index.ts"), "utf8"), "export const v = 'committed';\n");
    assert.ok(existsSync(join(workdir, "packages/shared/x.ts")), "shared packages are in the snapshot");
    assert.equal(readFileSync(join(workdir, "supabase/config.toml"), "utf8"), 'project_id = "fixture-local"\n', "attaches to the same stack");
    assert.ok(!existsSync(join(workdir, "supabase/functions/.env.local")), "the gitignored keys file is never copied");

    // An edit in the checkout does not reach the served snapshot.
    writeFileSync(join(root, "supabase/functions/demo/index.ts"), "export const v = 'edited';\n");
    const second = prepare(fx);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout.trim().split("\n").pop(), workdir, "same commit -> same snapshot");
    assert.equal(readFileSync(join(workdir, "supabase/functions/demo/index.ts"), "utf8"), "export const v = 'committed';\n");
    assert.match(second.stderr, /uncommitted edits .* are NOT served/);
  } finally {
    cleanup(fx);
  }
});

test("#2829 W11 a stacks directory inside the checkout is refused", () => {
  const fx = throwawayRepo();
  try {
    const inside = shell(fx.root, fx.home, "echo reached", { SITES_LOCAL_STACKS_DIR: join(fx.root, "scripts/sites/local/.stacks") });
    assert.notEqual(inside.status, 0);
    assert.match(inside.stderr, /must be outside the repository/);
    assert.doesNotMatch(inside.stdout, /reached/);
  } finally {
    cleanup(fx);
  }
});

test("#2829 W11 common.sh never puts a stack workdir under the checkout", () => {
  const common = readFileSync(COMMON, "utf8");
  assert.doesNotMatch(common, /\$\{LOCAL_DIR\}\/\.stacks\/(core|frozen)/);
  assert.match(common, /CORE_WORKDIR="\$\{SITES_LOCAL_STACKS_DIR\}\/core"/);
});

test("#2829 W8 run-local-sites.sh serves the snapshot when --frozen is given", () => {
  const script = readFileSync(join(REPO_ROOT, "scripts/sites/local/run-local-sites.sh"), "utf8");
  assert.match(script, /--frozen\) frozen=1 ;;/);
  assert.match(script, /functions_workdir="\$\(prepare_frozen_functions_workdir\)" \|\| exit 2/);
  assert.match(script, /functions serve --workdir "\$functions_workdir"/);
  assert.doesNotMatch(script, /functions serve --workdir "\$CORE_WORKDIR"/);
});
