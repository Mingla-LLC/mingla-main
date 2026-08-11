/**
 * Issue #1509 — happy-path regression cover for the boot-budget ratchet.
 *
 * WHAT IS BEING PROTECTED: the eager `__common` cap used to be a single
 * hand-edited constant, and the only way to land a PR that grew the payload was
 * to edit it upward. That happened five times in four weeks. #1509 replaced it
 * with three separate things — a machine-maintained BASELINE, a per-PR DELTA
 * ALLOWANCE, and a Seth-only HARD CEILING — plus a post-merge ratchet that banks
 * reductions so they cannot be silently re-spent.
 *
 * FAILS ON REVERT: every assertion here targets something the old single-constant
 * gate did not have. Restore the old file and this suite goes red on the first
 * test — there is no baseline to read, no compressed measurement to print, and no
 * ratchet script to run.
 *
 * Fixtures are synthetic web exports, so the suite runs in milliseconds and needs
 * no `expo export`.
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
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(CI_DIR, "orch-1083-initial-bundle-budget.mjs");
const RATCHET = join(CI_DIR, "bundle-baseline-update.mjs");
const BASELINE = join(CI_DIR, "bundle-baseline.json");

let scratch;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "issue1509-"));
});
after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * Build a synthetic `expo export -p web` directory.
 *
 * `filler: "text"` compresses hard (so raw can be large while brotli stays
 * small — this isolates the raw checks); `filler: "random"` does not compress
 * (which is how the brotli ceiling gets exercised).
 */
function makeBuild({ commonRaw, entryRaw = 1_000_000, chunks = 5, filler = "text", extra = "" }) {
  const dir = mkdtempSync(join(scratch, "build-"));
  const jsDir = join(dir, "_expo", "static", "js", "web");
  mkdirSync(jsDir, { recursive: true });

  const pad = (n) =>
    filler === "random"
      ? Buffer.from(Array.from({ length: n }, (_, i) => (i * 2654435761) % 256))
      : Buffer.from("/* mingla boot payload filler */\n".repeat(Math.ceil(n / 33)).slice(0, n));

  const common = `__common-${"a".repeat(32)}.js`;
  const entry = `index-${"b".repeat(32)}.js`;
  writeFileSync(join(jsDir, common), Buffer.concat([Buffer.from(extra), pad(Math.max(0, commonRaw - extra.length))]));
  writeFileSync(join(jsDir, entry), pad(entryRaw));
  for (let i = 0; i < Math.max(0, chunks - 2); i++) {
    writeFileSync(join(jsDir, `route${i}-${"c".repeat(32)}.js`), pad(500));
  }

  writeFileSync(
    join(dir, "index.html"),
    `<!DOCTYPE html><html><body>` +
      `<script src="/_expo/static/js/web/${common}" defer></script>` +
      `<script src="/_expo/static/js/web/${entry}" defer></script>` +
      `</body></html>`,
  );
  return dir;
}

/** Run the gate against a build dir, optionally from a copied ci/ directory. */
function runGate(buildDir, { ciDir = CI_DIR, env = {} } = {}) {
  return spawnSync(
    process.execPath,
    [join(ciDir, "orch-1083-initial-bundle-budget.mjs")],
    {
      encoding: "utf8",
      env: { ...process.env, ORCH_1083_WEB_BUILD: buildDir, ...env },
    },
  );
}

/** Copy the ci scripts into scratch so a test can vary the baseline safely. */
function cloneCiDir(baselineMutator) {
  const dir = mkdtempSync(join(scratch, "ci-"));
  for (const f of [
    "orch-1083-initial-bundle-budget.mjs",
    "bundle-budget-lib.mjs",
    "bundle-baseline-update.mjs",
    "bundle-baseline.json",
  ]) {
    copyFileSync(join(CI_DIR, f), join(dir, f));
  }
  if (baselineMutator) {
    const b = JSON.parse(readFileSync(join(dir, "bundle-baseline.json"), "utf8"));
    writeFileSync(join(dir, "bundle-baseline.json"), JSON.stringify(baselineMutator(b), null, 2));
  }
  return dir;
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));

