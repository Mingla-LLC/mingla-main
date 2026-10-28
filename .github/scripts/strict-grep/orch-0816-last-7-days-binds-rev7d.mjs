#!/usr/bin/env node
/**
 * ORCH-0816 strict-grep gate — Home revenue copy stays bound to its named window.
 *
 * Background: prior to ORCH-0816 the home-screen tile labelled "Last 7 days"
 * was bound to `currentBrand.stats.rev`, which is the brand's LIFETIME GMV.
 * The label and the data disagreed for the entire life of the home screen.
 * This gate prevented the binding from silently regressing to the lifetime
 * field while the Home surface promised a weekly window. #4037 deliberately
 * replaces that row with "Total lifetime revenue", so the invariant now pins
 * the approved lifetime label to the new lifetime read-model field.
 *
 * Three checks (all must pass; any failure exits non-zero):
 *
 *   1. BusinessPulsePanel renders the approved lifetime revenue label.
 *   2. The displayed value binds to the payout read model's currency-keyed
 *      `lifetimeSalesCents` field.
 *   3. The binding does not fall back to the legacy `stats.rev` field.
 *
 * Codified by ORCH-0816 SPEC §9.3.
 * [TEST-MOD-APPROVED #3645] The payout redesign replaces the old KPI tile.
 * [TEST-MOD-APPROVED #4037] Home Pulse replaces the weekly row with approved
 * lifetime revenue copy backed by the payout-screen lifetime map.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const HOME_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "(tabs)",
  "home.tsx",
);
const PULSE_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "home",
  "BusinessPulsePanel.tsx",
);

const failures = [];

const readOrEmpty = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

if (!existsSync(HOME_PATH) || !existsSync(PULSE_PATH)) {
  failures.push(
    "Check 1 FAIL: Home or BusinessPulsePanel source is missing",
  );
} else {
  const home = readOrEmpty(HOME_PATH);
  const pulse = readOrEmpty(PULSE_PATH);

  if (!home.includes("<BusinessPulsePanel")) {
    failures.push(
      "Check 1 FAIL: Home does not render BusinessPulsePanel",
    );
  }
  if (!pulse.includes("Total lifetime revenue")) {
    failures.push(
      'Check 1 FAIL: BusinessPulsePanel does not render "Total lifetime revenue"',
    );
  }
  const lifetimeMatch = /const lifetime\s*=\s*[\s\S]*?;/m.exec(pulse);
  if (lifetimeMatch === null || !lifetimeMatch[0].includes("payoutData?.lifetimeSalesCents[currency]")) {
    failures.push(
      "Check 2 FAIL: Pulse lifetime revenue does not reference payoutData?.lifetimeSalesCents[currency]",
    );
  }
  if (lifetimeMatch !== null && /stats\.rev(?![a-zA-Z0-9_])/.test(lifetimeMatch[0])) {
    failures.push(
      "Check 3 FAIL: Pulse lifetime revenue references legacy stats.rev",
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-0816 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0816 strict-grep PASS — Home lifetime revenue binds payout lifetimeSalesCents.");
