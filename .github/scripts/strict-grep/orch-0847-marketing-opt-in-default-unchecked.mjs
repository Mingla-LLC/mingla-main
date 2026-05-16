#!/usr/bin/env node
/**
 * ORCH-0847 [Consumer ticket purchase parity with public business page]
 * strict-grep gate #3 — Marketing opt-in MUST default to UNCHECKED.
 *
 * Codifies new invariant
 * `I-PROPOSED-MARKETING-OPT-IN-DEFAULT-UNCHECKED` from SPEC §6:
 *
 *   "Every marketing-opt-in UI surface (consumer + public) MUST default
 *   to `unchecked`. Pre-checking marketing consent is a GDPR / CAN-SPAM
 *   compliance violation."
 *
 * What this gate enforces:
 *
 *   1. Consumer `TicketCartSheet.tsx` opt-in state: `useState<boolean>(false)`.
 *
 *   2. Public CartContext default buyer state: `marketingOptIn: false`.
 *
 *   No `useState(true)` or `marketingOptIn: true` initial defaults
 *   anywhere.
 *
 * Exit codes:
 *   0 — clean
 *   1 — violation
 *
 * Per ORCH-0847 SPEC §9 Gate 3.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const readMaybe = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
};

const violations = [];
const note = (file, msg) => violations.push({ file, msg });

// Check 1 — TicketCartSheet opt-in default
const cartSheetPath =
  "app-mobile/src/components/expandedCard/TicketCartSheet.tsx";
const cartSheet = readMaybe(cartSheetPath);
if (cartSheet === null) {
  note(cartSheetPath, "File missing — Phase C should have created this.");
} else {
  if (
    !/const\s*\[\s*marketingOptIn\s*,\s*setMarketingOptIn\s*\]\s*=\s*useState<\s*boolean\s*>\s*\(\s*false\s*\)/.test(
      cartSheet,
    )
  ) {
    note(
      cartSheetPath,
      "MUST initialise marketingOptIn state with `useState<boolean>(false)` — pre-checked opt-in is a GDPR / CAN-SPAM violation.",
    );
  }
  // Also catch any explicit `true` initial assignment on the same name
  if (
    /const\s*\[\s*marketingOptIn\s*,[\s\S]{0,80}?useState[^()]*\(\s*true\s*\)/.test(
      cartSheet,
    )
  ) {
    note(
      cartSheetPath,
      "Detected `useState(true)` for marketingOptIn — default MUST be `false`.",
    );
  }
}

// Check 2 — Public CartContext default
const cartContextPath = "mingla-business/src/components/checkout/CartContext.tsx";
const cartContext = readMaybe(cartContextPath);
if (cartContext === null) {
  note(cartContextPath, "File missing.");
} else {
  // Look for the default BuyerDetails block — match marketingOptIn: false
  if (!/marketingOptIn\s*:\s*false\b/.test(cartContext)) {
    note(
      cartContextPath,
      "MUST set `marketingOptIn: false` as the default in BuyerDetails.",
    );
  }
  if (/marketingOptIn\s*:\s*true\b/.test(cartContext)) {
    note(
      cartContextPath,
      "Detected `marketingOptIn: true` in CartContext default — default MUST be `false`.",
    );
  }
}

if (violations.length > 0) {
  console.error(
    "\n[ORCH-0847 gate #3 — marketing-opt-in-default-unchecked] VIOLATIONS:\n",
  );
  for (const v of violations) {
    console.error(`  • ${v.file}\n    ${v.msg}\n`);
  }
  console.error(
    "Codifies I-PROPOSED-MARKETING-OPT-IN-DEFAULT-UNCHECKED (ORCH-0847 SPEC §6).",
  );
  process.exit(1);
}

console.log(
  "[ORCH-0847 gate #3 — marketing-opt-in-default-unchecked] PASS — consumer cart sheet + public CartContext both default marketingOptIn to false.",
);
process.exit(0);
