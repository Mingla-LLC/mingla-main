#!/usr/bin/env node

/**
 * ORCH-0846 [Consumer event sheet venue/address parity] strict-grep gate.
 *
 * Locks in the contract that the consumer-side payload builder
 * (`supabase/functions/discover-merged-events/index.ts`) and the consumer
 * mapping (`app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`, the
 * post-EBES successor — see ORCH-1138 retarget note below) resolve `venueName`,
 * `address`, and `format` identically to the brand-side
 * `mingla-business/src/services/publicEventsService.ts`. Restores the
 * META-ORCH-0827 [Platform structure consolidation] Pass 2 Step 10 parity
 * contract that was broken pre-0846 by `venueName: null` and
 * `format: "in-person"` hardcodes.
 *
 * Detection rules:
 *   1. The literal `venueName: null` must NOT appear on a non-comment line
 *      in the discover edge function. (Was line 422 pre-fix.)
 *   2. The literal `format: "in-person"` must NOT appear on a non-comment
 *      line in the consumer detail screen (ConsumerEventDetailScreen.tsx;
 *      formerly ExpandedBusinessEventSheet.tsx line 81 pre-fix, retargeted by
 *      ORCH-1138 when EBES was decommissioned).
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

// ORCH-1135 (PR #466 G1 discover v2): card construction moved out of the
// 830-line index.ts monolith into `_business-query.ts` (mapRpcRowToCard — the
// SOLE business-card constructor). The venue/address/format resolution helpers
// (extractVenueName / deriveSharedFormat, unchanged in _helpers.ts) are now wired
// there. R-1/R-3/R-4 retarget to _business-query.ts; R-5 (type) unchanged. See
// INVESTIGATE_ORCH-1135_DISCOVER_V2_INVARIANT_PRESERVATION.md.
// NOTE: if a future ORCH moves card construction again, retarget BUSINESS_QUERY.
//
// ORCH-1138 Leg 3 (EBES decommission): ExpandedBusinessEventSheet.tsx — the
// consumer-side mapping R-2 used to scan — was DELETED. Its successor consumer of
// the BusinessEventCard payload is the Leg-2 foundation detail screen
// `ConsumerEventDetailScreen.tsx`, which consumes `card.format` directly (no
// `format: "in-person"` hardcode). R-2 retargets to that screen — the venue/
// address/format parity invariant must hold wherever the consumer now reads the
// shared card. See SPEC_ORCH-1138_RESERVE_STRAIGHT_TO_CART.md / EBES deletion.
const DISCOVER_FN = "supabase/functions/discover-merged-events/index.ts";
const BUSINESS_QUERY = "supabase/functions/discover-merged-events/_business-query.ts";
const SHEET = "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx";
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
const businessQuerySrc = readSource(BUSINESS_QUERY);
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

// Rule 1 — venueName: null forbidden where business cards are built (_business-query.ts)
{
  const hit = forbidOnNonCommentLine(businessQuerySrc, "venueName: null");
  record(
    "R-1 venueName: null forbidden in discover-merged-events/_business-query.ts",
    hit === null,
    hit === null
      ? `${BUSINESS_QUERY}: no offending line`
      : `${BUSINESS_QUERY}:${hit.lineNumber} contains forbidden literal — ${hit.text}`,
  );
}

// Rule 2 — format: "in-person" forbidden in the consumer detail screen
// (ConsumerEventDetailScreen.tsx; post-EBES successor — must consume card.format,
// not re-hardcode "in-person"). Single or double quotes; either is a regression.
{
  const hitDouble = forbidOnNonCommentLine(sheetSrc, 'format: "in-person"');
  const hitSingle = forbidOnNonCommentLine(sheetSrc, "format: 'in-person'");
  const hit = hitDouble ?? hitSingle;
  record(
    'R-2 format: "in-person" hardcode forbidden in ConsumerEventDetailScreen.tsx',
    hit === null,
    hit === null
      ? `${SHEET}: no offending line`
      : `${SHEET}:${hit.lineNumber} contains forbidden literal — ${hit.text}`,
  );
}

// Rule 3 — extractVenueName referenced where business cards are built
{
  const ok = requireSubstring(businessQuerySrc, "extractVenueName");
  record(
    "R-3 extractVenueName referenced in discover-merged-events/_business-query.ts",
    ok,
    ok
      ? `${BUSINESS_QUERY}: extractVenueName found`
      : `${BUSINESS_QUERY}: extractVenueName helper not wired up — venueName fallback chain is missing`,
  );
}

// Rule 4 — deriveSharedFormat referenced where business cards are built
{
  const ok = requireSubstring(businessQuerySrc, "deriveSharedFormat");
  record(
    "R-4 deriveSharedFormat referenced in discover-merged-events/_business-query.ts",
    ok,
    ok
      ? `${BUSINESS_QUERY}: deriveSharedFormat found`
      : `${BUSINESS_QUERY}: deriveSharedFormat helper not wired up — format derivation is missing`,
  );
}

// Rule 6 — pin the brand-parity fallback EXPRESSION (not just the symbol), so a
// present-but-unused import can't green the gate. Mirrors brand-side
// `asStringOrNull(location.venueName) ?? row.location_text`.
{
  const ok =
    requireSubstring(businessQuerySrc, "extractVenueName(theme) ?? (row.location_text") &&
    requireSubstring(businessQuerySrc, "deriveSharedFormat(");
  record(
    "R-6 venueName/format resolved via the brand-parity fallback expression in _business-query.ts",
    ok,
    ok
      ? `${BUSINESS_QUERY}: extractVenueName(theme) ?? row.location_text + deriveSharedFormat(...) present`
      : `${BUSINESS_QUERY}: card builder no longer resolves venueName via extractVenueName(theme) ?? row.location_text fallback — brand parity broken`,
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
