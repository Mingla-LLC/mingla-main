// ORCH-1167-R3 [event-page pills + button polish] — implementor-owned regression
// for the 4 Seth-directed UI revisions:
//   1. date/time is its OWN FULL-WIDTH row (not a compact chip) on both surfaces;
//   2. EVERY pill carries the SOLID accent fill (was outlined/translucent);
//   3. the buy/get-tickets button is ALWAYS tappable at 0 selected (routes to
//      cart), while the genuinely non-purchasable CTA states stay gated;
//   4. the consumer floating bar clears the gorhom overshoot (no off-screen bleed).
//
// Change 3 is asserted as a RUNTIME-LOGIC contract over the pure resolveOfferingCta
// + the exact enable predicate the box/bar now use. Changes 1/2/4 are SOURCE-
// STRUCTURAL contracts (they are layout/style — the shared body imports react-
// native and cannot mount under node-env jest; the strict-grep 9-section gate
// already pins ORDER, this pins the R3 deltas). Each assertion is fails-on-revert.
//
// FAILS-ON-REVERT (proven by TRUE LINE DELETION in the implementation report):
//   • Change 3 — re-add `&& (kind === "waitlist" || selectedQty > 0)` to the box
//     OR bar enable predicate → the "tappable at 0 selected" logic test FAILS.
//   • Change 3 — re-add `if (!anySelected) return;` in either host's
//     handleProceedToCart → the "host opens cart at 0 selected" assertion FAILS.
//   • Change 2 — restore the `accent ? accentWash : surface.card` Pill branch →
//     the "all pills solid fill" assertion FAILS.
//   • Change 1 — remove the full-width `dateRow` (testID orch-1167-date-row) →
//     the "date row is full width" assertion FAILS.
//   • Change 4 — drop the gorhom-overshoot lift on the consumer float wrapper →
//     the "consumer float bar lifted off the bottom" assertion FAILS.

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Import the PURE CTA resolver + ticket type DIRECTLY from their module files
// (not the @mingla/offering-rendering barrel, which pulls react-native and breaks
// node-env jest). resolveOfferingCta + offeringCta.ts are react-native-free.
import { resolveOfferingCta } from "../offeringCta";
import type { PublicTicketProps } from "../types";

const repoRoot = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const BODY = "packages/offering-rendering/EventOfferingBody.tsx";
const WEB = "mingla-business/src/components/event/PublicEventPage.tsx";
const CONSUMER = "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx";

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// A minimal sellable paid tier (on-sale).
const tier = (over: Partial<PublicTicketProps> = {}): PublicTicketProps =>
  ({
    id: "t1",
    name: "GA",
    description: null,
    priceGbp: 20,
    priceAllInGbp: 22,
    currency: "USD",
    isFree: false,
    isUnlimited: true,
    capacity: null,
    visibility: "visible",
    passwordProtected: false,
    password: null,
    saleStartAt: null,
    saleEndAt: null,
    approvalRequired: false,
    waitlistEnabled: false,
    availableAt: "online",
    displayOrder: 0,
    ...over,
  }) as PublicTicketProps;

// The EXACT enable predicate the box + bar now use post-R3 (change 3): tappable +
// not submitting, with NO empty-selection gate. Mirrors EventOfferingBody.
const buttonEnabled = (
  cta: ReturnType<typeof resolveOfferingCta>,
  submitting: boolean,
): boolean => cta.tappable && !submitting;

