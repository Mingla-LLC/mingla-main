#!/usr/bin/env node
/**
 * ORCH-1147R2 — the business checkout SELECTION step leads with the server
 * fee-grossed all-in, NOT the bare base subtotal.
 *
 * Invariant I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN (DRAFT): the three
 * mingla-business checkout SELECTION index screens (event / trip / experience)
 * MUST bind the displayed full-total headline value + the Continue button's
 * accessibility label to the server all-in (`totals.allInTotal`), NOT the bare
 * base (`totals.total` / `totals.subtotal`); AND the business `QuantityRow.tsx`
 * wrapper MUST forward `priceAllInGbp` into the shared row so each per-tier row
 * leads with the all-in. The trip installments deposit branch (`dueTodayCents`)
 * is explicitly EXEMPT — it legitimately renders the deposit, not the base.
 *
 * R1 fixed the payment step; R2 extends the all-in to the selection step.
 *
 * The gate fails if any of:
 *   (a) any of the 3 SELECTION index.tsx files does NOT reference
 *       `totals.allInTotal` (the server all-in basis); OR
 *   (b) any binds the full-total headline value or Continue a11y directly to
 *       the bare base — i.e. `formatCurrency(totals.total ...)` or any
 *       `totals.subtotal` reference still exists (the deposit branch uses
 *       `dueTodayCents`, never the base, so a healthy fix leaves NO
 *       `formatCurrency(totals.total ...)` and NO `totals.subtotal`); OR
 *   (c) `mingla-business/src/components/checkout/QuantityRow.tsx` does NOT
 *       forward `priceAllInGbp` into `ticketForPackage`.
 *
 * Comments are stripped so the explanatory ORCH-1147R2 notes never trip the
 * gate. Mirrors the modular gate pattern (sibling: orch-1147-cart-total-is-allin.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];

const selectionScreens = [
  "mingla-business/app/checkout/[eventId]/index.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/index.tsx",
  "mingla-business/app/checkout-experience/[experienceEventId]/index.tsx",
];

const wrapperFile = "mingla-business/src/components/checkout/QuantityRow.tsx";

// Strip line + block comments so prose like "// ...totals.total..." never trips.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// --- per-selection-screen evaluation --------------------------------------
const evaluateScreen = (rel, rawCode) => {
  const code = stripComments(rawCode);
  const fileFailures = [];

  // (a) the all-in basis must be referenced.
  if (!/\btotals\.allInTotal\b/.test(code)) {
    fileFailures.push(
      `${rel}: selection bottom bar must read the server fee-grossed all-in (totals.allInTotal). The bare base subtotal omits the passed Mingla/service fee. I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN.`,
    );
  }

  // (b) the full-total headline / a11y must NOT bind to the bare base.
  // A healthy fix leaves NO `formatCurrency(totals.total ...)` (the deposit
  // branch uses dueTodayCents) and NO `totals.subtotal` reference.
  if (/formatCurrency\(\s*totals\.total\b/.test(code)) {
    fileFailures.push(
      `${rel}: the full-total headline/a11y binds to the bare base (formatCurrency(totals.total, …)). Bind it to the all-in (headlineAllIn / totals.allInTotal) instead. I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN.`,
    );
  }
  if (/\btotals\.subtotal\b/.test(code)) {
    fileFailures.push(
      `${rel}: the selection screen must not bind the headline to totals.subtotal (bare base). Use the server all-in. I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN.`,
    );
  }

  return fileFailures;
};

// (c) the wrapper must forward priceAllInGbp into the adapter object.
const evaluateWrapper = (rel, rawCode) => {
  const code = stripComments(rawCode);
  if (!/priceAllInGbp:\s*ticket\.priceAllInGbp/.test(code)) {
    return [
      `${rel}: ticketForPackage must forward priceAllInGbp (priceAllInGbp: ticket.priceAllInGbp ?? null) so the shared row renders the per-tier all-in. I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN.`,
    ];
  }
  return [];
};

// --- self-test fixtures (run with --self-test) ----------------------------
const SELF_TEST = process.argv.includes("--self-test");

if (SELF_TEST) {
  const GOOD_SCREEN = `
    const headlineAllIn = formatCurrency(totals.allInTotal, totals.currency);
    const showFeesTaxLine = !totals.isEmpty && !totals.isFree && totals.hasFeesTaxDelta;
    <Text>{dueTodayCents !== null ? formatCurrency(dueTodayCents, totals.currency, true) : headlineAllIn}</Text>
  `;
  const BAD_NO_ALLIN = `
    <Text>{formatCurrency(totals.total, totals.currency)}</Text>
  `;
  const BAD_BASE_INLINE = `
    const headlineAllIn = formatCurrency(totals.allInTotal, totals.currency);
    <Text>{formatCurrency(totals.total, totals.currency)}</Text>
  `;
  const BAD_SUBTOTAL = `
    const headlineAllIn = formatCurrency(totals.allInTotal, totals.currency);
    <Text>{formatCurrency(totals.subtotal, totals.currency)}</Text>
  `;
  const GOOD_WRAPPER = `
    () => ({ id: ticket.id, priceGbp: ticket.priceGbp, priceAllInGbp: ticket.priceAllInGbp ?? null })
  `;
  const BAD_WRAPPER = `
    () => ({ id: ticket.id, priceGbp: ticket.priceGbp })
  `;

  const goodScreen = evaluateScreen("good.tsx", GOOD_SCREEN);
  const badNoAllin = evaluateScreen("bad-no-allin.tsx", BAD_NO_ALLIN);
  const badBaseInline = evaluateScreen("bad-base.tsx", BAD_BASE_INLINE);
  const badSubtotal = evaluateScreen("bad-subtotal.tsx", BAD_SUBTOTAL);
  const goodWrapper = evaluateWrapper("good-wrapper.tsx", GOOD_WRAPPER);
  const badWrapper = evaluateWrapper("bad-wrapper.tsx", BAD_WRAPPER);

  const ok =
    goodScreen.length === 0 &&
    badNoAllin.length >= 1 &&
    badBaseInline.length >= 1 &&
    badSubtotal.length >= 1 &&
    goodWrapper.length === 0 &&
    badWrapper.length >= 1;

  if (!ok) {
    console.error("ORCH-1147R2 selection-shows-allin SELF-TEST failed:", {
      goodScreen,
      badNoAllin,
      badBaseInline,
      badSubtotal,
      goodWrapper,
      badWrapper,
    });
    process.exit(1);
  }
  console.log("ORCH-1147R2 selection-shows-allin gate self-test passed.");
  process.exit(0);
}

for (const rel of selectionScreens) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    failures.push(`${rel}: expected checkout selection screen not found.`);
    continue;
  }
  failures.push(...evaluateScreen(relative(root, abs), readFileSync(abs, "utf8")));
}

const wrapperAbs = join(root, wrapperFile);
if (!existsSync(wrapperAbs)) {
  failures.push(`${wrapperFile}: expected business QuantityRow wrapper not found.`);
} else {
  failures.push(
    ...evaluateWrapper(relative(root, wrapperAbs), readFileSync(wrapperAbs, "utf8")),
  );
}

if (failures.length > 0) {
  console.error("ORCH-1147R2 selection-shows-allin gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1147R2 selection-shows-allin gate passed.");
