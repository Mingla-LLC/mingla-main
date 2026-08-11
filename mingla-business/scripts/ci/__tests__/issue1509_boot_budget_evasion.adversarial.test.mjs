/**
 * Issue #1509 — ADVERSARIAL cover. Different angle from the happy-path suite.
 *
 * The happy suite proves the gate does the right thing when used honestly. This
 * one assumes the opposite: that someone under deadline pressure wants their PR
 * to go green, and goes looking for the cheapest way to make the number stop
 * complaining. Every test below is an escape route that either existed in the
 * old design or would be the obvious next thing to try.
 *
 * It also carries the vacuity guard. A budget gate that cannot fail is worse
 * than no gate, because it is cited as protection — which is exactly what
 * happened to the two checks #1509 found dead (a total-payload ceiling 2.8x
 * above reality, and a `>= 3 chunks` assertion against a 180-chunk export).
 * Several tests here exist purely to prove the remaining checks still bite.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATE_NAME = "orch-1083-initial-bundle-budget.mjs";
const GATE = join(CI_DIR, GATE_NAME);
const BASELINE = JSON.parse(readFileSync(join(CI_DIR, "bundle-baseline.json"), "utf8"));

let scratch;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "issue1509-adv-"));
});
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * Build a synthetic export.
 *
 * The entry chunk is sized so the EAGER total lands exactly on the recorded
 * baseline unless a test says otherwise. Without that, every fixture would also
 * be moving the second scope by ~2.9 MB and each test would be asserting about
 * two things at once — which is precisely the confound this suite caught on its
 * first run.
 *
 * `incompressibleCommon` fills only `__common` with random bytes, so the brotli
 * ceiling can be exercised on one scope without dragging the other over too.
 */
function makeBuild({ commonRaw, entryRaw, incompressibleCommon = false }) {
  const dir = mkdtempSync(join(scratch, "build-"));
  const jsDir = join(dir, "_expo", "static", "js", "web");
  mkdirSync(jsDir, { recursive: true });
  const text = (n) => Buffer.from("/* filler */\n".repeat(Math.ceil(n / 13)).slice(0, n));

  const common = `__common-${"a".repeat(32)}.js`;
  const entry = `index-${"b".repeat(32)}.js`;
  const entrySize = entryRaw ?? Math.max(1_000, BASELINE.eager.raw - commonRaw);
  writeFileSync(join(jsDir, common), incompressibleCommon ? randomBytes(commonRaw) : text(commonRaw));
  writeFileSync(join(jsDir, entry), text(entrySize));
  const pad = text;
  for (let i = 0; i < 4; i++) writeFileSync(join(jsDir, `r${i}-${"c".repeat(32)}.js`), pad(500));
  writeFileSync(
    join(dir, "index.html"),
    `<!DOCTYPE html><html><body>` +
      `<script src="/_expo/static/js/web/${common}"></script>` +
      `<script src="/_expo/static/js/web/${entry}"></script>` +
      `</body></html>`,
  );
  return dir;
}

function cloneCiDir(mutate) {
  const dir = mkdtempSync(join(scratch, "ci-"));
  for (const f of [
    GATE_NAME,
    "bundle-budget-lib.mjs",
    "bundle-baseline-update.mjs",
    "bundle-baseline.json",
  ]) {
    copyFileSync(join(CI_DIR, f), join(dir, f));
  }
  if (mutate) mutate(dir);
  return dir;
}

const run = (buildDir, { ciDir = CI_DIR, env = {}, args = [] } = {}) =>
  spawnSync(process.execPath, [join(ciDir, GATE_NAME), ...args], {
    encoding: "utf8",
    env: { ...process.env, ORCH_1083_WEB_BUILD: buildDir, ...env },
  });