describe("ORCH-1167-R3 — change 3: buy button always active at 0 selected", () => {
  it("on-sale (buy) CTA is tappable + enabled with ZERO selected", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [tier()],
      currency: "USD",
    });
    expect(cta.kind).toBe("buy");
    expect(cta.tappable).toBe(true);
    // selectedQty = 0 → still enabled (the empty-selection disable was removed).
    expect(buttonEnabled(cta, false)).toBe(true);
  });

  it("free CTA is tappable + enabled with ZERO selected", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [tier({ isFree: true, priceGbp: null, priceAllInGbp: null })],
      currency: "USD",
    });
    expect(cta.kind).toBe("free");
    expect(buttonEnabled(cta, false)).toBe(true);
  });

  it("submitting still disables the button (only the empty-selection block was lifted)", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [tier()],
      currency: "USD",
    });
    expect(buttonEnabled(cta, true)).toBe(false);
  });

  it.each([
    ["not-bookable", { variant: "published" as const, bookable: false }],
    ["cancelled", { variant: "cancelled" as const, bookable: true }],
    ["past", { variant: "past" as const, bookable: true }],
    ["pre-sale", { variant: "pre-sale" as const, bookable: true }],
  ])(
    "the genuinely non-purchasable state (%s) stays GATED at 0 selected",
    (_label, { variant, bookable }) => {
      const cta = resolveOfferingCta({
        variant,
        bookable,
        tickets: [tier()],
        currency: "USD",
      });
      expect(cta.tappable).toBe(false);
      expect(buttonEnabled(cta, false)).toBe(false);
    },
  );

  it("sold-out (no waitlist) stays GATED; sold-out WITH waitlist stays tappable", () => {
    const soldOut = tier({ capacity: 0, isUnlimited: false });
    const gated = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [soldOut],
      currency: "USD",
    });
    expect(gated.tappable).toBe(false);
    const waitlistable = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [tier({ capacity: 0, isUnlimited: false, waitlistEnabled: true })],
      currency: "USD",
    });
    expect(waitlistable.kind).toBe("waitlist");
    expect(buttonEnabled(waitlistable, false)).toBe(true);
  });

  it("door-only stays GATED at 0 selected", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [tier({ availableAt: "door" })],
      currency: "USD",
    });
    expect(cta.tappable).toBe(false);
    expect(buttonEnabled(cta, false)).toBe(false);
  });
});

describe("ORCH-1167-R3 — source-structural deltas (changes 1, 2, 3-host, 4)", () => {
  const body = stripComments(read(BODY));
  const web = stripComments(read(WEB));
  const consumer = stripComments(read(CONSUMER));

  it("change 1 — date/time is its OWN FULL-WIDTH row (testID orch-1167-date-row)", () => {
    expect(body).toMatch(/testID="orch-1167-date-row"/);
    // The dateRow style spans the full content width.
    expect(body).toMatch(/dateRow:\s*\{[^}]*width:\s*"100%"[^}]*\}/s);
    // The date no longer renders inside a compact MetaChip component.
    expect(body).not.toMatch(/<MetaChip\b/);
  });

  it("change 2 — EVERY pill carries the solid accent fill (no outlined card branch)", () => {
    // The Pill renders the accentWash fill unconditionally; the old
    // `accent ? accentWash : surface.card` ternary is gone.
    expect(body).toMatch(
      /styles\.pill,\s*\{\s*backgroundColor:\s*palette\.accentWash/s,
    );
    expect(body).not.toMatch(/accent\s*\?\s*\{\s*backgroundColor:\s*palette\.accentWash/s);
  });

  it("change 3 (box/bar) — the empty-selection enable gate is removed in the body", () => {
    // Neither the box nor the bar still ANDs in `selectedQty > 0` (or the
    // `kind === "waitlist" || selectedQty > 0` clause) on the enable predicate.
    expect(body).not.toMatch(/selectedQty\s*>\s*0\s*\)?\s*;/);
    expect(body).toMatch(/proceedEnabled\s*=\s*ctaActionable\s*&&\s*!submitting\s*;/s);
    expect(body).toMatch(/enabled\s*=\s*cta\.tappable\s*&&\s*!submitting\s*;/s);
  });

  it("change 3 (hosts) — neither host early-returns on empty selection", () => {
    // The `if (!anySelected) return;` empty-pick guard was removed from BOTH
    // handleProceedToCart implementations (the waitlist branch + not-bookable
    // toast guards remain).
    expect(web).not.toMatch(/if\s*\(!anySelected\)\s*return;/);
    expect(consumer).not.toMatch(/if\s*\(!anySelected\)\s*return;/);
  });

  it("change 4 — the consumer float bar is lifted off the bottom (no off-screen bleed)", () => {
    // The wrapper's `bottom` is computed from the gorhom overshoot + home-
    // indicator floor + float gap (the proven trip math), NOT a flat `bottom: 0`.
    expect(consumer).toMatch(/SHEET_BOTTOM_OVERSHOOT\s*=\s*63/);
    expect(consumer).toMatch(/floatBarBottom\s*=/);
    expect(consumer).toMatch(/styles\.nativeFloatWrap,\s*\{\s*bottom:\s*floatBarBottom\s*\}/s);
    // The static wrapper style no longer pins `bottom: 0`.
    expect(consumer).not.toMatch(/nativeFloatWrap:\s*\{[^}]*bottom:\s*0[^}]*\}/s);
  });
});
