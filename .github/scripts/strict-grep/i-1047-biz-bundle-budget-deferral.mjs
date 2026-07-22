#!/usr/bin/env node
/**
 * I-1047-BIZ-BUNDLE-BUDGET-DEFERRAL  (issue #1047 [business-jest-suite-audit])
 *
 * Re-homes the load-bearing bundle-budget invariant that was previously pinned by
 * the jest source-text test `mingla-business/__tests__/metaOrch1255R2.bundleBudgetDeferral.happy.test.ts`
 * (META-ORCH-1255 R2). That jest pin rotted on refactor and is now quarantined
 * (jest.config.cjs testPathIgnorePatterns); this ADDITIVE strict-grep gate keeps
 * the actual rule enforced by CI.
 *
 * THE RULE: the eager web `__common` chunk is capped (ORCH-1083, 2,250,000 bytes).
 * Two import-topology facts keep route-scoped code OUT of the boot path:
 *   (1) PublicVenuePage must import PublicMenuSections from the DEEP specifier
 *       "@mingla/brand-rendering/PublicMenuSections", and any bare
 *       "@mingla/brand-rendering" barrel import must be `import type` (a VALUE
 *       barrel import re-hoists the ~27 KB PublicBrandPage module into __common).
 *   (2) CreatorStep5Tickets must load TicketTierEditSheet via React.lazy dynamic
 *       import (an on-demand chunk), never a static import.
 * Reverting either fails HERE (in seconds) instead of in the 10-minute export gate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const violations = [];

// (1) PublicVenuePage — deep specifier + type-only barrel.
const venue = stripComments(read("mingla-business/src/components/venue/PublicVenuePage.tsx"));
if (!venue.includes('from "@mingla/brand-rendering/PublicMenuSections"')) {
  violations.push(
    'PublicVenuePage.tsx no longer imports PublicMenuSections from the DEEP specifier ' +
      '"@mingla/brand-rendering/PublicMenuSections" — a barrel import re-hoists PublicBrandPage into __common.',
  );
}
for (const imp of venue.match(/import\s+(?:type\s+)?\{[^}]*\}\s+from\s+"@mingla\/brand-rendering"/g) ?? []) {
  if (!/^import\s+type\s/.test(imp)) {
    violations.push(
      `PublicVenuePage.tsx has a VALUE barrel import \`${imp.replace(/\s+/g, " ").slice(0, 70)}…\` — ` +
        "every bare @mingla/brand-rendering import must be `import type` (erased) to stay under budget.",
    );
  }
}

// (2) CreatorStep5Tickets — TicketTierEditSheet is a lazy on-demand chunk.
const step5 = stripComments(read("mingla-business/src/components/event/CreatorStep5Tickets.tsx"));
if (!/React\.lazy\(\s*\(\)\s*=>\s*import\("\.\/TicketTierEditSheet"\)/.test(step5)) {
  violations.push(
    "CreatorStep5Tickets.tsx no longer loads TicketTierEditSheet via React.lazy(() => import(...)) — " +
      "it must stay a lazy on-demand chunk, not a static boot-path import.",
  );
}
if (/import\s+\{\s*TicketTierEditSheet\s*\}\s+from/.test(step5)) {
  violations.push("CreatorStep5Tickets.tsx has a STATIC import of TicketTierEditSheet — it must be React.lazy only.");
}

if (violations.length) {
  console.error("\nFAIL [I-1047-BIZ-BUNDLE-BUDGET-DEFERRAL]:");
  for (const v of violations) console.error(`  x ${v}`);
  console.error("");
  process.exit(1);
}
console.log("OK [I-1047-BIZ-BUNDLE-BUDGET-DEFERRAL]: barrel imports type-only + TicketTierEditSheet lazy.");
