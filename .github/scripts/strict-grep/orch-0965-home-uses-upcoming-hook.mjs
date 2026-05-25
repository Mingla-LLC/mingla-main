#!/usr/bin/env node
/**
 * ORCH-0965 [Home dashboard intelligent KPIs + tri-kind upcoming] —
 * strict-grep gate.
 *
 * Enforces three rules on the brand-owner home dashboard:
 *
 *   1. `mingla-business/app/(tabs)/home.tsx` MUST NOT directly import
 *      `fetchBusinessEventsForBrand`, `useBusinessEventsForBrand`, or
 *      `buildBrandEventSummary`. The new composite hook
 *      `useUpcomingForBrand` is the single owner of home's data
 *      composition. Direct re-imports of the trip-blind event source
 *      would re-introduce the F-1 / F-3 trip-blindness this ORCH fixed.
 *
 *   2. `home.tsx` MUST contain at least one occurrence of
 *      `useUpcomingForBrand`.
 *
 *   3. The literal CTA strings "Plan a trip" and "Finish setting up
 *      Stripe" MUST NOT appear in `home.tsx` directly — they live in
 *      `HomeNextActionCard.tsx` / `homeNextAction.ts` only. This enforces
 *      the ORCH-0855 trip-planner-CTA absorption: rendering both the
 *      legacy block AND the new ladder card would double-CTA the
 *      dashboard.
 *
 * Established by SPEC §4.7 (ORCH-0965).
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 */

import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

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

const FORBIDDEN_IMPORTS = [
  "fetchBusinessEventsForBrand",
  "useBusinessEventsForBrand",
  "buildBrandEventSummary",
];

const FORBIDDEN_CTA_LITERALS = ["Plan a trip", "Finish setting up Stripe"];

const REQUIRED_TOKEN = "useUpcomingForBrand";

if (!existsSync(HOME_PATH)) {
  console.error(
    `[ORCH-0965] FAIL — expected file not found: ${relative(REPO_ROOT, HOME_PATH)}`,
  );
  process.exit(1);
}

const source = readFileSync(HOME_PATH, "utf8");
const lines = source.split("\n");
let violations = 0;

// Rule 1 — forbidden imports anywhere in the file (not just import block).
for (const token of FORBIDDEN_IMPORTS) {
  const re = new RegExp(`\\b${token}\\b`);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Skip comment lines.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    if (!re.test(line)) continue;
    violations += 1;
    console.error(
      `[ORCH-0965] ${relative(REPO_ROOT, HOME_PATH)}:${i + 1}: forbidden token \`${token}\` in home.tsx.`,
    );
    console.error(
      `  home.tsx MUST consume tri-kind upcoming data via \`useUpcomingForBrand\`, not via the trip-blind events source directly.`,
    );
  }
}

// Rule 2 — required token.
if (!new RegExp(`\\b${REQUIRED_TOKEN}\\b`).test(source)) {
  violations += 1;
  console.error(
    `[ORCH-0965] ${relative(REPO_ROOT, HOME_PATH)}: missing required hook \`${REQUIRED_TOKEN}\`.`,
  );
  console.error(
    `  home.tsx MUST call \`useUpcomingForBrand\` to populate the Upcoming list + KPI counts.`,
  );
}

// Rule 3 — forbidden CTA literals.
for (const literal of FORBIDDEN_CTA_LITERALS) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    if (!line.includes(literal)) continue;
    violations += 1;
    console.error(
      `[ORCH-0965] ${relative(REPO_ROOT, HOME_PATH)}:${i + 1}: forbidden CTA literal \`${literal}\` in home.tsx.`,
    );
    console.error(
      `  This CTA must live in HomeNextActionCard.tsx / homeNextAction.ts (the rule-ladder factory), not in home.tsx directly.`,
    );
  }
}

if (violations === 0) {
  console.log(
    `[ORCH-0965] OK — home.tsx uses useUpcomingForBrand; no forbidden imports or CTA literals.`,
  );
  process.exit(0);
}

console.error(
  `[ORCH-0965] FAIL — ${violations} violation(s) in home.tsx.`,
);
console.error(
  `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-HOME-UPCOMING-TRI-KIND-SOONEST-FIRST (DRAFT).`,
);
process.exit(1);
