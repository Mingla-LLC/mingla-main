#!/usr/bin/env node
/**
 * ORCH-0816 strict-grep gate — the approved weekly-sales row stays windowed.
 *
 * Background: prior to ORCH-0816 the home-screen tile labelled "Last 7 days"
 * was bound to `currentBrand.stats.rev`, which is the brand's LIFETIME GMV.
 * The label and the data disagreed for the entire life of the home screen.
 * This gate prevents the binding from ever silently regressing to the
 * lifetime field again.
 *
 * Three checks (all must pass; any failure exits non-zero):
 *
 *   1. HomeMoneyCard renders the approved "Sales this week" row.
 *   2. `homeMoney.salesWeek` binds to the payout read model's
 *      `salesThisWeekCents` field.
 *   3. The binding does not fall back to a lifetime `stats.rev` field.
 *
 * Codified by ORCH-0816 SPEC §9.3.
 * [TEST-MOD-APPROVED #3645] The payout redesign replaces the old KPI tile.
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

const failures = [];

const readOrEmpty = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

if (!existsSync(HOME_PATH)) {
  failures.push(
    "Check 1 FAIL: mingla-business/app/(tabs)/home.tsx is missing",
  );
} else {
  const src = readOrEmpty(HOME_PATH);

  const cardMatch = /const HomeMoneyCard:[\s\S]*?const LazyBrandDeleteSheet/.exec(src);
  if (cardMatch === null || !cardMatch[0].includes("Sales this week (what buyers paid)")) {
    failures.push(
      'Check 1 FAIL: HomeMoneyCard does not render "Sales this week (what buyers paid)"',
    );
  }

  const homeMoneyMatch = /const homeMoney = \{[\s\S]*?\n  \};/.exec(src);
  if (homeMoneyMatch === null || !homeMoneyMatch[0].includes("payoutScreen.data?.salesThisWeekCents")) {
    failures.push(
      "Check 2 FAIL: homeMoney.salesWeek does not reference `payoutScreen.data?.salesThisWeekCents`",
    );
  }
  if (homeMoneyMatch !== null && /stats\.rev(?![a-zA-Z0-9_])/.test(homeMoneyMatch[0])) {
    failures.push(
      "Check 3 FAIL: homeMoney.salesWeek references `stats.rev` (lifetime field)",
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-0816 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0816 strict-grep PASS — weekly Home sales bind payout salesThisWeekCents.");
