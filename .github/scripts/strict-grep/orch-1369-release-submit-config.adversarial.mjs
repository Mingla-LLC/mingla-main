#!/usr/bin/env node
/**
 * ORCH-1369 [release-1.1.2-config] — TESTER ADVERSARIAL characterization test
 * (mingla-tester, TEST phase; append-only). WIRED into CI as batch:A by
 * ORCH-1400 Phase 1 (it is the base gate's self-test-in-exile — it shipped
 * dark in its own SHIP commit e489715ab and stayed dark until ORCH-1400).
 *
 * ANGLE — DELIBERATELY DIFFERENT from the implementor's fails-on-revert. The
 * implementor proved: android `completed`->`draft` fires (both apps), and a
 * deleted business-iOS ASC key field fires. This harness attacks two other
 * dimensions of the SAME `eas.json` `submit.production` blocks:
 *
 *   PART 1 — GATE-STRICTNESS REGRESSION GUARDS (must pass now; fail if the gate
 *   is ever weakened from exact-equality to a mere `!== "draft"` check, or if
 *   the ASC-field type check is loosened):
 *     A near-miss typo  releaseStatus "complete"   -> gate MUST fire
 *     B case variant    releaseStatus "Completed"  -> gate MUST fire
 *     C whitespace      releaseStatus " completed "-> gate MUST fire
 *     F wrong type      ascApiKeyPath = <number>   -> gate MUST fire
 *     G missing block   submit.production deleted   -> gate MUST fire
 *
 *   PART 2 — COVERAGE-GAP PROBES (the finding). The gate guards the publish
 *   STATUS but NOT the rollout `track`, and guards ASC keys ONLY on business
 *   iOS. A release-submit-config safety gate arguably must also refuse:
 *     D  android.track flipped "internal"->"production" (silent PUBLIC rollout,
 *        strictly worse than the `draft` regression the gate DOES guard)
 *     E  consumer-iOS ASC keys stripped (same interactive-auth-stall failure
 *        class the gate guards on business iOS, unguarded on consumer)
 *   These probe the DESIRED behavior. If the real gate passes them (exit 0),
 *   the gap is real and this harness reports HOLE.
 *
 * EXIT CODES (ORCH-1400 Phase 1 recorded-gap mapping — SPEC_ORCH-1400 §4.1.c,
 * OQ-1 default; supersedes the original 0/1/2/3 contract so the harness can run
 * PR-blocking on Part 1 without blocking on the recorded Part 2 scope boundary):
 *   0  Part 1 guards hold. Any open Part 2 gap is PRINTED as a recorded scope
 *      boundary — the same list lives verbatim in INVARIANT_REGISTRY.md under
 *      I-RELEASE-SUBMIT-CONFIG ("governs the publish STATUS only, not the
 *      rollout track"). Widening the base gate (OQ-1) closes the gaps and
 *      empties the printed list; that decision belongs to Seth, not this file.
 *   1  a Part 1 gate-strictness guard REGRESSED (gate got weaker) — hard fail
 *   3  harness/setup error
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..", "..");
const GATE = path.join(__dirname, "orch-1369-release-submit-config.mjs");
const CONSUMER_EAS = path.join(root, "app-mobile/eas.json");
const BUSINESS_EAS = path.join(root, "mingla-business/eas.json");

if (!fs.existsSync(GATE) || !fs.existsSync(CONSUMER_EAS) || !fs.existsSync(BUSINESS_EAS)) {
  console.error("adversarial harness setup error: gate or an eas.json is missing.");
  process.exit(3);
}

const REAL_CONSUMER = JSON.parse(fs.readFileSync(CONSUMER_EAS, "utf8"));
const REAL_BUSINESS = JSON.parse(fs.readFileSync(BUSINESS_EAS, "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * Drive the REAL gate (copied verbatim into a temp mirror so it resolves the
 * two eas.json files from OUR fixtures) and return its exit code.
 */
