#!/usr/bin/env node
/**
 * ORCH-1400 [gate-efficacy-triage] — TESTER ADVERSARIAL regression test
 * (mingla-tester, TEST phase; append-only; wired batch:A `node --test`).
 *
 * ANGLE — DELIBERATELY DIFFERENT from the implementor's proofs. The implementor
 * proved P10/P11/P12 fire on violating manifests (parity self-test, 30/30) and
 * that the batch executes what the MANIFEST declares. This suite attacks the
 * layer ABOVE those rules: the ratchet VALUES themselves. QA probes at
 * b92e1355d proved (QA_ORCH-1400 report, F-1/F-2):
 *
 *   - Raising `fixtureCap` or `capableUnwiredCap` trips NO automated gate:
 *     parity only checks count <= cap, and the tests-append-only MANIFEST
 *     ratchet has no rule for either field (it guards only gates[] shrink,
 *     selfTestWiredFloor lowering, and unenforcedCap raising). SPEC §9's
 *     "ratchets guarded by the SEPARATE tests-append-only.yml" is FALSE for
 *     the two caps ORCH-1400 introduced — the laundering path SC-2 closes
 *     could be reopened by a one-line cap bump no gate objects to.
 *   - The base-relative ratchet is rollback-blind inside a PR window: while
 *     main still says floor 185 / unenforcedCap 21, an in-PR commit can lower
 *     the floor 188 -> 185 or raise unenforcedCap 7 -> 8 and every gate stays
 *     green (probes recorded in the QA report).
 *   - P7 is >=-only, so `selfTestWiredFloor` may silently sit BELOW the wired
 *     count — SC-7's "floor equals wired count at every merge" was unenforced.
 *
 * This suite closes those holes by pinning the Phase-1 ratchet frontier
 * against the on-disk MANIFEST. Raising any cap (or de-synchronizing the
 * floor) now requires editing THIS test file, which `tests-append-only.yml`
 * only permits with a Seth-visible `[TEST-MOD-APPROVED ORCH-NNNN]` token —
 * restoring exactly the "visible token path" SC-2 promised.
 *
 * FRONTIER (b92e1355d): unenforcedCap 7 · fixtureCap 10 · capableUnwiredCap 23
 * · selfTestWiredFloor 188. Caps may only SHRINK from here; the floor may only
 * RISE, and must always EQUAL count(selfTest:"wired") (SC-7).
 *
 * FAILS-ON-REVERT (verified in the QA report, both directions):
 *   - fixtureCap 10 -> 11 (the laundering bump)      -> T-1 fails.
 *   - MANIFEST reverted to origin/main (pre-Phase-1) -> T-1 fails
 *     (unenforcedCap 21 > 7; fixtureCap/capableUnwiredCap absent).
 *   - floor left at 185 while 188 gates are wired    -> T-2 fails (equality).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, "..", "MANIFEST.json");
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const gates = manifest.gates;

// The ORCH-1400 Phase-1 frontier. Shrink-only: tightening these constants when
// a cap legitimately shrinks is allowed (and encouraged) under the same
// [TEST-MOD-APPROVED] token that guards every edit to this file.
const FRONTIER = {
  unenforcedCap: 7,
  fixtureCap: 10,
  capableUnwiredCap: 23,
  selfTestWiredFloorMin: 188,
};

const count = (pred) => gates.filter(pred).length;

test("T-1 caps exist and may only shrink from the Phase-1 frontier (cap-raise laundering guard)", () => {
  for (const field of ["unenforcedCap", "fixtureCap", "capableUnwiredCap"]) {
    assert.equal(
      typeof manifest[field],
      "number",
      `MANIFEST.json must carry numeric "${field}" (ORCH-1400 §4.1.a) — deleting it is the dark-state un-capping this test exists to block`,
    );
    assert.ok(
      manifest[field] <= FRONTIER[field],
      `${field} is ${manifest[field]}, above the ORCH-1400 Phase-1 frontier ${FRONTIER[field]}. ` +
        `Caps only shrink. Raising one requires editing this test under a [TEST-MOD-APPROVED] ` +
        `token — the visible path SPEC_ORCH-1400 SC-2 mandates. No silent bump.`,
    );
  }
});

test("T-2 selfTestWiredFloor never regresses and EQUALS the wired count (SC-7 equality, unenforced by P7)", () => {
  const wired = count((g) => g.selfTest === "wired");
  assert.ok(
    manifest.selfTestWiredFloor >= FRONTIER.selfTestWiredFloorMin,
    `selfTestWiredFloor ${manifest.selfTestWiredFloor} fell below the Phase-1 frontier ` +
      `${FRONTIER.selfTestWiredFloorMin} — the in-PR rollback window the base-relative ratchet cannot see.`,
  );
  assert.equal(
    manifest.selfTestWiredFloor,
    wired,
    `selfTestWiredFloor (${manifest.selfTestWiredFloor}) !== count(selfTest:"wired") (${wired}). ` +
      `SC-7: the floor equals the wired count at every merge — wiring a self-test and bumping ` +
      `the floor happen in the SAME PR, never separately.`,
  );
});

test("T-3 dark-state counts respect their caps (writer-independent restatement of P10/P12/P8)", () => {
  const darks = {
    unenforcedCap: count((g) => g.enforcement === "unenforced"),
    fixtureCap: count((g) => g.enforcement === "fixture"),
    capableUnwiredCap: count((g) => g.selfTest === "capable-unwired"),
  };
  for (const [field, n] of Object.entries(darks)) {
    assert.ok(
      n <= manifest[field],
      `${n} gates exceed ${field} ${manifest[field]} — parity should have caught this; ` +
        `this suite is the independent witness (a broken/bypassed parity gate must not go dark silently).`,
    );
  }
});

test("T-4 externalGateDirs stays a real array (P11's input schema; D-8 population lands here)", () => {
  assert.ok(
    Array.isArray(manifest.externalGateDirs),
    `MANIFEST.json "externalGateDirs" must be an array — removing the field disarms P11 entirely.`,
  );
});
