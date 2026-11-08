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
 * THE RULE: the eager web `__common` chunk is budgeted. #1509 replaced ORCH-1083's
 * single hand-edited cap with a measured baseline (`mingla-business/scripts/ci/
 * bundle-baseline.json`), a per-PR delta allowance, and a Seth-only product
 * ceiling — so do NOT read a fixed byte figure out of this header, and do not
 * add one back. This gate's job is unchanged and independent of that number:
 * it pins the import TOPOLOGY that keeps route-scoped code out of the boot path,
 * in seconds, instead of waiting for the ten-minute export gate to notice.
 * Two import-topology facts keep route-scoped code OUT of the boot path:
 *   (1) The public venue ROUTE must import PublicVenueScreen from the DEEP
 *       specifier "@mingla/brand-rendering/PublicVenueScreen", and any bare
 *       "@mingla/brand-rendering" barrel import must be `import type` (a VALUE
 *       barrel import re-hoists the ~27 KB PublicBrandPage module — and the
 *       lucide shim's module-scope icon requires — into __common). The shared
 *       screen itself must reach PublicMenuSections by RELATIVE path and never
 *       through its own package barrel, for the same reason.
 *   (2) CreatorStep5Tickets must load TicketTierEditSheet via React.lazy dynamic
 *       import (an on-demand chunk), never a static import.
 *   (3) issue #1023 wave 2 — the Google Fonts catalogue (about 57 KB of JSON,
 *       1,626 families) is loaded ONLY by the Theme sheet's Font tab through a
 *       dynamic import(). No source file may import or require it statically:
 *       the catalogue must never reach the eager chunk
 *       (I-1023-ONLY-CHOSEN-FONT-DOWNLOADS).
 * Reverting either fails HERE (in seconds) instead of in the 10-minute export gate.
 *
 * #1559 — REPOINTED. Rule (1) used to pin
 * `mingla-business/src/components/venue/PublicVenuePage.tsx`, which moved to
 * `packages/brand-rendering/PublicVenueScreen.tsx`. `read()` throws on a
 * missing path, so this gate has always HARD-FAILED rather than skipping (the
 * failure mode #1550 R2 catalogued for the anon-safe gate) — the repoint keeps
 * it enforcing rather than exploding.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const violations = [];

// (1a) The venue ROUTE — deep specifier for the screen + type-only barrel.
const VENUE_ROUTE = "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx";
const venueRoute = stripComments(read(VENUE_ROUTE));
if (!venueRoute.includes('from "@mingla/brand-rendering/PublicVenueScreen"')) {
  violations.push(
    `${VENUE_ROUTE} no longer imports PublicVenueScreen from the DEEP specifier ` +
      '"@mingla/brand-rendering/PublicVenueScreen" — a barrel import re-hoists PublicBrandPage into __common.',
  );
}
for (const imp of venueRoute.match(/import\s+(?:type\s+)?\{[^}]*\}\s+from\s+"@mingla\/brand-rendering"/g) ?? []) {
  if (!/^import\s+type\s/.test(imp)) {
    violations.push(
      `${VENUE_ROUTE} has a VALUE barrel import \`${imp.replace(/\s+/g, " ").slice(0, 70)}…\` — ` +
        "every bare @mingla/brand-rendering import must be `import type` (erased) to stay under budget.",
    );
  }
}

// (1b) The shared screen — relative sibling import, never its own barrel.
const VENUE_SCREEN = "packages/brand-rendering/PublicVenueScreen.tsx";
const venueScreen = stripComments(read(VENUE_SCREEN));
if (!venueScreen.includes('from "./PublicMenuSections"')) {
  violations.push(
    `${VENUE_SCREEN} no longer imports PublicMenuSections from the RELATIVE sibling ` +
      '"./PublicMenuSections" — reaching it through "./index" would pull PublicBrandPage into the venue chunk.',
  );
}
if (/from\s+"\.\/index"/.test(venueScreen) || /from\s+"@mingla\/brand-rendering"/.test(venueScreen)) {
  violations.push(
    `${VENUE_SCREEN} imports its own package BARREL — that re-exports PublicBrandPage (~27 KB) plus the ` +
      "eager lucide shim) and would hoist it into __common alongside the venue page.",
  );
}
// The lazy Stay boundary lives in the ROUTE, never in the shared screen
// (#1550 R4): a React.lazy here would drag StayGuestBooking + @stripe/stripe-js
// back toward the boot path the moment the consumer app adopts this module.
if (/React\.lazy/.test(venueScreen) || /StayGuestExperience/.test(venueScreen)) {
  violations.push(
    `${VENUE_SCREEN} contains React.lazy or a *StayGuestExperience reference — the booking body is an ` +
      "injected slot precisely so the code-splitting stays where the bundle budget is measured.",
  );
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

// (3) issue #1023 — the font catalogue is a lazy chunk, never a static import.
const CATALOG = "googleFontsCatalog.json";
const FONT_TAB = "mingla-business/src/components/theme/ThemeFontTab.tsx";
const SOURCE_ROOTS = ["mingla-business/src", "mingla-business/app", "packages", "app-mobile/src"];
const walkSources = (rel) => {
  const abs = path.join(REPO, rel);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const child = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...walkSources(child));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) out.push(child);
  }
  return out;
};
const staticCatalogImport = new RegExp(
  `(^|\\n)\\s*import\\s[^;]*from\\s*["'][^"']*${CATALOG.replace(".", "\\.")}["']|require\\(\\s*["'][^"']*${CATALOG.replace(".", "\\.")}["']`,
);
for (const rel of SOURCE_ROOTS.flatMap(walkSources)) {
  const src = stripComments(read(rel));
  if (!src.includes(CATALOG)) continue;
  if (staticCatalogImport.test(src)) {
    violations.push(
      `${rel} imports ${CATALOG} statically — the font catalogue must only load through ` +
        "a dynamic import() in the Font tab, never in the eager chunk.",
    );
  }
}
const fontTab = stripComments(read(FONT_TAB));
if (!/import\(\s*"[^"]*fonts\/googleFontsCatalog\.json"\s*\)/.test(fontTab)) {
  violations.push(`${FONT_TAB} no longer loads the font catalogue through a dynamic import().`);
}

if (violations.length) {
  console.error("\nFAIL [I-1047-BIZ-BUNDLE-BUDGET-DEFERRAL]:");
  for (const v of violations) console.error(`  x ${v}`);
  console.error("");
  process.exit(1);
}
console.log(
  "OK [I-1047-BIZ-BUNDLE-BUDGET-DEFERRAL]: venue route deep-imports PublicVenueScreen, " +
    "the shared screen stays off its own barrel and carries no React.lazy, " +
    "TicketTierEditSheet is lazy, and the font catalogue loads only by dynamic import.",
);
