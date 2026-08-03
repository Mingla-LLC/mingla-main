#!/usr/bin/env node
/**
 * #962 [pre-bank currency de-GBP] — I-PROPOSED-962-NO-GBP-IN-PREBANK-MONEY-SURFACES
 * (DRAFT until CLOSE; orchestrator flips ACTIVE).
 *
 * WHY: a pre-bank brand genuinely has NO currency (`brands.default_currency =
 * NULL`, migration 0769 "NULL means not set; do not imply GBP"). Currency is
 * first materialized only when the partner adds a bank (picks a country in
 * Stripe onboarding). Before that, every money surface must HIDE the price
 * ("—") / omit the symbol — NEVER manufacture GBP, and NEVER swap a
 * business-display surface to a different literal. Phase 1 + Phase 2 of #962
 * converted the exact set of files below to resolve currency via
 * `currencyCodeOrNull` (the null-safe sibling of the ORCH-1152 Intl crash-guard
 * `normalizeCurrency`, which stays byte-identical). This gate fails the build if
 * any of those converted files re-introduces a fabricated-GBP literal.
 *
 * SCOPING: bans the 5 GBP-manufacturing literals in EXACTLY the 28 converted
 * files. This is deliberately NOT a repo-wide `?? "GBP"` ban — charge-path /
 * post-purchase files keep a last-resort GBP because a pre-bank brand cannot
 * reach them (bank-gated). The residual data-purity sites are tracked in #1305.
 * Full-line `//` + block comments are stripped so documentation of the removed
 * strings (and "never manufacture GBP" prose) cannot self-trip.
 *
 * `--self-test` proves FAIL-on-each-planted-literal (in every listed file) +
 * PASS-on-the-clean-tree.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / missing-or-renamed file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, "..", "..", "..");

// The EXACT Phase-1 + Phase-2 converted set (28 files). Adding/removing a file
// here is a visible, reviewable diff — never widen silently.
const FILES = [
  // Phase 1 (leak sources — merged in PR #1299)
  "mingla-business/src/utils/serverDraftEventMapper.ts",
  "mingla-business/app/rsvp/[id]/preview.tsx",
  "supabase/functions/discover-merged-events/_business-query.ts",
  "mingla-business/src/components/checkout/QuantityRow.tsx",
  "packages/offering-rendering/QuantityRow.tsx",
  // Phase 2 G-series (display conversions)
  "mingla-business/src/utils/liveEventConverter.ts",
  "mingla-business/app/(tabs)/home.tsx",
  "mingla-business/src/utils/eventSalesSummary.ts",
  "mingla-business/app/event/[id]/reconciliation.tsx",
  "mingla-business/app/event/[id]/door/index.tsx",
  "mingla-business/src/components/door/DoorSaleNewSheet.tsx",
  "mingla-business/src/components/brand/BrandProfileView.tsx",
  "mingla-business/src/components/brand/BrandPricingDefaultsView.tsx",
  "mingla-business/src/utils/ticketDisplay.ts",
  "app-mobile/src/components/expandedCard/TicketCartSheet.tsx",
  "app-mobile/src/components/ConnectionsPage.tsx",
  "mingla-business/src/components/event/CreatorStep5Tickets.tsx",
  "mingla-business/src/components/pricing/WhoCoversCostsSection.tsx",
  "mingla-business/src/components/event/PreviewEventView.tsx",
  "mingla-business/src/components/event/EventDetailTicketTypeRow.tsx",
  "mingla-business/src/components/event/EventDetailActivityRow.tsx",
  "mingla-business/src/components/event/EventDetailKpiCard.tsx",
  "mingla-business/src/hooks/useEventOrders.ts",
  "mingla-business/src/utils/guestCsvExport.ts",
  // Newly-discovered dashboard sites
  "mingla-business/app/event/[id]/index.tsx",
  "mingla-business/app/trip/[id]/index.tsx",
  // Venue-menu display-gated
  "mingla-business/src/components/venue/VenueMenuModule.tsx",
  "mingla-business/src/components/venue/MenuItemSheet.tsx",
];

const BANNED = [
  {
    name: "nullish-gbp",
    re: /\?\?\s*"GBP"/,
    hint: 'Never `?? "GBP"` — resolve `currencyCodeOrNull(...)` and hide the price ("—") when null.',
  },
  {
    name: "or-gbp",
    re: /\|\|\s*"GBP"/,
    hint: 'Never `|| "GBP"` — a pre-bank brand has no currency; hide the price / use the consumer USD last-resort.',
  },
  {
    name: "currency-colon-gbp",
    re: /currency:\s*"GBP"/,
    hint: 'Never `currency: "GBP"` — persist/carry null, not a fabricated GBP.',
  },
  {
    name: "currency-eq-gbp",
    re: /currency\s*=\s*"GBP"/,
    hint: 'Never `currency = "GBP"` (default-param form) — make the param nullable and hide when null.',
  },
  {
    name: "fallback-currency-gbp",
    re: /fallbackCurrency=\s*"GBP"/,
    hint: 'Never `fallbackCurrency="GBP"` — default the fallback to null and render "—".',
  },
];

/** Strip block comments + full-line `//` comments (leave inline URLs alone). */
function stripComments(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/^[ \t]*\/\/.*$/gm, "");
  return s;
}