describe("#1509 — the boot budget is a baseline + allowance + ceiling, not one editable number", () => {
  test("the committed baseline exists and records main's real measurement", () => {
    // FAILS ON REVERT: the old gate had no baseline file at all.
    for (const scope of ["common", "eager"]) {
      for (const unit of ["raw", "gzip", "brotli"]) {
        assert.ok(
          Number.isFinite(baseline[scope][unit]) && baseline[scope][unit] > 0,
          `baseline.${scope}.${unit} must be a measured positive number`,
        );
      }
      assert.ok(
        baseline[scope].brotli < baseline[scope].gzip &&
          baseline[scope].gzip < baseline[scope].raw,
        `${scope}: compressed sizes must be smaller than raw`,
      );
    }
  });

  test("the gate self-test passes and asserts the ordering the design depends on", () => {
    const r = spawnSync(process.execPath, [GATE, "--self-test"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /self-test PASS/);
    // FAILS ON REVERT: the old self-test made exactly one assertion (the
    // deferred-specifier detector) and knew nothing about baselines or ceilings.
    assert.match(
      r.stdout,
      /hard ceiling is above baseline \+ allowance/,
      "the self-test must prove the delta gate is reachable, not dead code",
    );
  });

  test("a build that matches the baseline passes, and the measurement is reported", () => {
    const build = makeBuild({ commonRaw: baseline.common.raw });
    const r = runGate(build);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    // FAILS ON REVERT: the old gate only ever printed raw bytes. The whole point
    // of measuring brotli is that it is what a guest on mobile data waits for.
    assert.match(r.stdout, /brotli/, "the gate must report the customer-felt compressed size");
    assert.match(r.stdout, /runway/, "the gate must state how much ceiling runway is left");
  });

  test("one PR adding more than the allowance FAILS, and the message names the delta", () => {
    const over = baseline.common.raw + 12_000 + 5_000;
    const r = runGate(makeBuild({ commonRaw: over }));
    assert.equal(r.status, 1, "a PR over the per-PR allowance must fail the gate");
    assert.match(r.stderr, /grew [\d,]+ B in this branch/);
    // The failure must push toward attribution, not toward editing a number.
    assert.match(r.stderr, /bundle-attribute\.mjs/);
    assert.match(r.stderr, /Editing bundle-baseline\.json to make this pass/);
  });

  test("growth within the allowance passes without anyone editing a limit", () => {
    // This is the behaviour change that matters day to day: the #1835-sized
    // delta (+3,660 B) used to require a human to raise the cap. Now it lands.
    const r = runGate(makeBuild({ commonRaw: baseline.common.raw + 3_660 }));
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });

  test("the ratchet lowers the baseline when the payload shrinks", () => {
    const ciDir = cloneCiDir();
    const smaller = baseline.common.raw - 40_000;
    const build = makeBuild({ commonRaw: smaller });

    const check = spawnSync(process.execPath, [join(ciDir, "bundle-baseline-update.mjs"), "--check"], {
      encoding: "utf8",
      env: { ...process.env, ORCH_1083_WEB_BUILD: build },
    });
    assert.equal(check.status, 2, "a stale baseline must be reported as stale (exit 2)");
    assert.match(check.stdout, /reduction/);

    const write = spawnSync(process.execPath, [join(ciDir, "bundle-baseline-update.mjs"), "--write"], {
      encoding: "utf8",
      env: { ...process.env, ORCH_1083_WEB_BUILD: build },
    });
    assert.equal(write.status, 0, write.stderr);

    const after = JSON.parse(readFileSync(join(ciDir, "bundle-baseline.json"), "utf8"));
    assert.equal(after.common.raw, smaller, "the reduction must be written into the baseline");
    assert.ok(
      after.common.raw < baseline.common.raw,
      "FAILS ON REVERT: without the ratchet, a reduction is never recorded and the next branch spends it",
    );
  });

  test("once a reduction is banked, the next PR's allowance is computed from the SMALLER number", () => {
    // This is the property that makes the ratchet worth having. Before #1509 a
    // saving evaporated: the cap stayed where it was and the next branch used
    // the freed room without anyone noticing.
    const banked = baseline.common.raw - 40_000;
    const ciDir = cloneCiDir((b) => ({ ...b, common: { ...b.common, raw: banked } }));
    // A build back at the OLD size is now +40,000 B over the banked baseline.
    const r = runGate(makeBuild({ commonRaw: baseline.common.raw }), { ciDir });
    assert.equal(r.status, 1, "regressing to the pre-reduction size must now fail");
    assert.match(r.stderr, /grew 40,000 B/);
  });

  test("the deferred-specifier protection is untouched by #1509", () => {
    // ORCH-1083's original and still-working half: heavy deps must not be
    // statically reachable from any eager script.
    const r = runGate(
      makeBuild({
        commonRaw: baseline.common.raw,
        extra: 'require("@stripe/connect-js");',
      }),
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /deferred specifier/);
    assert.match(r.stderr, /@stripe\/connect-js/);
  });
});
