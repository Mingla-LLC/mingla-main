#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0848 [Tickets-section toggle parity with Active accordion] regression check.
 *
 * Asserts that the Tickets section in
 * `app-mobile/src/components/activity/CalendarTab.tsx` (Likes → Calendar tab)
 * uses the same collapsible accordion pattern as the Active section directly
 * below it: tappable header backed by `expandedAccordionItems` state, chevron
 * indicator, count, and gated body rendering.
 *
 * Coverage angles (all source-level structural — the JSX has no exportable
 * pure-data seam, so we lock the contract via grep):
 *
 * (S) Source-level structural grep. Locks in the contract that the Tickets
 *     header is a TouchableOpacity bound to the `"tickets"` accordion key,
 *     the body is gated on `expandedAccordionItems.includes("tickets")`, and
 *     the dead `businessEventSection` / `businessEventHeader` styles are gone.
 *
 * S-04 is the fails-on-revert key: reverting the body-gating check removes
 * the `expandedAccordionItems.includes("tickets")` gate and this check fails.
 *
 * The tester writes an adversarial second test from a different angle per
 * CLOSE Step 0.5.
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");

const read = (relFromRepoRoot) => {
  const abs = path.join(repoRoot, relFromRepoRoot);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const src = read("app-mobile/src/components/activity/CalendarTab.tsx");

check(
  "S-01 expandedAccordionItems initial state includes 'tickets' (default expanded)",
  src !== null &&
    /useState<\s*\n?\s*string\[\]\s*\n?\s*>\(\["tickets",\s*"active"\]\)/.test(
      src,
    ),
  "Initial accordion state must seed with [\"tickets\", \"active\"] so Tickets defaults to expanded (mirrors today's always-expanded behaviour).",
);

check(
  "S-02 Tickets header is a TouchableOpacity using styles.accordionHeader (parity with Active)",
  src !== null &&
    // Find the `businessOrders.length > 0 && (` block and confirm it contains
    // a TouchableOpacity styled with styles.accordionHeader and renders the
    // literal "Tickets" label.
    (() => {
      const m = src.match(/businessOrders\.length\s*>\s*0\s*&&\s*\(([\s\S]*?\n\s{8}\)\})/);
      if (!m) return false;
      const block = m[1];
      return (
        /<TouchableOpacity[\s\S]*?style=\{styles\.accordionHeader\}/.test(block) &&
        />\s*Tickets\s*</.test(block)
      );
    })(),
  "Tickets header must be a TouchableOpacity styled with `styles.accordionHeader` — same primitive as the Active/Archive accordion headers.",
);

check(
  "S-03 Tickets header toggles 'tickets' key in expandedAccordionItems",
  src !== null &&
    /prev\.includes\("tickets"\)\s*\?\s*prev\.filter\(\(i\)\s*=>\s*i\s*!==\s*"tickets"\)\s*:\s*\[\.\.\.prev,\s*"tickets"\]/.test(
      src,
    ),
  "Tickets onPress must add/remove the 'tickets' key in expandedAccordionItems exactly like Active does for 'active' and Archive does for 'archive'.",
);

check(
  "S-04 Tickets body rendering is gated on expandedAccordionItems.includes('tickets')",
  src !== null &&
    /\{expandedAccordionItems\.includes\("tickets"\)\s*&&\s*\(\s*<View\s+style=\{styles\.accordionContentContainer\}>[\s\S]*?BusinessEventCalendarRow/.test(
      src,
    ),
  "Ticket rows must only render when 'tickets' is in expandedAccordionItems — this is the gate that makes the section collapsible. Reverting this gate makes the toggle a no-op and is the fails-on-revert proof for ORCH-0848.",
);

check(
  "S-05 Chevron icon flips based on tickets-expanded state (same shape as Active)",
  src !== null &&
    /expandedAccordionItems\.includes\("tickets"\)\s*\n?\s*\?\s*"chevron-down"\s*\n?\s*:\s*"chevron-forward"/.test(
      src,
    ),
  "Chevron must show 'chevron-down' when Tickets is expanded and 'chevron-forward' when collapsed — exact mirror of Active/Archive.",
);

check(
  "S-06 Empty Tickets section is fully hidden (no empty accordion shell)",
  src !== null &&
    /\{businessOrders\.length\s*>\s*0\s*&&\s*\(/.test(src),
  "The entire Tickets header + body must remain gated on businessOrders.length > 0 so users with no tickets don't see an empty accordion.",
);

check(
  "S-07 Dead styles businessEventSection and businessEventHeader removed",
  src !== null &&
    !/businessEventSection\s*:/.test(src) &&
    !/businessEventHeader\s*:/.test(src),
  "Pre-ORCH-0848 styles `businessEventSection` and `businessEventHeader` were only used at the Tickets site and must be deleted now that Tickets uses the shared accordion styles (subtract-before-adding).",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0848 regression check\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
