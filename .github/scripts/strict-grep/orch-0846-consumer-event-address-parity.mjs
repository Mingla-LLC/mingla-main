#!/usr/bin/env node

/**
 * ORCH-0846 [Consumer event sheet venue/address parity] strict-grep gate.
 *
 * Locks in the contract that the consumer-side payload builder
 * (`supabase/functions/discover-merged-events/index.ts`) and the consumer
 * mapping (`app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`)
 * resolve `venueName`, `address`, and `format` identically to the brand-
 * side `mingla-business/src/services/publicEventsService.ts`. Restores the
 * META-ORCH-0827 [Platform structure consolidation] Pass 2 Step 10 parity
 * contract that was broken pre-0846 by `venueName: null` and
 * `format: "in-person"` hardcodes.
 *
 * Detection rules:
 *   1. The literal `venueName: null` must NOT appear on a non-comment line
 *      in the discover edge function. (Was line 422 pre-fix.)
 *   2. The literal `format: "in-person"` must NOT appear on a non-comment
 *      line in ExpandedBusinessEventSheet.tsx. (Was line 81 pre-fix.)
 *   3. `extractVenueName` must be referenced in the discover edge function
 *      (proves the fallback helper is wired up).
 *   4. `deriveSharedFormat` must be referenced in the discover edge function
 *      (proves the format-derivation helper is wired up).
 *   5. The `BusinessEventCard` type in `app-mobile/src/types/mergedDiscover.ts`
 *      must declare a `format:` discriminated union of the three shared-
 *      component literals.
 *
 * Self-test note: this script's filename and comments may freely mention
 * the forbidden tokens — the scan targets the listed product files only.
 *
 * Exit codes:
 *   0 — all 5 rules pass (gate green)
 *   1 — any rule fails (gate red)
 *   2 — file system error reading a target file
 *
 * Modeled on `i-discover-excludes-ended-master-date.mjs`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const DISCOVER_FN = "supabase/functions/discover-merged-events/index.ts";
const SHEET = "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx";
const CARD_TYPE = "app-mobile/src/types/mergedDiscover.ts";

const readSource = (relPath) => {
  try {
    return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
  } catch (err) {
    console.error(
      `[orch-0846-consumer-event-address-parity] FAIL — could not read ${relPath}: ${err.message}`,
    );
    process.exit(2);
  }
};

const discoverSrc = readSource(DISCOVER_FN);
const sheetSrc = readSource(SHEET);
const cardTypeSrc = readSource(CARD_TYPE);

const isCommentLine = (line) => {
  const stripped = line.trimStart();
  return stripped.startsWith("//") || stripped.startsWith("*");
};

const forbidOnNonCommentLine = (source, needle) => {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (line.includes(needle)) return { lineNumber: i + 1, text: line.trim() };
  }
  return null;
};

const requireSubstring = (source, needle) => source.includes(needle);

const results = [];
const record = (rule, pass, detail) => {
  results.push({ rule, pass, detail });
};

// Rule 1 — venueName: null forbidden in discover edge function
{
  const hit = forbidOnNonCommentLine(discoverSrc, "venueName: null");
  record(
    "R-1 venueName: null forbidden in discover-merged-events/index.ts",
    hit === null,
    hit === null
      ? `${DISCOVER_FN}: no offending line`
      : `${DISCOVER_FN}:${hit.lineNumber} contains forbidden literal — ${hit.text}`,
  );
}

// Rule 2 — format: "in-person" forbidden in ExpandedBusinessEventSheet.tsx
// (Single or double quotes; either flavor would be a regression.)
{
  const hitDouble = forbidOnNonCommentLine(sheetSrc, 'format: "in-person"');
  const hitSingle = forbidOnNonCommentLine(sheetSrc, "format: 'in-person'");
  const hit = hitDouble ?? hitSingle;
  record(
    'R-2 format: "in-person" hardcode forbidden in ExpandedBusinessEventSheet.tsx',
    hit === null,
    hit === null
      ? `${SHEET}: no offending line`
      : `${SHEET}:${hit.lineNumber} contains forbidden literal — ${hit.text}`,
  );
}

// Rule 3 — extractVenueName referenced in discover edge function
{
  const ok = requireSubstring(discoverSrc, "extractVenueName");
  record(
    "R-3 extractVenueName referenced in discover-merged-events/index.ts",
    ok,
    ok
      ? `${DISCOVER_FN}: extractVenueName found`
      : `${DISCOVER_FN}: extractVenueName helper not wired up — venueName fallback chain is missing`,
  );
}

// Rule 4 — deriveSharedFormat referenced in discover edge function
{
  const ok = requireSubstring(discoverSrc, "deriveSharedFormat");
  record(
    "R-4 deriveSharedFormat referenced in discover-merged-events/index.ts",
    ok,
    ok
      ? `${DISCOVER_FN}: deriveSharedFormat found`
      : `${DISCOVER_FN}: deriveSharedFormat helper not wired up — format derivation is missing`,
  );
}

// Rule 5 — BusinessEventCard type carries format discriminated union
{
  const re = /format:\s*["']in-person["']\s*\|\s*["']online["']\s*\|\s*["']hybrid["']/;
  const ok = re.test(cardTypeSrc);
  record(
    "R-5 BusinessEventCard type carries format discriminated union",
    ok,
    ok
      ? `${CARD_TYPE}: format field declared as "in-person" | "online" | "hybrid"`
      : `${CARD_TYPE}: format field missing or shape-changed — consumer mapping would lose type safety`,
  );
}

// ── Report ──────────────────────────────────────────────────────────────

let failed = 0;
console.log("\nORCH-0846 strict-grep gate — consumer event address parity\n");
for (const r of results) {
  const tag = r.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${r.rule}`);
  console.log(`         ${r.detail}`);
  if (!r.pass) failed += 1;
}
console.log(
  `\nSummary: ${results.length - failed}/${results.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);

if (failed > 0) {
  console.error(
    "This means the ORCH-0846 venue/address parity contract is broken. See `Mingla_Artifacts/specs/SPEC_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY.md` for the required code shape.",
  );
  process.exit(1);
}
process.exit(0);
