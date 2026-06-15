#!/usr/bin/env node
/**
 * ORCH-1138 [trip-page-redesign] — Reserve goes STRAIGHT TO CART — strict-grep gate.
 *
 * Enforces I-PROPOSED-1138-TRIP-RESERVE-STRAIGHT-TO-CART, codified in
 * Mingla_Artifacts/specs/SPEC_ORCH-1138_RESERVE_STRAIGHT_TO_CART.md §9:
 *
 *   On the consumer trip detail screen, tapping "Reserve my spot" MUST open the
 *   cart (TicketCartSheet) DIRECTLY. It MUST NOT route through the shared
 *   ExpandedBusinessEventSheet (EBES) — that showed buyers a duplicate full
 *   detail page. EBES stays the events/experiences detail+checkout sheet
 *   (mounted from ExpandedCardModal + MessageInterface) and is untouched.
 *
 * Asserts on `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx`
 * (comments stripped, so historical EBES references in the header/doc comments
 * never false-positive):
 *   1. NO `ExpandedBusinessEventSheet` import statement.
 *   2. NO `<ExpandedBusinessEventSheet` JSX mount.
 *   3. NO `tripToBusinessEventCard` adapter (the now-dead trip-only EBES adapter).
 *   4. DOES import + mount `TicketCartSheet` (the direct cart).
 *
 * This FAILS if the EBES mount is restored (revert) and PASSES once the
 * direct-cart wiring is in place — the fails-on-revert contract (SPEC T-2).
 *
 * Self-test: ORCH1138_SIMULATE_REVERT=1 re-introduces the EBES wiring in-memory
 * → the gate MUST then FAIL, proving the checks bite.
 *
 * Exit codes: 0 — clean · 1 — violation.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const SCREEN = "app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx";
const simulateRevert = process.env.ORCH1138_SIMULATE_REVERT === "1";

// Strip LINE comments FIRST, then block comments. Order matters: the screen's
// doc comments contain a literal "/*)" inside a `//` line — stripping block
// comments first would treat that as an opener and swallow real code (the cart
// import). Line-first removes those `//`-embedded `/*` tokens before the block
// pass runs. The `[^:]` guard preserves `https://` URLs.
const stripComments = (src) =>
  src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const violations = [];

const abs = join(ROOT, SCREEN);
if (!existsSync(abs)) {
  console.error(`[ORCH-1138] Scoped file missing: ${SCREEN}`);
  process.exit(1);
}

let raw = readFileSync(abs, "utf8");

// Simulated revert = restore the pre-1138 EBES detail-hop wiring (import + mount
// + adapter). The gate must then FAIL (fails-on-revert proof).
if (simulateRevert) {
  raw = raw
    .replace(
      /import TicketCartSheet[\s\S]*?from "\.\.\/\.\.\/components\/expandedCard\/TicketCartSheet";/,
      'import { ExpandedBusinessEventSheet } from "../../components/expandedCard/ExpandedBusinessEventSheet";',
    )
    .replace(/<TicketCartSheet/g, "<ExpandedBusinessEventSheet")
    .replace(/\bopenCart\b/g, "tripToBusinessEventCard");
}

const stripped = stripComments(raw);

// 1–2. EBES must not be imported or mounted (active code, comments stripped).
if (/import\s*\{[^}]*\bExpandedBusinessEventSheet\b/.test(stripped)) {
  violations.push(
    "ConsumerTripDetailScreen imports ExpandedBusinessEventSheet — Reserve must open TicketCartSheet directly (SPEC §2 / F-1). EBES stays for events/experiences only.",
  );
}
if (/<ExpandedBusinessEventSheet\b/.test(stripped)) {
  violations.push(
    "ConsumerTripDetailScreen mounts <ExpandedBusinessEventSheet> — the duplicate-detail-page hop is forbidden (SPEC F-1). Mount <TicketCartSheet> directly.",
  );
}

// 3. The dead trip-only adapter must be gone.
if (/\btripToBusinessEventCard\b/.test(stripped)) {
  violations.push(
    "ConsumerTripDetailScreen still references tripToBusinessEventCard — the now-dead trip-only EBES adapter must be deleted (SPEC §2).",
  );
}

// 4. The direct cart must be imported + mounted.
if (!/import\s+TicketCartSheet\b/.test(stripped)) {
  violations.push(
    "ConsumerTripDetailScreen must import TicketCartSheet (the direct cart) — SPEC §4.1.",
  );
}
if (!/<TicketCartSheet\b/.test(stripped)) {
  violations.push(
    "ConsumerTripDetailScreen must mount <TicketCartSheet> so Reserve opens the cart directly — SPEC §4.1 / SC-1.",
  );
}

if (violations.length > 0) {
  console.error("\n[ORCH-1138 — trip-reserve-straight-to-cart] VIOLATIONS:\n");
  for (const v of violations) console.error(`  • ${v}\n`);
  console.error(
    simulateRevert
      ? "ORCH-1138 gate FAILED under SIMULATE_REVERT — expected (fails-on-revert proven)."
      : "Per SPEC_ORCH-1138_RESERVE_STRAIGHT_TO_CART.md — Reserve opens the cart directly; never route trips through ExpandedBusinessEventSheet.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-1138 — trip-reserve-straight-to-cart] PASS — trip Reserve opens TicketCartSheet directly; no ExpandedBusinessEventSheet hop, no dead adapter.",
);
process.exit(0);
