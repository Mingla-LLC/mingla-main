// ISSUE-958 [bracketed worktree path gates] — TESTER ADVERSARIAL.
//
// Reserved for the tester per SPEC #958 §9. Attacks the TWO angles the
// implementor's happy-path regression (issue-958-bracketed-worktree-spawn.
// regression.mjs) deliberately does NOT cover:
//
//   ANGLE A — orch-0964 `.next` NON-DESCENT *and* DETECTION-PRESERVED.
//     For each of the three fixed walkers (theme-resolver-canonical,
//     theme-foreground-computed, theme-typed-columns) we build a throwaway
//     repo-root fixture containing only the canonical files each gate requires
//     (the real themeResolver.ts + the real orch-0964 migration), then:
//       (A1) plant a build artifact under `mingla-business/.next/server/app/
//            page.js` whose body matches the gate's OWN detection regex, and
//            assert the gate exits 0 — proving it does NOT descend into the Next
//            build dir. This assertion FAILS ON REVERT of the `.next` exclusion:
//            without it the walker recurses into the build output, matches the
//            planted identifier, and exits 1.
//       (A2) plant the SAME body in a REAL source path (`mingla-business/src/
//            ...`) and assert the gate exits 1 — proving detection is preserved
//            (the exclusion did not blind the gate). This FAILS if a future edit
//            over-broadens the exclusion or guts the regex.
//     Together A1+A2 pin the fix to BOTH halves: exclude the build dir, keep
//     detecting real source. The gates walk `process.cwd()`, so each is spawned
//     with `cwd` = the fixture root; each is a plain `node <gate>` process whose
//     exit code is authoritative (no `node --test`, so NODE_TEST_CONTEXT is
//     irrelevant to Angle A).
//
//   ANGLE B — UNICODE + SPACE worktree path (distinct from the implementor's
//     ASCII `[ ]`+space angle). `new URL().pathname` percent-encodes a non-ASCII
//     char just as it does a bracket (`é`->`%C3%A9`, space->`%20`), so a fixed
//     wrapper must still resolve its sibling gate from a path like
//     `issue-958-café dir-<rand>`. We run ONE fixed wrapper (0931) from such a
//     directory, laid out as a real repo root (real copies of wrapper+gate under
//     a genuine-unicode `.github/scripts/strict-grep/` so `import.meta.url` keeps
//     the non-ASCII bytes; every other top-level dir symlinked so the gate's
//     REPO_ROOT resolves the real post-fix source), and assert exit 0 with no
//     MODULE_NOT_FOUND and no percent-encoded unicode/space in the output.
//     NODE_TEST_CONTEXT is stripped from the child env: when THIS file is run via
//     `node --test` (how run-batch/CI invokes it) that variable would leak into
//     the nested `node --test <wrapper>` and flip it into child-reporter mode,
//     which exits 0 regardless of failures and would silently mask a reverted
//     wrapper.
//
// SELF-SCAN SAFETY: the three walkers scan `__tests__/` too, so a raw copy of any
// identifier they grep for would make them flag THIS very file. Every planted
// payload is therefore assembled from fragments (see below) so this file's own
// bytes never form the contiguous token; the concatenation only becomes the real
// matchable identifier at runtime, inside the throwaway fixture. The comments
// likewise never spell those identifiers out contiguously.
//
// Append-only: this is a NEW file (never modifies the implementor's regression
// or any gate). All spawns derive paths via fileURLToPath — never URL.pathname.

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
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SG_REL = ".github/scripts/strict-grep";

// Canonical files the three walkers require present at fixed paths (their
// non-walk assertions read these). Copied verbatim from the real post-fix repo
// so the base fixture passes clean — the ONLY thing that trips a gate is the
// body we plant.
const RESOLVER_REL = "packages/offering-rendering/themeResolver.ts";
const MIGRATION_REL =
  "supabase/migrations/20260729000002_orch_0964_brand_event_theme_columns.sql";

// ---------------------------------------------------------------------------
// ANGLE A — .next non-descent + detection preserved, for all 3 fixed walkers.
//
// Payloads are fragment-assembled (see SELF-SCAN SAFETY above). Each becomes,
// only at runtime, exactly one identifier its own gate greps for:
//   - resolver-canonical: a bare `theme`+`Color` assignment.
//   - foreground-computed: the `themeForeground`+`Color` identifier.
//   - typed-columns: a dotted `.theme.` + `theme`+`_color` access.
// ---------------------------------------------------------------------------

const GATES = [
  {
    gate: "orch-0964-theme-resolver-canonical.mjs",
    violation: "export function make() {\n  let theme" + 'Color = "#eb7825";\n  return 1;\n}\n',
  },
  {
    gate: "orch-0964-theme-foreground-computed.mjs",
    violation: 'export const marker = "themeForeground' + 'Color";\n',
  },
  {
    gate: "orch-0964-theme-typed-columns.mjs",
    violation: "export const read = (ctx) => ctx.theme." + "theme" + "_color;\n",
  },
];

