#!/usr/bin/env node
/**
 * ORCH-1367 [unified-release-version] —
 * I-RELEASE-VERSION-PARITY.
 *
 * WHY: the two Mingla mobile apps ship on the same release cadence and are
 * cut as a matched native store build (currently 1.1.2). If their marketing
 * versions ever diverge again (the drift this ORCH fixes: consumer 1.1.1 vs
 * business 1.1.0), the store listings, support triage, crash grouping and —
 * because BOTH apps use `runtimeVersion: { policy: "appVersion" }` — the OTA
 * update runtime all fall out of lockstep silently. This gate fails the build
 * the moment `expo.version` in `app-mobile/app.json` and
 * `mingla-business/app.json` disagree.
 *
 * ASSERTS:
 *  A. app-mobile/app.json has a non-empty string `expo.version`.
 *  B. mingla-business/app.json has a non-empty string `expo.version`.
 *  C. The two `expo.version` values are byte-equal.
 *
 * A revert that sets either app's `expo.version` to a different value — or that
 * drops/blanks either `expo.version` — must FAIL CI.
 *
 * `--self-test` proves PASS-on-parity + FAIL-on-divergence for each assertion.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the repo root from THIS script's location
// (.github/scripts/strict-grep/ → up three levels), so the gate runs
// identically from CI (repo-root cwd) and from any nested cwd.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");

const CONSUMER_APP_JSON = path.join(root, "app-mobile/app.json");
const BUSINESS_APP_JSON = path.join(root, "mingla-business/app.json");

/**
 * Extract a non-empty string `expo.version` from an app.json source string.
 * Pushes a human-readable failure to `failures` and returns null when the
 * version cannot be read.
 */
function readExpoVersion(label, appJsonSrc, failures) {
  let parsed;
  try {
    parsed = JSON.parse(appJsonSrc);
  } catch (e) {
    failures.push(`${label} is not valid JSON: ${e.message}`);
    return null;
  }
  const version = parsed?.expo?.version;
  if (typeof version !== "string" || version.trim() === "") {
    failures.push(
      `${label} must declare a non-empty string expo.version (found: ` +
        `${JSON.stringify(version)}).`,
    );
    return null;
  }
  return version;
}

/**
 * Core check: given the two app.json source strings, populate `failures` if
 * either version is unreadable or the two versions diverge.
 */
function checkVersionParity(consumerSrc, businessSrc, failures) {
  const consumerVersion = readExpoVersion(
    "app-mobile/app.json",
    consumerSrc,
    failures,
  );
  const businessVersion = readExpoVersion(
    "mingla-business/app.json",
    businessSrc,
    failures,
  );

  // Only compare when both sides produced a version.
  if (consumerVersion !== null && businessVersion !== null) {
    if (consumerVersion !== businessVersion) {
      failures.push(
        `expo.version diverges across the two apps — they MUST match on ` +
          `main: app-mobile/app.json = "${consumerVersion}", ` +
          `mingla-business/app.json = "${businessVersion}". Unify both to the ` +
          `same release version before merging.`,
      );
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];

  const appJson = (version) => JSON.stringify({ expo: { version } });

  // Good fixture: identical versions → must pass clean.
  let f = [];
  checkVersionParity(appJson("1.1.2"), appJson("1.1.2"), f);
  if (f.length) self.push("matching versions wrongly flagged: " + f.join("; "));

  // Divergence: the exact drift this ORCH fixes (1.1.1 vs 1.1.0) → must fire.
  f = [];
  checkVersionParity(appJson("1.1.1"), appJson("1.1.0"), f);
  if (f.length === 0) self.push("divergent versions (1.1.1 vs 1.1.0) not flagged");

  // Divergence, other direction (patch bump on one side only) → must fire.
  f = [];
  checkVersionParity(appJson("1.1.2"), appJson("1.1.1"), f);
  if (f.length === 0) self.push("divergent versions (1.1.2 vs 1.1.1) not flagged");

  // Missing consumer version → must fire.
  f = [];
  checkVersionParity(JSON.stringify({ expo: {} }), appJson("1.1.2"), f);
  if (f.length === 0) self.push("missing consumer expo.version not flagged");

  // Blank business version → must fire.
  f = [];
  checkVersionParity(appJson("1.1.2"), appJson("   "), f);
  if (f.length === 0) self.push("blank business expo.version not flagged");

  // Invalid JSON on one side → must fire.
  f = [];
  checkVersionParity(appJson("1.1.2"), "{ not json", f);
  if (f.length === 0) self.push("invalid business app.json not flagged");

  if (self.length) {
    console.error("ORCH-1367 release-version-parity self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1367 release-version-parity self-test PASS (6/6 cases).",
  );
  process.exit(0);
}

const failures = [];
for (const [label, file] of [
  ["app-mobile/app.json", CONSUMER_APP_JSON],
  ["mingla-business/app.json", BUSINESS_APP_JSON],
]) {
  if (!fs.existsSync(file)) {
    console.error(
      `ORCH-1367 I-RELEASE-VERSION-PARITY script error: ${label} not found ` +
        `at ${file}.`,
    );
    process.exit(2);
  }
}

checkVersionParity(
  fs.readFileSync(CONSUMER_APP_JSON, "utf8"),
  fs.readFileSync(BUSINESS_APP_JSON, "utf8"),
  failures,
);

if (failures.length > 0) {
  console.error(
    "ORCH-1367 I-RELEASE-VERSION-PARITY FAIL:\n  " + failures.join("\n  ") +
      "\n\nSee Mingla_Artifacts/INVARIANT_REGISTRY.md I-RELEASE-VERSION-PARITY.",
  );
  process.exit(1);
}

const parsed = JSON.parse(fs.readFileSync(CONSUMER_APP_JSON, "utf8"));
console.log(
  "ORCH-1367 I-RELEASE-VERSION-PARITY PASS — app-mobile/app.json and " +
    `mingla-business/app.json both carry expo.version "${parsed.expo.version}".`,
);
