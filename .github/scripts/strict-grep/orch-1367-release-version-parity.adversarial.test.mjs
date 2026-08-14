#!/usr/bin/env node
/**
 * ORCH-1367 [unified-release-version] — TESTER ADVERSARIAL regression test.
 * Companion to the gate `orch-1367-release-version-parity.mjs`.
 *
 * HOW THIS DIFFERS FROM THE IMPLEMENTOR'S PROOF (mandatory distinct angle):
 *   The implementor's embedded `--self-test` + fails-on-revert only exercised
 *   GROSS, well-formed divergence on a MINIMAL `{ expo: { version } }` object:
 *   matching pass, 1.1.1-vs-1.1.0 fail, 1.1.2-vs-1.1.1 fail, missing version,
 *   blank version, invalid JSON. It never probed (a) realistic full-structure
 *   app.json with DECOY version-like sibling fields, (b) near-equal / invisible
 *   divergence, (c) a wrong-TYPE (numeric) version that JS loose-equality could
 *   silently treat as equal, or (d) the app.config.js dynamic-config override
 *   blind spot that the gate — reading only app.json — cannot see.
 *
 *   This test drives the ACTUAL gate binary (byte-copied into an isolated
 *   sandbox root so it reads controlled fixtures via its real file-read path),
 *   and statically guards the invariant's unenforced app.config.js assumption
 *   against the REAL repo files.
 *
 * Exit 0 = gate is robust against every adversarial case. Exit 1 = a gate hole.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..", "..", "..");
const REAL_GATE = path.join(
  repoRoot,
  ".github/scripts/strict-grep/orch-1367-release-version-parity.mjs",
);

const failures = [];

// --- Isolated sandbox: byte-copy the REAL gate so it reads OUR fixtures. -----
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "orch1367-adv-"));
const gateDir = path.join(sandbox, ".github/scripts/strict-grep");
fs.mkdirSync(gateDir, { recursive: true });
fs.mkdirSync(path.join(sandbox, "app-mobile"), { recursive: true });
fs.mkdirSync(path.join(sandbox, "mingla-business"), { recursive: true });
const sandboxGate = path.join(gateDir, "gate.mjs");
fs.copyFileSync(REAL_GATE, sandboxGate);

/** Run the byte-copied real gate against two written fixtures; return exit code. */
function runGate(consumerJson, businessJson) {
  fs.writeFileSync(path.join(sandbox, "app-mobile/app.json"), consumerJson);
  fs.writeFileSync(path.join(sandbox, "mingla-business/app.json"), businessJson);
  const r = spawnSync(process.execPath, [sandboxGate], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

/** Realistic full-structure app.json with version nested under expo. */
function realisticApp(expoVersion, { decoyTopLevelVersion } = {}) {
  const obj = {
    ...(decoyTopLevelVersion !== undefined
      ? { version: decoyTopLevelVersion }
      : {}),
    expo: {
      name: "Mingla",
      slug: "mingla",
      version: expoVersion,
      orientation: "portrait",
      runtimeVersion: { policy: "appVersion" },
      ios: { buildNumber: "40", bundleIdentifier: "com.mingla.app" },
      android: { versionCode: 40, package: "com.mingla.app" },
      extra: { eas: { projectId: "abc-123" } },
    },
  };
  return JSON.stringify(obj, null, 2);
}

function expect(label, cond, detail) {
  if (!cond) failures.push(`${label}: ${detail}`);
  else console.log(`  ok  ${label}`);
}

console.log("ORCH-1367 tester adversarial suite:");

// CASE A — DECOY sibling `version` fields (angle: correct-field isolation).
// Both apps' expo.version match (1.1.2) but each carries a DIFFERENT top-level
// decoy `version`. A gate that read the wrong `version` key would wrongly FAIL.
{
  const { code } = runGate(
    realisticApp("1.1.2", { decoyTopLevelVersion: "9.9.9" }),
    realisticApp("1.1.2", { decoyTopLevelVersion: "0.0.1" }),
  );
  expect(
    "A decoy-top-level-version-ignored",
    code === 0,
    `expected exit 0 (gate must read expo.version, ignore decoy top-level version); got ${code}`,
  );
}

// CASE B — near-equal divergence via TRAILING WHITESPACE (angle: byte-equality).
// "1.1.2" vs "1.1.2 " look identical but are not byte-equal — a real
// copy-paste hazard the implementor never tested.
{
  const { code } = runGate(realisticApp("1.1.2"), realisticApp("1.1.2 "));
  expect(
    "B trailing-whitespace-divergence-caught",
    code === 1,
    `expected exit 1 (byte-unequal versions must fail); got ${code}`,
  );
}

// CASE C — numeric-vs-string TYPE mismatch that loose-equality would pass
// (angle: type-coercion trap). "112" (string) vs 112 (number) — JS `==` says
// equal; the gate's typeof-string guard must reject the numeric side → FAIL.
{
  const consumer = JSON.stringify({ expo: { name: "Mingla", version: "112" } });
  const business = JSON.stringify({ expo: { name: "MinglaB", version: 112 } });
  const { code } = runGate(consumer, business);
  expect(
    "C numeric-vs-string-type-mismatch-caught",
    code === 1,
    `expected exit 1 (numeric version must fail the string guard); got ${code}`,
  );
}

// CASE D — BOTH versions numeric AND equal (angle: wrong-type never "passes").
// 112 == 112 but neither is a string; the gate must still FAIL — a version must
// be a non-empty string, not a number that happens to match.
{
  const consumer = JSON.stringify({ expo: { version: 112 } });
  const business = JSON.stringify({ expo: { version: 112 } });
  const { code } = runGate(consumer, business);
  expect(
    "D both-numeric-equal-still-fails",
    code === 1,
    `expected exit 1 (numeric version type is invalid even when equal); got ${code}`,
  );
}

// CASE E — app.config.js DYNAMIC-CONFIG BLIND SPOT (angle: unenforced
// invariant assumption). The gate reads ONLY app.json; the invariant claims
// neither app.config.js overrides `version`. If that assumption ever breaks,
// the gate goes blind. Guard it statically against the REAL repo files.
{
  const configFiles = [
    path.join(repoRoot, "app-mobile/app.config.js"),
    path.join(repoRoot, "mingla-business/app.config.js"),
  ];
  // Match an assignment/property of `version` (NOT runtimeVersion / appVersion).
  const overrideRe =
    /(^|[^a-zA-Z])version\s*[:=]/m;
  for (const cf of configFiles) {
    if (!fs.existsSync(cf)) {
      console.log(`  --  E skipped (no ${path.basename(path.dirname(cf))}/app.config.js)`);
      continue;
    }
    const src = fs.readFileSync(cf, "utf8");
    // Strip runtimeVersion tokens so they don't false-positive the `version` regex.
    const scrubbed = src.replace(/runtimeVersion/g, "RUNTIME_VER");
    const hit = overrideRe.test(scrubbed);
    expect(
      `E app.config.js-no-version-override (${path.basename(path.dirname(cf))})`,
      !hit,
      `app.config.js appears to set a \`version\` key — the app.json-only gate would be BLIND to it. Invariant assumption broken.`,
    );
  }
}

// Cleanup sandbox.
fs.rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  console.error("\nORCH-1367 tester adversarial FAIL:");
  failures.forEach((m) => console.error("  - " + m));
  process.exit(1);
}
console.log("\nORCH-1367 tester adversarial PASS — gate robust across all adversarial cases.");
process.exit(0);