function runGate(consumerObj, businessObj) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch1369-adv-"));
  try {
    fs.mkdirSync(path.join(tmp, "app-mobile"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "mingla-business"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".github/scripts/strict-grep"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "app-mobile/eas.json"), JSON.stringify(consumerObj, null, 2));
    fs.writeFileSync(path.join(tmp, "mingla-business/eas.json"), JSON.stringify(businessObj, null, 2));
    fs.copyFileSync(GATE, path.join(tmp, ".github/scripts/strict-grep/gate.mjs"));
    try {
      execFileSync("node", [path.join(tmp, ".github/scripts/strict-grep/gate.mjs")], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      return 0;
    } catch (e) {
      return typeof e.status === "number" ? e.status : 3;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const withBiz = (mut) => { const b = clone(REAL_BUSINESS); mut(b); return runGate(REAL_CONSUMER, b); };
const withConsumer = (mut) => { const c = clone(REAL_CONSUMER); mut(c); return runGate(c, REAL_BUSINESS); };

// Sanity: the real, unmutated files must pass.
if (runGate(REAL_CONSUMER, REAL_BUSINESS) !== 0) {
  console.error("SANITY FAIL: real eas.json pair does not pass the gate.");
  process.exit(3);
}

// ── PART 1 — gate-strictness regression guards (expect the gate to FIRE = exit 1)
const part1 = [
  ["A near-miss typo 'complete'", withBiz((b) => (b.submit.production.android.releaseStatus = "complete"))],
  ["B case variant 'Completed'", withBiz((b) => (b.submit.production.android.releaseStatus = "Completed"))],
  ["C whitespace ' completed '", withBiz((b) => (b.submit.production.android.releaseStatus = " completed "))],
  ["F ascApiKeyPath wrong type (number)", withBiz((b) => (b.submit.production.ios.ascApiKeyPath = 12345))],
  ["G submit.production deleted", withBiz((b) => delete b.submit.production)],
];
let part1Failed = 0;
console.log("PART 1 — gate-strictness regression guards (gate must FIRE, exit 1):");
for (const [label, code] of part1) {
  const ok = code === 1;
  if (!ok) part1Failed++;
  console.log(`  ${ok ? "PASS" : "REGRESSED"}  ${label} -> gate exit ${code}`);
}

// ── PART 2 — coverage-gap probes (release-safety WANTS exit 1; exit 0 = HOLE)
const part2 = [
  ["D  business android.track 'internal'->'production' (silent public rollout)", withBiz((b) => (b.submit.production.android.track = "production"))],
  ["D2 consumer android.track 'internal'->'production' (silent public rollout)", withConsumer((c) => (c.submit.production.android.track = "production"))],
  ["E  consumer-iOS ASC keys stripped to bare ascAppId (interactive-auth stall)", withConsumer((c) => (c.submit.production.ios = { ascAppId: c.submit.production.ios.ascAppId }))],
];
let holes = 0;
console.log("\nPART 2 — coverage-gap probes (release-safety wants exit 1; exit 0 = HOLE):");
for (const [label, code] of part2) {
  const hole = code === 0;
  if (hole) holes++;
  console.log(`  ${hole ? "HOLE" : "guarded"}  ${label} -> gate exit ${code}`);
}

console.log("");
if (part1Failed > 0) {
  console.error(`RESULT: ${part1Failed} gate-strictness guard(s) REGRESSED — the gate got weaker.`);
  process.exit(1);
}
if (holes > 0) {
  // ORCH-1400 Phase 1 recorded-gap mapping (OQ-1 default): the gap list is a
  // RECORDED scope boundary, not a CI failure — it prints on every run and is
  // mirrored verbatim in INVARIANT_REGISTRY.md under I-RELEASE-SUBMIT-CONFIG.
  // Part 1 regressions above remain hard-blocking (exit 1). Do NOT restore a
  // non-zero exit here without widening the BASE gate first: while this harness
  // was dark, exit 2 made it unwireable and the gaps invisible for 4 days.
  console.log(
    `RESULT: gate-strictness guards hold; ${holes} release-safety coverage GAP(s) remain open ` +
      `(the gate does not assert track==="internal", nor guard consumer-iOS ASC keys). ` +
      `Recorded scope boundary (INVARIANT_REGISTRY I-RELEASE-SUBMIT-CONFIG: ` +
      `"governs the publish STATUS only, not the rollout track") — non-blocking by ` +
      `ORCH-1400 OQ-1 default. Widen the base gate to close these and empty this list.`,
  );
  process.exit(0);
}
console.log("RESULT: all Part 1 guards hold and all Part 2 gaps are closed.");
process.exit(0);
