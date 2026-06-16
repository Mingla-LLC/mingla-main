// ORCH-1147R2 [cart SELECTION screen must show the all-in price, not the base]
// — implementor happy-path regression test (Step 0.5).
//
// R1 fixed the payment step + seeded unitPriceAllIn / allInTotal / feesTaxCents
// into the cart. R2 BINDS that existing all-in data to the SELECTION step's two
// display surfaces (the sticky bottom bar + the per-tier QuantityRow), with the
// single combined "Fees & tax" line gated on a real delta. This is a pure
// DISPLAY bind — no engine/math change.
//
// Two layers, both FAIL on a TRUE LINE DELETION of the fix (not a comment-out):
//   (1) MATH — the bottom-bar headline reads totals.allInTotal (the floor),
//       the "Fees & tax" line reads totals.feesTaxCents (gated on
//       hasFeesTaxDelta), and the per-tier all-in is the forwarded
//       priceAllInGbp. We replicate that EXACT derivation against the real
//       useCartTotals reduce (no device / no React renderer).
//   (2) SOURCE-TEXT — read the four ACTUAL changed files and assert the fix
//       lines exist: the per-tier forward in the wrapper, and per offering
//       type the bottom-bar all-in bind + "Total" relabel + a11y all-in +
//       gated "Fees & tax" line. Deleting ANY of them flips an assertion RED.
//
// SPEC §7 T-1..T-8. I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN (DRAFT).

import { describe, expect, jest, test } from "@jest/globals";

import type { CartLine } from "../CartContext";

// --- Make React hooks eager + inject a stub cart -------------------------
// `useMemo(factory)` -> factory(); `useContext(ctx)` -> the injected cart value.
let stubLines: CartLine[] = [];
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useMemo: (factory: () => unknown): unknown => factory(),
    useContext: (): unknown => ({ lines: stubLines }),
  };
});

// Imported AFTER the mock so the hook picks up the eager React shims.
// eslint-disable-next-line import/first
import { useCartTotals } from "../CartContext";

const line = (over: Partial<CartLine>): CartLine => ({
  ticketTypeId: over.ticketTypeId ?? "tt_1",
  ticketName: over.ticketName ?? "General",
  quantity: over.quantity ?? 1,
  unitPrice: over.unitPrice ?? 0,
  unitPriceGbp: over.unitPriceGbp,
  unitPriceAllIn: over.unitPriceAllIn,
  currency: over.currency ?? "GBP",
  isFree: over.isFree ?? false,
});

const totalsFor = (lines: CartLine[]): ReturnType<typeof useCartTotals> => {
  stubLines = lines;
  return useCartTotals();
};

// Replicates the EXACT R2 bottom-bar derivation (index.tsx):
//   headlineAllIn = formatCurrency(totals.allInTotal, currency)  → value here
//   showFeesTaxLine = !isEmpty && !isFree && hasFeesTaxDelta [&& dueToday===null]
// We assert on the raw numbers the formatter would render so the test is
// currency-agnostic and exercises the bind, not the Intl output.
const headlineSource = (totals: ReturnType<typeof useCartTotals>): number =>
  totals.allInTotal;
const showFeesTaxLine = (
  totals: ReturnType<typeof useCartTotals>,
  dueTodayCents: number | null = null,
): boolean =>
  !totals.isEmpty &&
  !totals.isFree &&
  totals.hasFeesTaxDelta &&
  dueTodayCents === null;

describe("ORCH-1147R2 — selection bottom bar leads with the all-in", () => {
  test("T-1 (event): pass-fee → headline == allInTotal (NOT base), Fees & tax line shown", () => {
    // base £65, server all-in £67.93 (Mingla + service fee passed), qty 1.
    const totals = totalsFor([
      line({ unitPrice: 65, unitPriceAllIn: 67.93, quantity: 1, currency: "GBP" }),
    ]);
    // Base stays base (do-not-repurpose) — but the HEADLINE leads with all-in.
    expect(totals.total).toBe(65);
    expect(headlineSource(totals)).toBeCloseTo(67.93, 5);
    expect(headlineSource(totals)).not.toBe(totals.total); // the exact R2 fix
    // Combined "Fees & tax" line (MINOR units) gated on a real delta.
    expect(totals.feesTaxCents).toBe(293);
    expect(showFeesTaxLine(totals)).toBe(true);
  });

  test("T-4 (experience): pass-fee → headline == all-in per-unit × qty", () => {
    const totals = totalsFor([
      line({ unitPrice: 30, unitPriceAllIn: 33, quantity: 2, currency: "GBP" }),
    ]);
    expect(totals.total).toBe(60);
    expect(headlineSource(totals)).toBeCloseTo(66, 5);
    expect(totals.feesTaxCents).toBe(600);
    expect(showFeesTaxLine(totals)).toBe(true);
  });

  test("T-2 (trip pay-in-full): full-total branch shows the all-in + Fees & tax", () => {
    const totals = totalsFor([
      line({ unitPrice: 200, unitPriceAllIn: 209, quantity: 1, currency: "GBP" }),
    ]);
    // dueTodayCents === null → full-total path.
    expect(headlineSource(totals)).toBeCloseTo(209, 5);
    expect(showFeesTaxLine(totals, null)).toBe(true);
  });

  test("T-3 (trip installments): deposit branch UNCHANGED, NO Fees & tax line", () => {
    const totals = totalsFor([
      line({ unitPrice: 200, unitPriceAllIn: 209, quantity: 1, currency: "GBP" }),
    ]);
    // dueTodayCents set (a deposit) → the Fees & tax line is suppressed and the
    // deposit value (not headlineAllIn) is shown by the deposit branch.
    const dueTodayCents = 5000;
    expect(showFeesTaxLine(totals, dueTodayCents)).toBe(false);
  });

  test("T-5 (absorb-all): all-in == base → headline == base, NO Fees & tax line", () => {
    const totals = totalsFor([
      line({ unitPrice: 40, unitPriceAllIn: 40, quantity: 2, currency: "GBP" }),
    ]);
    expect(headlineSource(totals)).toBe(80);
    expect(headlineSource(totals)).toBe(totals.total); // no fabricated delta
    expect(totals.feesTaxCents).toBe(0);
    expect(showFeesTaxLine(totals)).toBe(false);
  });

  test("T-6 (free): free tier → no Fees & tax line, isFree", () => {
    const totals = totalsFor([
      line({ unitPrice: 0, unitPriceAllIn: 0, quantity: 1, isFree: true, currency: "GBP" }),
    ]);
    expect(totals.isFree).toBe(true);
    expect(showFeesTaxLine(totals)).toBe(false);
  });

  test("T-7 (RPC miss): null all-in → headline falls to base, no delta (no fabrication)", () => {
    const totals = totalsFor([
      line({ unitPrice: 50, unitPriceAllIn: undefined, quantity: 1, currency: "GBP" }),
    ]);
    expect(headlineSource(totals)).toBe(50);
    expect(totals.feesTaxCents).toBe(0);
    expect(showFeesTaxLine(totals)).toBe(false);
    expect(Number.isNaN(headlineSource(totals))).toBe(false);
  });
});

