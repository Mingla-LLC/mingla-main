#!/usr/bin/env node
/**
 * TESTER ADVERSARIAL REGRESSION TEST — issue #957 [nul-fixture-grep-invisible].
 *
 * DIFFERENT ANGLE from the implementor's gate `--self-test`. The implementor's
 * self-test only calls the pure `scan()` function with four in-memory strings.
 * It NEVER exercises the gate's real-mode disk walk (`collectFiles` +
 * `fs.readFileSync(f,"utf8")`), and it never proves — against a real `grep` —
 * that the walk is actually binary-aware repo-wide rather than hardcoded to the
 * one fixture.
 *
 * THIS test attacks that gap end-to-end:
 *   1. It PLANTS a brand-new file with a REAL raw NUL byte AND a stale
 *      `ORCH-1382 links-src` line, in an ARBITRARY location under
 *      mingla-marketing/ (NOT the known fixture).
 *   2. It proves a plain `grep -rn "ORCH-1382"` cannot surface that file's LINE
 *      CONTENT — the NUL makes grep treat it as binary (this is the #957 bug) —
 *      while a binary-aware `grep -a` recovers the line. This is the exact
 *      blindness that let 3 stale tokens survive the 1383->1399 sweep.
 *   3. It proves the gate's REAL run (the disk walk) CATCHES it anyway and names
 *      the planted file — proving the gate scans binary-aware repo-wide.
 *   4. It removes the planted file and proves the gate returns to exit 0.
 *
 * FAILS-ON-BROKEN: if the gate were ever re-implemented with shell `grep`
 * (the NUL-blind approach that caused #957), step 3 would fail — the planted
 * NUL-hidden stale token would go undetected. The step-2 assertions anchor that:
 * the line content genuinely hides from plain grep and only a byte-reader scan
 * recovers it.
 *
 * Standalone tester artifact (append-only, brand-new file). Not registered in
 * the strict-grep MANIFEST and lives OUTSIDE .github/scripts/strict-grep/, so it
 * does not disturb meta-1383 parity. Run: `node .github/scripts/tester-957-repo-wide-nul-walk.test.mjs`
 * Exit 0 = all adversarial assertions hold; exit 1 = a regression.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// this file lives at .github/scripts/ -> repo root is up two levels.
const REPO_ROOT = path.join(__dirname, "..", "..");
// Defaults to the real gate. ISSUE957_GATE_OVERRIDE lets the tester point this
// same test at a deliberately NUL-blind (grep-based) gate to PROVE fails-on-broken:
// against such a gate step 3 fails, because it misses the planted NUL-hidden token.
const GATE =
  process.env.ISSUE957_GATE_OVERRIDE ||
  path.join(
    REPO_ROOT,
    ".github/scripts/strict-grep/issue-957-nul-hidden-orch-id-consistency.mjs",
  );

// Plant location: an arbitrary, NON-fixture path under mingla-marketing/ that
// the gate's recursive walk will reach (a .ts file, not a SKIP_DIR).
const PLANT_DIR = path.join(
  REPO_ROOT,
  "mingla-marketing/lib/__tests__/__957_adversarial_tmp__",
);
const PLANT_FILE = path.join(PLANT_DIR, "planted_nul_stale.ts");

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}

function runGate() {
  const r = spawnSync("node", [GATE], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function cleanup() {
  try {
    fs.rmSync(PLANT_DIR, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

try {
  // Baseline — the current tree must be clean before we plant anything.
  const before = runGate();
  check(
    before.code === 0,
    `BASELINE: expected the gate to exit 0 on the clean tree, got ${before.code}. Output:\n${before.out}`,
  );

  // Plant a REAL NUL byte beside a stale `ORCH-1382 links-src` token, on one
  // line, in a brand-new arbitrary file. Buffer guarantees the raw 0x00 byte
  // survives to disk (an editor would strip it — this does not).
  fs.mkdirSync(PLANT_DIR, { recursive: true });
  const planted = Buffer.concat([
    Buffer.from("// synthetic adversarial fixture — issue #957 tester\n"),
    Buffer.from("const trap = 'p"),
    Buffer.from([0x00]), // the raw NUL that hides the whole file from grep
    Buffer.from("q ORCH-1382 links-src planted-stale' // must be caught\n"),
  ]);
  fs.writeFileSync(PLANT_FILE, planted);

  // Integrity of the plant: exactly one NUL, and the stale token present.
  const raw = fs.readFileSync(PLANT_FILE);
  check(
    raw.includes(0x00),
    "PLANT: the synthetic file lost its NUL byte — the adversarial premise is void.",
  );
  check(
    raw.includes("ORCH-1382 links-src"),
    "PLANT: the synthetic file is missing the stale `ORCH-1382 links-src` token.",
  );

  // (2) A plain `grep` is BLIND to the line CONTENT of a NUL file — the exact
  //     failure that let 3 stale tokens survive the 1383->1399 sweep. BSD grep's
  //     NUL handling is inconsistent (it may print "Binary file matches" with no
  //     content, or exit 1 with nothing), but in EVERY case it never surfaces the
  //     matching LINE TEXT, so a find-and-replace renumber sweep cannot act on it.
  //     A binary-aware reader (`grep -a`, and the gate's `fs.readFileSync`) DOES
  //     recover the line. We assert both halves against a unique line marker.
  const MARKER = "planted-stale";
  const plain = spawnSync("grep", ["-rn", "ORCH-1382", PLANT_FILE], {
    encoding: "utf8",
  });
  const plainOut = (plain.stdout || "") + (plain.stderr || "");
  check(
    !plainOut.includes(MARKER),
    `GREP-BLIND: plain grep surfaced the line content ("${MARKER}") of a NUL file — ` +
      `the NUL-hidden premise is void. Output: ${JSON.stringify(plainOut)}`,
  );
  const aware = spawnSync("grep", ["-a", "-rn", "ORCH-1382", PLANT_FILE], {
    encoding: "utf8",
  });
  const awareOut = (aware.stdout || "") + (aware.stderr || "");
  check(
    aware.status === 0 && awareOut.includes(MARKER),
    `GREP-AWARE: expected binary-aware \`grep -a\` to recover the line content ("${MARKER}"), ` +
      `got exit ${aware.status}, output: ${JSON.stringify(awareOut)}. ` +
      `If -a cannot see it either, the plant is malformed.`,
  );

  // (3) The gate's REAL disk walk MUST catch the planted file that grep missed —
  //     proving the walk is binary-aware repo-wide, not hardcoded to the fixture.
  const planted_run = runGate();
  check(
    planted_run.code === 1,
    `CATCH: expected the gate to exit 1 with the planted NUL-hidden stale token present, got ${planted_run.code}. ` +
      `A grep-based gate would MISS it (the #957 regression). Output:\n${planted_run.out}`,
  );
  check(
    planted_run.out.includes("planted_nul_stale.ts"),
    `CATCH: the gate exited 1 but did not name the planted file '__957_adversarial_tmp__/planted_nul_stale.ts' — ` +
      `it may be flagging something else. Output:\n${planted_run.out}`,
  );
  check(
    planted_run.out.includes("ORCH-1382"),
    `CATCH: the gate's violation message did not mention the stale ORCH-1382 token. Output:\n${planted_run.out}`,
  );

  // (4) Remove the plant — the gate must return to exit 0 (no residue, tree clean).
  cleanup();
  const after = runGate();
  check(
    after.code === 0,
    `RESTORE: expected the gate to exit 0 after removing the planted file, got ${after.code}. Output:\n${after.out}`,
  );
} finally {
  cleanup();
}

if (failures.length) {
  console.error("tester-957 repo-wide-nul-walk adversarial test FAIL:");
  failures.forEach((m) => console.error("  - " + m));
  process.exit(1);
}
console.log(
  "tester-957 repo-wide-nul-walk adversarial test PASS " +
    "(baseline clean; plain grep is blind to the planted NUL file's line content while `grep -a` recovers it; " +
    "the gate's real disk walk CATCHES the stale token repo-wide and names the file; tree restored).",
);
process.exit(0);
