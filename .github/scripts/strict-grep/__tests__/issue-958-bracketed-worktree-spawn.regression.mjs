// ISSUE-958 [bracketed worktree path gates] — IMPLEMENTOR HAPPY-PATH regression.
//
// Guards the Part-A fix: the four strict-grep wrappers that spawn their sibling
// gate now derive the child path via `fileURLToPath(SCRIPT)` (a real filesystem
// path) instead of `SCRIPT.pathname` (a URL component that percent-encodes
// `[`→%5B, `]`→%5D, space→%20). Before the fix, running any of them from a
// worktree whose absolute path contains brackets/spaces (e.g.
// `958-[bracketed-worktree-path-gates]`) crashed every spawning subtest with
// `Cannot find module '…%5B…%5D…/<gate>.mjs'` (MODULE_NOT_FOUND).
//
// Reproduction faithful to the real bug: for each wrapper we build a throwaway
// directory whose absolute path carries `[`, `]` AND a space, laid out as a real
// repo root. Real (NON-symlink) copies of the wrapper + its sibling gate live
// under `<base>/.github/scripts/strict-grep/` so the wrapper's `import.meta.url`
// carries GENUINE brackets — a symlink would be realpath-resolved by Node's ESM
// loader and silently lose them, defeating the reproduction. Every other
// top-level repo dir is symlinked in so the gate's own REPO_ROOT resolution
// (three levels up from itself) sees the real post-fix source and its plain-mode
// self-check passes. This is why we do NOT copy only wrapper+gate into an
// isolated dir: three of the four gates run a plain-mode "gate passes the
// post-fix codebase" subtest that scans the real repo, which an isolated copy
// lacks (that would fail with an unrelated assertion error, not the bracket bug).
//
// The wrapper is invoked as a RELATIVE arg with cwd = the bracketed strict-grep
// dir. Passing the bracketed ABSOLUTE path to `node --test` is wrong: Node
// glob-interprets `[...]` as a char-class and matches zero files.
//
// Fails-on-revert: reverting any wrapper to `SCRIPT.pathname` reintroduces
// `Cannot find module '…%5B…%5D…'` → the spawning subtest throws → status ≠ 0 and
// the merged output contains both `%5B` and `MODULE_NOT_FOUND` → this regression
// fails for that wrapper.
//
// Scope note: this is the implementor's happy-path proof (wrapper spawn from a
// bracketed+spaced path). The DISTINCT adversarial angles — orch-0964 `.next`
// non-descent + a unicode-and-space path — belong to the tester's separate file
// (`issue-958-next-walker-and-unicode-path.adversarial.mjs`) and are not
// pre-empted here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SG_REL = ".github/scripts/strict-grep";

// The four wrappers fixed by #958 Part A, each paired with the sibling gate .mjs
// it spawns. If a wrapper is renamed or relocated this list must move with it —
// a stale entry makes the copy throw ENOENT, which is a loud fail, never a
// silent pass.
const WRAPPERS = [
  [
    "i-proposed-orch-0931-no-pk-filter-realtime.test.mjs",
    "i-proposed-orch-0931-no-pk-filter-realtime.mjs",
  ],
  [
    "i-proposed-orch-0943-custom-coords-locked.test.mjs",
    "i-proposed-orch-0943-custom-coords-locked.mjs",
  ],
  [
    "i-proposed-orch-0939-collab-deck-has-per-session-provider.test.mjs",
    "i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs",
  ],
  [
    "i-proposed-finalize-callers-pass-installment-params.test.mjs",
    "i-proposed-finalize-callers-pass-installment-params.mjs",
  ],
];

/**
 * Build a throwaway repo-root tree whose absolute path contains `[`, `]`, and a
 * space. Real copies of the wrapper + gate go under
 * `<base>/.github/scripts/strict-grep/`; every other top-level repo entry is
 * symlinked in so the gate resolves the real post-fix source.
 * @returns {{ base: string, sgDir: string }}
 */
function buildBracketedTree(wrapper, gate) {
  // mkdtemp appends 6 random chars; the prefix carries the bracket+space payload.
  const base = mkdtempSync(path.join(os.tmpdir(), "issue-958-[br ket]-"));
  const sgDir = path.join(base, SG_REL);
  mkdirSync(sgDir, { recursive: true });
  cpSync(path.join(REPO_ROOT, SG_REL, wrapper), path.join(sgDir, wrapper));
  cpSync(path.join(REPO_ROOT, SG_REL, gate), path.join(sgDir, gate));
  for (const entry of readdirSync(REPO_ROOT)) {
    // Skip the git metadata and .github (rebuilt as a real dir above).
    if (entry === ".git" || entry === ".github") continue;
    symlinkSync(path.join(REPO_ROOT, entry), path.join(base, entry));
  }
  return { base, sgDir };
}

for (const [wrapper, gate] of WRAPPERS) {
  test(`#958: ${wrapper} spawns its gate from a bracketed+spaced worktree path`, () => {
    const { base, sgDir } = buildBracketedTree(wrapper, gate);
    try {
      // Strip NODE_TEST_CONTEXT so the nested `node --test` runs as a normal
      // top-level runner. When THIS regression is itself invoked via
      // `node --test` (how CI runs it), that variable leaks into the child and
      // flips it into child-reporter mode, which exits 0 regardless of failures
      // and would silently mask a reverted wrapper. Same defence the
      // append-only gate's self-test uses for GITHUB_*/GIT_* leakage.
      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ["--test", `./${wrapper}`], {
        cwd: sgDir,
        encoding: "utf8",
        env: childEnv,
      });
      const merged = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      assert.equal(
        result.status,
        0,
        `${wrapper} failed from a bracketed path (exit ${result.status}):\n${merged}`,
      );
      assert.ok(
        !merged.includes("%5B"),
        `${wrapper} output contains a percent-encoded '[' (%5B) — the bracket-encoding bug is back:\n${merged}`,
      );
      assert.ok(
        !merged.includes("MODULE_NOT_FOUND"),
        `${wrapper} output contains MODULE_NOT_FOUND — the gate module was not resolvable from the bracketed path:\n${merged}`,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
}