/** Populate `failures` with every banned-pattern hit in `src` (comments removed). */
function scan(label, src, failures) {
  const lines = stripComments(src).split("\n");
  lines.forEach((line, i) => {
    for (const b of BANNED) {
      if (b.re.test(line)) {
        failures.push(
          `${label}:${i + 1} [${b.name}] — ${b.hint}\n    > ${line.trim()}`,
        );
      }
    }
  });
}

if (process.argv.includes("--self-test")) {
  const self = [];
  // PASS on the real (clean) tree.
  for (const rel of FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      self.push(`MISSING ${rel} (self-test cannot run against a renamed/deleted file)`);
      continue;
    }
    const f = [];
    scan(rel, fs.readFileSync(abs, "utf8"), f);
    if (f.length) self.push(`FALSE POSITIVE on ${rel}: ${f.join(" | ")}`);
  }
  // FAIL when a banned literal is planted into EACH listed file (in-memory).
  const plant = `\nconst __plant = event.currency ?? "GBP";\n`;
  for (const rel of FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue; // already recorded above
    const f = [];
    scan(rel, fs.readFileSync(abs, "utf8") + plant, f);
    if (!f.some((m) => m.includes("[nullish-gbp]"))) {
      self.push(`MISSED planted GBP literal in ${rel}`);
    }
  }

  if (self.length) {
    console.error("#962 prebank-no-gbp self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    `#962 prebank-no-gbp self-test PASS (clean tree + ${FILES.length} planted-literal cases).`,
  );
  process.exit(0);
}

const failures = [];
for (const rel of FILES) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(
      `#962 I-PROPOSED-962-NO-GBP-IN-PREBANK-MONEY-SURFACES script error: target not found at ${rel}. ` +
        `If the file was renamed, update FILES in this gate.`,
    );
    process.exit(2);
  }
  scan(rel, fs.readFileSync(abs, "utf8"), failures);
}

if (failures.length > 0) {
  console.error(
    "#962 I-PROPOSED-962-NO-GBP-IN-PREBANK-MONEY-SURFACES FAIL — fabricated-GBP literal found in a converted pre-bank money surface:\n  " +
      failures.join("\n  ") +
      "\n\nSee docs/INVARIANT_REGISTRY.md I-PROPOSED-962-NO-GBP-IN-PREBANK-MONEY-SURFACES.",
  );
  process.exit(1);
}

console.log(
  `#962 I-PROPOSED-962-NO-GBP-IN-PREBANK-MONEY-SURFACES PASS — ${FILES.length} converted pre-bank money surfaces carry no fabricated GBP.`,
);
