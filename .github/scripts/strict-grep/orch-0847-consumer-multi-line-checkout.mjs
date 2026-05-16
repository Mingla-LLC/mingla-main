#!/usr/bin/env node
/**
 * ORCH-0847 [Consumer ticket purchase parity with public business page]
 * strict-grep gate #1 — Consumer checkout MUST send multi-line `lines[]`.
 *
 * Codifies new invariant `I-PROPOSED-CONSUMER-MULTI-LINE-CHECKOUT` from
 * SPEC §6:
 *
 *   "Every consumer-side `ticket-checkout-create` call MUST send a
 *   `lines[]` array (length ≥ 1) — never a hardcoded single-line shape."
 *
 * What this gate enforces:
 *
 *   1. No `lines: [{ ticketTypeId:` ... `quantity: 1 }]` literal in
 *      `app-mobile/src/` — that pattern was the pre-Phase-C hardcode
 *      at ExpandedBusinessEventSheet.tsx:235 that prevented multi-tier
 *      orders. The new code threads `payload.lines` from
 *      `TicketCartCheckoutPayload` through `runNativeCheckout`.
 *
 *   2. `ExpandedBusinessEventSheet.tsx` MUST import `TicketCartSheet`
 *      (the multi-tier sheet) — proves the new flow is wired.
 *
 *   3. `nativeCheckoutFlow.ts` MUST keep its `lines: Array<...>` typed
 *      input — no regression to a single-tier shape.
 *
 * Exit codes:
 *   0 — clean
 *   1 — violation
 *
 * Per ORCH-0847 SPEC §9 Gate 1.
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

// Check 1 — no single-line hardcoded literal in any app-mobile source file
// touching ticket checkout. Scope to files known to wire checkout calls.
const checkoutCallers = [
  "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
  "app-mobile/src/components/expandedCard/TicketCartSheet.tsx",
  "app-mobile/src/payments/nativeCheckoutFlow.ts",
];

const SINGLE_LINE_HARDCODE =
  /lines\s*:\s*\[\s*\{\s*ticketTypeId\s*:\s*[a-zA-Z_$][\w$]*\s*,\s*quantity\s*:\s*1\s*\}\s*\]/;

for (const rel of checkoutCallers) {
  const src = readMaybe(rel);
  if (src === null) continue;
  if (SINGLE_LINE_HARDCODE.test(src)) {
    note(
      rel,
      "Found hardcoded single-line `lines: [{ ticketTypeId: X, quantity: 1 }]` — consumer checkout must use multi-tier cart lines from TicketCartCheckoutPayload, not a literal single-line shape.",
    );
  }
}

// Check 2 — ExpandedBusinessEventSheet imports TicketCartSheet (the new
// multi-tier surface).
const sheet = readMaybe(
  "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
);
if (sheet !== null) {
  if (!/import\s+TicketCartSheet[\s\S]{0,200}?from\s+["']\.\/TicketCartSheet["']/.test(sheet)) {
    note(
      "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
      "MUST import `TicketCartSheet` from `./TicketCartSheet` — that's the multi-tier cart surface that replaces TicketClaimConfirmModal.",
    );
  }
  if (!/<TicketCartSheet[\s\S]{0,800}?\/>/m.test(sheet)) {
    note(
      "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
      "MUST render `<TicketCartSheet ... />` in its JSX return.",
    );
  }
}

// Check 3 — nativeCheckoutFlow keeps lines as an array type (not a single
// ticketTypeId shape). Conservative grep for the type annotation.
const flow = readMaybe("app-mobile/src/payments/nativeCheckoutFlow.ts");
if (flow !== null) {
  if (
    !/lines\s*:\s*Array<\s*\{\s*ticketTypeId\s*:\s*string\s*;\s*quantity\s*:\s*number\s*\}\s*>/.test(
      flow,
    )
  ) {
    note(
      "app-mobile/src/payments/nativeCheckoutFlow.ts",
      "MUST keep `lines: Array<{ticketTypeId: string; quantity: number}>` type on NativeCheckoutInput — no regression to a single-tier shape.",
    );
  }
}

if (violations.length > 0) {
  console.error(
    "\n[ORCH-0847 gate #1 — consumer-multi-line-checkout] VIOLATIONS:\n",
  );
  for (const v of violations) {
    console.error(`  • ${v.file}\n    ${v.msg}\n`);
  }
  console.error(
    "Codifies I-PROPOSED-CONSUMER-MULTI-LINE-CHECKOUT (ORCH-0847 SPEC §6).",
  );
  process.exit(1);
}

console.log(
  "[ORCH-0847 gate #1 — consumer-multi-line-checkout] PASS — no hardcoded single-line checkout shapes found; TicketCartSheet wired in ExpandedBusinessEventSheet.",
);
process.exit(0);
