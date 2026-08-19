// Shared fixtures for the #2300 suites.
//
// Everything here builds a DISPOSABLE world: real git repos in a temp dir, and
// fake `gh` / `xcrun` / `ps` executables. Nothing touches the operator's real
// checkout, real simulators, real AVDs, or the network.
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "../..");
export const libPath = join(repoRoot, "scripts/orch-worktree/lib/artifact-liveness.sh");
export const reapPath = join(repoRoot, "scripts/orch-worktree/reap.sh");
export const sweepPath = join(repoRoot, "scripts/orch-worktree/sweep.sh");

const git = (cwd, ...args) =>
  spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });

/** A bare "origin" plus an anchor clone on main, with one commit. */
export async function makeWorld(prefix) {
  const root = await mkdtemp(join(tmpdir(), `issue2300-${prefix}-`));
  const origin = join(root, "origin.git");
  const anchor = join(root, "anchor");
  await mkdir(origin, { recursive: true });
  git(origin, "init", "--bare", "--initial-branch=main");
  git(root, "clone", origin, "anchor");
  await writeFile(join(anchor, "README.md"), "seed\n");
  git(anchor, "add", "-A");
  git(anchor, "commit", "-m", "seed");
  git(anchor, "push", "origin", "main");
  // core.hooksPath: reap.sh/spawn.sh assume .githooks; keep hooks inert here.
  git(anchor, "config", "core.hooksPath", "/dev/null");
  return { root, origin, anchor, git: (...a) => git(anchor, ...a) };
}

/**
 * Add a worktree.
 *  - "fresh": branch created off main, NO commits (HEAD == main). This is the
 *    shape that TRAP 1 (merge-base ancestry) misreads as merged.
 *  - "squashed": one extra commit on the branch that is NOT in main, i.e. what
 *    a squash-merged branch looks like afterwards. TRAP 2 misreads this as
 *    unmerged work.
 */
export async function addWorktree(world, dirName, branch, shape = "squashed") {
  const wt = join(world.root, "orchs", dirName);
  await mkdir(join(world.root, "orchs"), { recursive: true });
  world.git("worktree", "add", wt, "-b", branch, "main");
  if (shape === "squashed") {
    await writeFile(join(wt, `${branch}.txt`), "work\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-m", `work on ${branch}`);
  }
  return wt;
}

export async function dirtyUp(wt) {
  await writeFile(join(wt, "uncommitted.txt"), "scratch\n");
}

/**
 * Fake CLI binaries.
 *   issues: { "2211": "OPEN", "2272": "CLOSED" }
 *   prs:    { "2272-web-dead-paths": "MERGED" }
 *   sims:   [{ name, state }]      state: "Booted" | "Shutdown"
 *   avds:   ["ISSUE1999-Pixel"]    -> reported as RUNNING by the fake ps
 *   ghBroken: true -> `gh` exits non-zero (network down / no token)
 */
export async function makeBins(root, { issues = {}, prs = {}, sims = [], avds = [], ghBroken = false } = {}) {
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });

  const ghBody = ghBroken
    ? `#!/usr/bin/env bash\nexit 1\n`
    : `#!/usr/bin/env bash
set -u
if [ "\${1:-}" = "issue" ] && [ "\${2:-}" = "view" ]; then
  case "\${3:-}" in
${Object.entries(issues).map(([n, s]) => `    ${n}) echo "${s}"; exit 0 ;;`).join("\n")}
  esac
  exit 1
fi
if [ "\${1:-}" = "pr" ] && [ "\${2:-}" = "list" ]; then
  head=""
  while [ "\$#" -gt 0 ]; do
    if [ "\$1" = "--head" ]; then head="\$2"; fi
    shift
  done
  case "\$head" in
${Object.entries(prs).map(([b, s]) => `    ${b}) echo "${s}"; exit 0 ;;`).join("\n")}
  esac
  echo ""      # gh prints empty for "no PR"
  exit 0
fi
exit 0
`;
  await writeFile(join(bin, "gh"), ghBody);
  await chmod(join(bin, "gh"), 0o755);

  const simLines = sims.map((s) => `    ${s.name} (UDID-${s.name}) (${s.state}) `).join("\\n");
  await writeFile(
    join(bin, "xcrun"),
    `#!/usr/bin/env bash
set -u
if [ "\${1:-}" = "simctl" ] && [ "\${2:-}" = "list" ]; then printf '%b\\n' "${simLines}"; exit 0; fi
if [ "\${1:-}" = "simctl" ] && [ "\${2:-}" = "delete" ]; then echo "deleted \${3:-}" >> "\${ISSUE2300_SIM_DELETES:-/dev/null}"; exit 0; fi
exit 0
`,
  );
  await chmod(join(bin, "xcrun"), 0o755);

  const psLines = avds.map((a) => `qemu-system-aarch64 -avd ${a} -no-snapshot`).join("\\n");
  await writeFile(
    join(bin, "ps"),
    `#!/usr/bin/env bash\nprintf '%b\\n' "${psLines}"\nexit 0\n`,
  );
  await chmod(join(bin, "ps"), 0o755);

  return bin;
}

/** Source the library and evaluate a bash snippet against it. */
export function evalLib(snippet, { bin, env = {} } = {}) {
  return spawnSync("bash", ["-c", `. "${libPath}"\n${snippet}`], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ORCH_GH: bin ? join(bin, "gh") : "gh",
      ORCH_XCRUN: bin ? join(bin, "xcrun") : "xcrun",
      ORCH_PS: bin ? join(bin, "ps") : "ps",
      ...env,
    },
  });
}

export function runScript(script, args, { bin, env = {} } = {}) {
  return spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: {
      PATH: `${bin ?? ""}:${process.env.PATH}`,
      HOME: process.env.HOME,
      ORCH_GH: bin ? join(bin, "gh") : "gh",
      ORCH_XCRUN: bin ? join(bin, "xcrun") : "xcrun",
      ORCH_PS: bin ? join(bin, "ps") : "ps",
      ...env,
    },
  });
}