describe("#1509 adversarial — the ways someone would try to make this stop complaining", () => {
  test("the retired env overrides cannot loosen the gate", () => {
    // The old gate read `ORCH_1083_COMMON_CAP` and `ORCH_1083_CEILING`, so any
    // job — or any developer — could raise the limit without touching a file
    // under review. #1509 removed both. Setting them must now change nothing.
    const build = makeBuild({ commonRaw: BASELINE.common.raw + 500_000 });
    const withOverride = run(build, {
      env: {
        ORCH_1083_COMMON_CAP: "99999999",
        ORCH_1083_CEILING: "99999999",
      },
    });
    assert.equal(withOverride.status, 1, "an env override must not buy headroom");
    const without = run(build);
    assert.equal(without.status, 1);
    assert.equal(
      withOverride.status,
      without.status,
      "the gate's verdict must be identical with and without the retired overrides",
    );
  });

  test("hand-writing a bigger baseline does not unlock the product ceiling", () => {
    // The obvious next move once the delta gate blocks you: edit the baseline
    // up so your delta looks small. The ceiling check runs first and is
    // computed from a constant, so this buys nothing.
    const ciDir = cloneCiDir((dir) => {
      const b = JSON.parse(readFileSync(join(dir, "bundle-baseline.json"), "utf8"));
      b.common.raw = 2_599_000; // just under the 2,600,000 ceiling
      writeFileSync(join(dir, "bundle-baseline.json"), JSON.stringify(b, null, 2));
    });
    const r = run(makeBuild({ commonRaw: 2_610_000 }), { ciDir });
    assert.equal(r.status, 1, "the product ceiling must hold regardless of the baseline");
    assert.match(r.stderr, /PRODUCT CEILING/);
    assert.match(r.stderr, /Do NOT raise it to land this PR/);
  });

  test("a baseline written above the ceiling is caught by the self-test, not silently obeyed", () => {
    // Defence in depth: if a baseline ever lands that would make the delta gate
    // unreachable, the self-test — which runs without needing an export — says so.
    const ciDir = cloneCiDir((dir) => {
      const b = JSON.parse(readFileSync(join(dir, "bundle-baseline.json"), "utf8"));
      b.common.raw = 2_700_000;
      writeFileSync(join(dir, "bundle-baseline.json"), JSON.stringify(b, null, 2));
    });
    const r = spawnSync(process.execPath, [join(ciDir, GATE_NAME), "--self-test"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 1, "an impossible baseline must fail the self-test");
    assert.match(r.stdout + r.stderr, /FAIL/);
  });

  test("deleting the baseline fails the gate instead of disabling it", () => {
    // The failure mode this repo has been bitten by before: a check whose input
    // goes missing and which then passes vacuously. Removing the baseline must
    // be louder than keeping it, never quieter.
    const ciDir = cloneCiDir((dir) => rmSync(join(dir, "bundle-baseline.json")));
    const r = run(makeBuild({ commonRaw: BASELINE.common.raw }), { ciDir });
    assert.equal(r.status, 1, "a missing baseline must fail closed");
    assert.match(r.stderr, /cannot read/);
    assert.match(r.stderr, /Restore the file rather than removing the check/);
  });

  test("the brotli ceiling bites independently of the raw ceiling", () => {
    // Proves the customer-felt limit is real and not decoration. This __common is
    // 77% UNDER the raw ceiling but does not compress, so what a guest actually
    // downloads is over the brotli limit — and that is the number that matters.
    const r = run(makeBuild({ commonRaw: 600_000, incompressibleCommon: true }));
    assert.equal(r.status, 1, "an incompressible payload must fail on brotli alone");
    assert.match(r.stderr, /__common/, "the failure must name the scope that actually broke");
    assert.match(r.stderr, /brotli/);
    assert.match(r.stderr, /PRODUCT CEILING/);
  });

  test("VACUITY GUARD — the gate provably fails on a bad build", () => {
    // If this ever passes, every other assertion in both suites is worthless.
    const bad = run(makeBuild({ commonRaw: 3_000_000 }));
    assert.equal(bad.status, 1, "an oversized payload MUST fail — the gate is falsifiable");
    const good = run(makeBuild({ commonRaw: BASELINE.common.raw }));
    assert.equal(good.status, 0, "...and a good payload MUST pass — the gate is not stuck red");
  });

  test("a missing export is an error, never a pass", () => {
    const r = run(join(scratch, "does-not-exist"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot read/);
  });

  test("the ratchet writes measurements only — it never edits a limit", () => {
    // The one thing automation must never be able to do is move the ceiling.
    const ciDir = cloneCiDir();
    const before = readFileSync(join(ciDir, GATE_NAME), "utf8");
    const build = makeBuild({ commonRaw: BASELINE.common.raw - 50_000 });
    const w = spawnSync(process.execPath, [join(ciDir, "bundle-baseline-update.mjs"), "--write"], {
      encoding: "utf8",
      env: { ...process.env, ORCH_1083_WEB_BUILD: build },
    });
    assert.equal(w.status, 0, w.stderr);
    assert.equal(
      readFileSync(join(ciDir, GATE_NAME), "utf8"),
      before,
      "the ratchet must not touch the file holding HARD_CEILING / PR_DELTA_ALLOWANCE",
    );
  });

  test("the ratchet ignores sub-noise movement so it cannot spam pull requests", () => {
    // The known macOS/Linux measurement variance is ~150 B. A ratchet that
    // opened a PR for that would be turned off within a week.
    const ciDir = cloneCiDir();
    const build = makeBuild({ commonRaw: BASELINE.common.raw - 200 });
    const c = spawnSync(process.execPath, [join(ciDir, "bundle-baseline-update.mjs"), "--check"], {
      encoding: "utf8",
      env: { ...process.env, ORCH_1083_WEB_BUILD: build },
    });
    assert.equal(c.status, 0, "a 200 B move must not be treated as a real change");
    assert.match(c.stdout, /baseline is current/);
  });

  test("platform measurement variance can no longer force a raise", () => {
    // The #871 raise was forced by a 149 B macOS/Linux difference eating the
    // last of ~9.9 KB of headroom. Against a 12,000 B allowance that class of
    // failure is gone.
    for (const variance of [-149, 149, 1_000]) {
      const r = run(makeBuild({ commonRaw: BASELINE.common.raw + variance }));
      assert.equal(r.status, 0, `a ${variance} B platform difference must not fail the gate`);
    }
  });
});
