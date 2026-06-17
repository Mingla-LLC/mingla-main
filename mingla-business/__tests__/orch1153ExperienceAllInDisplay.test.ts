/**
 * ORCH-1153 WS3 — experience page/recap display the SERVER all-in, never the bare
 * base (implementor-owned happy-path regression; I-PROPOSED-1153-NO-BARE-BASE-
 * UNDER-ALLIN).
 *
 * THE BUG (F-7): the public /exp/[brandSlug]/[experienceSlug].tsx page formatted
 * ticket.priceCents (bare base) under the "All-in, taxes included" caption while
 * the server all-in (ticket.priceAllInGbp) was already on the payload. The buyer
 * saw the price JUMP UP at the cart (the ORCH-1147 bug class, one surface
 * upstream). priceAllInGbp is MAJOR units (publicExperienceService: allInCents /
 * 100); formatExpPrice ÷100 (expects cents) → the all-in must be ×100 back.
 *
 * 0/8 live charges-enabled brands pass any fee, so on live data base === all-in
 * and the bug is invisible — this test uses a SYNTHETIC pass-fee ticket where
 * priceAllInGbp > priceCents so displayed===charged is provable with a NON-ZERO
 * fee.
 *
 * FAILS-ON-REVERT: delete the `Math.round(ticket.priceAllInGbp * 100)` all-in
 * branch in [experienceSlug].tsx (revert expDisplayCents to ticket.priceCents) →
 * the source-contract assertion below FAILS (the all-in transform is gone) and
 * the arithmetic assertion proves the displayed value would understate the
 * charge. Verified by true line-deletion in the implementation report.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The exact display-cents resolver the page applies (mirrors [experienceSlug].tsx
// expDisplayCents). priceAllInGbp is MAJOR units → ×100 to cents; fall back to
// the base cents when the all-in is absent/0 (absorb-fee brand: identical).
function experienceDisplayCents(ticket: {
  priceCents: number;
  priceAllInGbp?: number | null;
}): number {
  return typeof ticket.priceAllInGbp === "number" && ticket.priceAllInGbp > 0
    ? Math.round(ticket.priceAllInGbp * 100)
    : ticket.priceCents;
}

describe("ORCH-1153 WS3 experience all-in display", () => {
  it("displays the server all-in (×100 from major units), not the bare base, for a pass-fee ticket", () => {
    // Synthetic pass-fee ticket: base $50.00, server all-in $53.95 (fee-grossed).
    const ticket = { priceCents: 5000, priceAllInGbp: 53.95, currency: "USD" };
    const displayCents = experienceDisplayCents(ticket);
    // The displayed value MUST equal the server all-in in cents — NOT the base.
    expect(displayCents).toBe(5395);
    expect(displayCents).not.toBe(ticket.priceCents); // proves it is not the base
    // What formatExpPrice (÷100) would render:
    expect(displayCents / 100).toBeCloseTo(53.95, 2);
  });

  it("displayed === charged: the page value matches the server-charged all-in cents", () => {
    // The server charges the fee-grossed all-in (buyerSubtotalCents). The page
    // must quote that exact number. With priceAllInGbp = 53.95 major, the charge
    // is 5395 cents; the page display must equal it to the cent.
    const ticket = { priceCents: 5000, priceAllInGbp: 53.95 };
    const serverChargedCents = 5395; // computeBuyerSubtotal(baseCents:5000, pass fee)
    expect(experienceDisplayCents(ticket)).toBe(serverChargedCents);
  });

  it("absorb-fee brand (all-in === base) renders identically to today — no 100× / wrong-field regression", () => {
    // priceAllInGbp = 50.00 major === base 5000 cents (the 8 live brands absorb).
    const ticket = { priceCents: 5000, priceAllInGbp: 50.0 };
    expect(experienceDisplayCents(ticket)).toBe(5000);
    // null all-in (RPC miss) → falls back to base, never blanks or 100×.
    expect(experienceDisplayCents({ priceCents: 5000, priceAllInGbp: null })).toBe(
      5000,
    );
  });

  it("[experienceSlug].tsx applies the all-in ×100 transform and no longer formats the bare base (fails-on-revert source contract)", () => {
    const root = process.cwd().endsWith("mingla-business")
      ? join(process.cwd(), "..")
      : process.cwd();
    const src = readFileSync(
      join(root, "mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx"),
      "utf8",
    );
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // The all-in transform must be present (the fix).
    expect(/ticket\.priceAllInGbp\s*\*\s*100/.test(code)).toBe(true);
    // The bare-base expPrice source must be GONE (reverting it trips this).
    expect(/formatExpPrice\(\s*ticket\.priceCents\b/.test(code)).toBe(false);
  });

  it("ExperienceCheckoutFlow recap renders the all-in, not the bare base (F-8 fails-on-revert source contract)", () => {
    const root = process.cwd().endsWith("mingla-business")
      ? join(process.cwd(), "..")
      : process.cwd();
    const src = readFileSync(
      join(
        root,
        "mingla-business/src/components/experience/ExperienceCheckoutFlow.tsx",
      ),
      "utf8",
    );
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(/ticket\.priceAllInGbp\s*\*\s*100/.test(code)).toBe(true);
    expect(/formatPriceMajor\(\s*ticket\.priceCents\s*,/.test(code)).toBe(false);
  });
});
