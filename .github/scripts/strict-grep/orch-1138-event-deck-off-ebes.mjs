#!/usr/bin/env node
/**
 * ORCH-1138 Leg 2 [public event page redesign] — deck EVENT card OFF EBES —
 * strict-grep gate.
 *
 * Enforces I-PROPOSED-1138-EVENT-DECK-OFF-EBES (SPEC §6 / §9 G-1):
 *
 *   The consumer EVENT deck entry MUST open ConsumerEventDetailScreen directly;
 *   it MUST NOT mount ExpandedBusinessEventSheet (EBES) for the `businessEvent`
 *   branch. EBES STAYS for the experience branch (ExpandedCardModal :2259) + chat
 *   (MessageInterface) — N1. So the gate is SCOPED to the event branch + the
 *   consumer event screen, NOT a blanket EBES ban.
 *
 * Asserts (comments stripped, so historical EBES references in doc comments never
 * false-positive):
 *
 *   A. app-mobile/src/components/ExpandedCardModal.tsx
 *      - the `businessEvent !== null` branch mounts <ConsumerEventDetailScreen>;
 *      - that branch does NOT mount <ExpandedBusinessEventSheet>.
 *      (EBES MAY still be imported + mounted elsewhere — the experience branch.)
 *
 *   B. app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx
 *      - imports + mounts <TicketCartSheet> (the direct cart);
 *      - does NOT import or mount <ExpandedBusinessEventSheet>.
 *
 * Self-test: ORCH1138_SIMULATE_REVERT=1 restores the EBES mount in the event
 * branch → the gate MUST FAIL (fails-on-revert proof, SPEC G-1).
 *
 * Exit codes: 0 — clean · 1 — violation.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const MODAL = "app-mobile/src/components/ExpandedCardModal.tsx";
const SCREEN = "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx";
const simulateRevert = process.env.ORCH1138_SIMULATE_REVERT === "1";

const stripComments = (src) =>
  src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const readScoped = (rel) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    console.error(`[ORCH-1138 event-deck-off-ebes] Scoped file missing: ${rel}`);
    process.exit(1);
  }
  return readFileSync(abs, "utf8");
};

const violations = [];

// ── A. ExpandedCardModal — the businessEvent branch must mount the new screen ──
let modalRaw = readScoped(MODAL);
if (simulateRevert) {
  // Restore the pre-1138 EBES detail-hop in the event branch (the screen mount
  // swapped back to EBES). The gate must then FAIL.
  modalRaw = modalRaw.replace(
    /<ConsumerEventDetailScreen\b/g,
    "<ExpandedBusinessEventSheet",
  );
}
const modal = stripComments(modalRaw);

// Isolate the `businessEvent` branch: from `if (businessEvent !== null` to the
// next top-level `if (!card)` (the place/TM path). The event branch lives there.
const branchMatch = /if\s*\(\s*businessEvent\s*!==\s*null[\s\S]*?\n\s{2}if\s*\(\s*!card\s*\)/.exec(
  modal,
);
const eventBranch = branchMatch !== null ? branchMatch[0] : "";
if (eventBranch.length === 0) {
  violations.push(
    "Could not locate the `businessEvent !== null` branch in ExpandedCardModal — the gate cannot verify the event repoint.",
  );
} else {
  if (!/<ConsumerEventDetailScreen\b/.test(eventBranch)) {
    violations.push(
      "ExpandedCardModal's businessEvent branch does NOT mount <ConsumerEventDetailScreen> — the deck event card must open the new foundation event detail (SPEC §4.9 / G-1).",
    );
  }
  if (/<ExpandedBusinessEventSheet\b/.test(eventBranch)) {
    violations.push(
      "ExpandedCardModal's businessEvent branch mounts <ExpandedBusinessEventSheet> — the deck EVENT card must NOT route through EBES (I-PROPOSED-1138-EVENT-DECK-OFF-EBES). EBES stays for the experience branch + chat only.",
    );
  }
}

// ── B. ConsumerEventDetailScreen — TicketCartSheet direct, never EBES ──
const screen = stripComments(readScoped(SCREEN));
if (!/import\s+TicketCartSheet\b/.test(screen)) {
  violations.push(
    "ConsumerEventDetailScreen must import TicketCartSheet (the direct cart) — SPEC §4.7.",
  );
}
if (!/<TicketCartSheet\b/.test(screen)) {
  violations.push(
    "ConsumerEventDetailScreen must mount <TicketCartSheet> so Get-tickets opens the cart directly — SPEC §4.7 / SC-6.",
  );
}
if (/\bExpandedBusinessEventSheet\b/.test(screen)) {
  violations.push(
    "ConsumerEventDetailScreen references ExpandedBusinessEventSheet — the new event detail must NEVER route through EBES (SPEC §4.7 / G-1).",
  );
}

if (violations.length > 0) {
  console.error("\n[ORCH-1138 — event-deck-off-ebes] VIOLATIONS:\n");
  for (const v of violations) console.error(`  • ${v}\n`);
  console.error(
    simulateRevert
      ? "ORCH-1138 gate FAILED under SIMULATE_REVERT — expected (fails-on-revert proven)."
      : "Per SPEC_ORCH-1138_LEG2_EVENT_PAGE.md — the deck EVENT card opens ConsumerEventDetailScreen directly; never route the event flow through ExpandedBusinessEventSheet.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-1138 — event-deck-off-ebes] PASS — deck event card mounts ConsumerEventDetailScreen; no EBES in the event branch or the consumer event screen; cart mounted directly.",
);
process.exit(0);