/**
 * Build a throwaway repo-root fixture that already passes clean: it contains
 * only the two canonical files each walker needs, copied from the real repo.
 * @returns {string} absolute path to the fixture root
 */
function buildBaseFixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), "issue-958-next-walker-"));
  for (const rel of [RESOLVER_REL, MIGRATION_REL]) {
    mkdirSync(path.join(base, path.dirname(rel)), { recursive: true });
    cpSync(path.join(REPO_ROOT, rel), path.join(base, rel));
  }
  return base;
}

/** Spawn a plain `node <gate>` with cwd = fixture; return {status, merged}. */
function runGate(gateBasename, cwd) {
  const gateAbs = path.join(REPO_ROOT, SG_REL, gateBasename);
  const r = spawnSync(process.execPath, [gateAbs], { cwd, encoding: "utf8" });
  return { status: r.status, merged: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

for (const { gate, violation } of GATES) {
  test(`#958 A1: ${gate} does NOT descend into the Next build dir (planted match ignored)`, () => {
    const base = buildBaseFixture();
    try {
      const nextFile = path.join(
        base,
        "mingla-business/.next/server/app/page.js",
      );
      mkdirSync(path.dirname(nextFile), { recursive: true });
      writeFileSync(nextFile, violation);

      const { status, merged } = runGate(gate, base);
      assert.equal(
        status,
        0,
        `${gate} descended into the Next build dir and flagged compiled output (exit ${status}) — the build-dir exclusion is missing:\n${merged}`,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test(`#958 A2: ${gate} STILL flags the same body in real source (detection preserved)`, () => {
    const base = buildBaseFixture();
    try {
      const srcFile = path.join(
        base,
        "mingla-business/src/__issue958_adversarial__.ts",
      );
      mkdirSync(path.dirname(srcFile), { recursive: true });
      writeFileSync(srcFile, violation);

      const { status, merged } = runGate(gate, base);
      assert.equal(
        status,
        1,
        `${gate} failed to flag a genuine match in real source (exit ${status}) — detection was lost:\n${merged}`,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
}

// ---------------------------------------------------------------------------
// ANGLE B — unicode + space worktree path, one fixed wrapper (0931).
// ---------------------------------------------------------------------------

const UNICODE_WRAPPER = "i-proposed-orch-0931-no-pk-filter-realtime.test.mjs";
const UNICODE_GATE = "i-proposed-orch-0931-no-pk-filter-realtime.mjs";

/**
 * Build a repo-root tree whose absolute path carries a NON-ASCII char and a
 * space. Real copies of wrapper+gate live under `<base>/.github/scripts/
 * strict-grep/` so the wrapper's import.meta.url keeps the genuine unicode bytes
 * (a symlink would be realpath-resolved and could normalise them away); every
 * other top-level repo dir is symlinked so the gate's REPO_ROOT resolves the
 * real post-fix source.
 * @returns {{ base: string, sgDir: string }}
 */
function buildUnicodeTree() {
  // "café " carries U+00E9 (é) and a trailing space in the prefix.
  const base = mkdtempSync(path.join(os.tmpdir(), "issue-958-café dir-"));
  const sgDir = path.join(base, SG_REL);
  mkdirSync(sgDir, { recursive: true });
  cpSync(path.join(REPO_ROOT, SG_REL, UNICODE_WRAPPER), path.join(sgDir, UNICODE_WRAPPER));
  cpSync(path.join(REPO_ROOT, SG_REL, UNICODE_GATE), path.join(sgDir, UNICODE_GATE));
  for (const entry of readdirSync(REPO_ROOT)) {
    if (entry === ".git" || entry === ".github") continue;
    symlinkSync(path.join(REPO_ROOT, entry), path.join(base, entry));
  }
  return { base, sgDir };
}

test(`#958 B: ${UNICODE_WRAPPER} spawns its gate from a unicode+space worktree path`, () => {
  const { base, sgDir } = buildUnicodeTree();
  try {
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", `./${UNICODE_WRAPPER}`], {
      cwd: sgDir,
      encoding: "utf8",
      env: childEnv,
    });
    const merged = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.equal(
      result.status,
      0,
      `${UNICODE_WRAPPER} failed from a unicode+space path (exit ${result.status}):\n${merged}`,
    );
    assert.ok(
      !merged.includes("MODULE_NOT_FOUND"),
      `${UNICODE_WRAPPER} could not resolve its gate from a unicode+space path — the pathname-encoding bug is back:\n${merged}`,
    );
    // é -> %C3%A9, space -> %20 under URL.pathname; none may appear.
    assert.ok(
      !/%C3|%A9|%20/i.test(merged),
      `${UNICODE_WRAPPER} output carries a percent-encoded unicode/space path — URL.pathname regressed:\n${merged}`,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