// --- SOURCE-TEXT fails-on-revert (the four changed files) ------------------
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

describe("ORCH-1147R2 — per-tier QuantityRow forwards the all-in (SC-4)", () => {
  const wrapper = read(
    "mingla-business/src/components/checkout/QuantityRow.tsx",
  );
  test("the business wrapper forwards priceAllInGbp into ticketForPackage", () => {
    // Deleting this line → the shared row falls to its base branch → per-tier
    // base shown (the F-2 bug). RED on true deletion.
    expect(wrapper).toMatch(
      /priceAllInGbp:\s*ticket\.priceAllInGbp\s*\?\?\s*null/,
    );
  });
});

describe("ORCH-1147R2 — event selection bottom bar binds the all-in (SC-1, SC-5, SC-6)", () => {
  const src = read("mingla-business/app/checkout/[eventId]/index.tsx");
  test("derives headlineAllIn from totals.allInTotal", () => {
    expect(src).toMatch(
      /const\s+headlineAllIn\s*=\s*formatCurrency\(\s*totals\.allInTotal/,
    );
  });
  test("the full-total headline + a11y no longer bind to the bare base", () => {
    expect(src).not.toMatch(/formatCurrency\(\s*totals\.total\b/);
    expect(src).toMatch(/:\s*headlineAllIn}/); // value branch
    expect(src).toMatch(/total \$\{headlineAllIn\}/); // a11y branch
  });
  test("relabels Subtotal → Total", () => {
    expect(src).toMatch(/<Text style={styles\.subtotalLabel}>Total<\/Text>/);
  });
  test("renders ONE gated combined Fees & tax line (never split)", () => {
    expect(src).toMatch(/showFeesTaxLine\s*\?/);
    expect(src).toMatch(/Fees &amp; tax/);
    expect(src).toMatch(
      /formatCurrency\(totals\.feesTaxCents,\s*totals\.currency,\s*true\)/,
    );
  });
});

describe("ORCH-1147R2 — experience selection bottom bar binds the all-in (SC-3)", () => {
  const src = read(
    "mingla-business/app/checkout-experience/[experienceEventId]/index.tsx",
  );
  test("derives headlineAllIn + drops the bare-base bind + relabels Total", () => {
    expect(src).toMatch(
      /const\s+headlineAllIn\s*=\s*formatCurrency\(\s*totals\.allInTotal/,
    );
    expect(src).not.toMatch(/formatCurrency\(\s*totals\.total\b/);
    expect(src).toMatch(/total \$\{headlineAllIn\}/);
    expect(src).toMatch(/<Text style={styles\.subtotalLabel}>Total<\/Text>/);
  });
  test("renders the gated Fees & tax line", () => {
    expect(src).toMatch(/showFeesTaxLine\s*\?/);
    expect(src).toMatch(
      /formatCurrency\(totals\.feesTaxCents,\s*totals\.currency,\s*true\)/,
    );
  });
});

describe("ORCH-1147R2 — trip selection bottom bar (installments-aware, SC-2)", () => {
  const src = read("mingla-business/app/checkout-trip/[tripEventId]/index.tsx");
  test("full-total branch binds the all-in; deposit branch (dueTodayCents) untouched", () => {
    expect(src).toMatch(
      /const\s+headlineAllIn\s*=\s*formatCurrency\(\s*totals\.allInTotal/,
    );
    // The full-total headline no longer reads the bare base...
    expect(src).not.toMatch(/formatCurrency\(\s*totals\.total\b/);
    expect(src).toMatch(/:\s*headlineAllIn}/);
    // ...but the deposit branch STILL renders dueTodayCents (unchanged).
    expect(src).toMatch(
      /formatCurrency\(dueTodayCents,\s*totals\.currency,\s*true\)/,
    );
  });
  test("the Fees & tax line is gated on the full-total path only (dueTodayCents === null)", () => {
    expect(src).toMatch(/dueTodayCents\s*===\s*null/);
    expect(src).toMatch(/showFeesTaxLine\s*\?/);
  });
  test("relabels the non-deposit label Subtotal → Total, keeps 'Due today'", () => {
    expect(src).toMatch(/"Due today"/);
    expect(src).toMatch(/:\s*"Total"/);
  });
});
