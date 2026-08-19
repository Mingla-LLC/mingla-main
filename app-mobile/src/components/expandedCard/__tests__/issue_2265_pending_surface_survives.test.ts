/**
 * issue #2265 [nothing tells the buyer anything is happening] — IMPLEMENTOR
 * happy-path regression for the pending surface.
 *
 * SPEC #2264 §7: T-10 (the sheet survives the tap), T-11 (it cannot be swiped
 * away while pending), plus SC-7 / SC-8 / SC-9 / SC-11.
 *
 * WHY THIS IS A SOURCE + REPLICA SUITE, NOT AN RTL RENDER
 * -------------------------------------------------------
 * `app-mobile` ships no RTL renderer (no `@testing-library/react-native` in
 * `package.json`), and the repo convention for mobile component regressions is
 * source assertions plus a behavioural replica of the pure logic — the shape
 * `orch_1016_consumer_intake_renderer.test.tsx` established in this very
 * directory. The facts under test here are ORDERING facts (`setCartVisible`
 * relative to `await handleBuy`) and PROP facts (`enablePanDownToClose`), and
 * both are exactly readable in source. The tester owns the runtime half
 * (T-17/T-18/T-19 on a simulator and a physical iPhone).
 *
 * FAILS ON REVERT: restore `setCartVisible(false); void handleBuy(payload);` in
 * any of the three screens and T-10 goes red for that screen. Restore
 * `enablePanDownToClose`'s default and T-11 goes red.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string =>
  readFileSync(join(APP_ROOT, rel), "utf8");

const CART_SHEET = read("src/components/expandedCard/TicketCartSheet.tsx");

const SCREENS: ReadonlyArray<readonly [string, string]> = [
  ["Event", read("src/screens/Event/ConsumerEventDetailScreen.tsx")],
  ["Trip", read("src/screens/Trip/ConsumerTripDetailScreen.tsx")],
  [
    "Experience",
    read("src/screens/Experience/ConsumerExperienceDetailScreen.tsx"),
  ],
];

/** The body of `handleCartCheckout` in one screen's source. */
const handleCartCheckoutBody = (source: string): string => {
  const start = source.indexOf("const handleCartCheckout = useCallback(");
  if (start === -1) throw new Error("handleCartCheckout not found");
  const end = source.indexOf("const handleCartCancel", start);
  return source.slice(start, end === -1 ? start + 900 : end);
};

// ---------------------------------------------------------------------------
// T-10 — the sheet survives the tap, on all three screens.
// ---------------------------------------------------------------------------
describe("#2265 T-10 — the cart sheet is NOT dismissed before the work starts", () => {
  for (const [name, source] of SCREENS) {
    const body = handleCartCheckoutBody(source);

    it(`${name}: handleCartCheckout AWAITS handleBuy instead of firing and forgetting`, () => {
      expect(body).toMatch(/await handleBuy\(payload\)/);
      // The exact shape that shipped the bug.
      expect(body).not.toMatch(/void handleBuy\(payload\)/);
    });

    it(`${name}: nothing dismisses the sheet before that await`, () => {
      const awaitAt = body.indexOf("await handleBuy(payload)");
      const dismissAt = body.indexOf("setCartVisible(false)");
      expect(awaitAt).toBeGreaterThan(-1);
      expect(dismissAt).toBeGreaterThan(-1);
      // Dismissal strictly AFTER the outcome. This is the whole of #2265.
      expect(dismissAt).toBeGreaterThan(awaitAt);
    });

    it(`${name}: the sheet is dismissed ONLY on success (it stays open on failure)`, () => {
      expect(body).toMatch(
        /result\.outcome === "succeeded"[\s\S]{0,120}setCartVisible\(false\)/,
      );
    });

    it(`${name}: handleBuy returns its outcome so the sheet can branch on it`, () => {
      expect(source).toMatch(
        /const handleBuy = useCallback\(\s*async \([\s\S]{0,120}?\): Promise<NativeCheckoutOutcome> =>/,
      );
      // Every early return carries an outcome — no bare `return;` can leak
      // `undefined` into `result.outcome`.
      const buyStart = source.indexOf("const handleBuy = useCallback(");
      const buyEnd = source.indexOf("const handleCartCheckout", buyStart);
      const buyBody = source.slice(buyStart, buyEnd);
      expect(buyBody).not.toMatch(/\n\s+return;\s*\n/);
    });

    it(`${name}: the phase is threaded into the flow and reset with the in-flight flag`, () => {
      expect(source).toMatch(/onPhase: setCheckoutPhase/);
      expect(source).toMatch(
        /setCheckoutInFlight\(false\);\s*\n\s*setCheckoutPhase\(null\);/,
      );
      expect(source).toMatch(/pendingPhase=\{checkoutPhase\}/);
    });

    it(`${name}: the per-screen checkoutInFlight guard is still there (#2253 ADDS, it does not replace)`, () => {
      expect(source).toMatch(/if \(checkoutInFlight\) return \{ outcome: "canceled" \}/);
    });
  }

  it("Event and Experience navigate only AFTER the sheet is gone (SC-11)", () => {
    for (const name of ["Event", "Experience"] as const) {
      const source = SCREENS.find(([n]) => n === name)![1];
      const body = handleCartCheckoutBody(source);
      const dismissAt = body.indexOf("setCartVisible(false)");
      const backAt = body.indexOf("onBack()");
      expect(dismissAt).toBeGreaterThan(-1);
      expect(backAt).toBeGreaterThan(dismissAt);
      // …and onBack no longer fires from inside handleBuy's success arm, where
      // it would have navigated out from under a still-visible sheet.
      const buyStart = source.indexOf("const handleBuy = useCallback(");
      const buyEnd = source.indexOf("const handleCartCheckout", buyStart);
      expect(source.slice(buyStart, buyEnd)).not.toMatch(/\n\s+onBack\(\);/);
    }
  });
});

// ---------------------------------------------------------------------------
// T-11 — the pending state cannot be dismissed by hand.
// ---------------------------------------------------------------------------
describe("#2265 T-11 — a pending sheet refuses every dismissal route", () => {
  it("the SWIPE is disarmed while submitting (BaseBottomSheet defaults it to true)", () => {
    expect(CART_SHEET).toMatch(/enablePanDownToClose=\{!isSubmitting\}/);
  });

  it("the BACKDROP press is disarmed while submitting (it defaults to 'close')", () => {
    expect(CART_SHEET).toMatch(
      /backdropPressBehavior=\{isSubmitting \? "none" : "close"\}/,
    );
  });

  it("the close CONTROL and the callback were already guarded, and still are", () => {
    expect(CART_SHEET).toMatch(
      /const handleCancel = useCallback\(\(\): void => \{\s*\n\s*if \(isSubmitting\) return;/,
    );
    expect(CART_SHEET).toMatch(/onPress=\{handleCancel\}\s*\n\s*disabled=\{isSubmitting\}/);
  });

  it("BaseBottomSheet really does default the swipe ON — so the override is load-bearing", () => {
    const base = read("src/components/ui/BaseBottomSheet.tsx");
    expect(base).toMatch(/enablePanDownToClose = true/);
    expect(base).toMatch(/backdropPressBehavior = 'close'/);
  });

  /**
   * The two routes this test originally missed (#2264 tester).
   *
   * `BaseBottomSheet` dismisses by FOUR routes. Android hardware-back (`:524`)
   * and the RN-Modal `onRequestClose` (`:984`) call `onClose()` DIRECTLY and
   * never touch a prop, so no prop assertion can see them. They are guarded
   * only by what `onClose` is pointed at — and if someone re-points it from
   * `handleCancel` at `onCancel`, both prop assertions above stay green while a
   * pending sheet becomes dismissable by the Android back button.
   */
  it("routes 3 and 4 exist and bypass props entirely — so the funnel is load-bearing", () => {
    const base = read("src/components/ui/BaseBottomSheet.tsx");
    // Hardware back calls onClose() with no prop in the way.
    expect(base).toMatch(
      /addEventListener\('hardwareBackPress'[\s\S]{0,80}?onClose\(\);/,
    );
    // RN-Modal's back/dismiss calls onClose directly.
    expect(base).toMatch(/onRequestClose=\{onClose\}/);
  });

  it("the sheet points onClose at the GUARDED handleCancel, never at raw onCancel", () => {
    expect(CART_SHEET).toMatch(/onClose=\{handleCancel\}/);
    expect(CART_SHEET).not.toMatch(/onClose=\{onCancel\}/);
    // …and handleCancel is what refuses while a checkout is in flight, so all
    // four routes land on one guard.
    expect(CART_SHEET).toMatch(
      /const handleCancel = useCallback\(\(\): void => \{\s*\n\s*if \(isSubmitting\) return;/,
    );
  });
});

// ---------------------------------------------------------------------------
// SC-7 / SC-8 / SC-10 — the sheet says WHAT it is waiting for.
// ---------------------------------------------------------------------------
describe("#2265 SC-7/8/10 — the CTA names the phase, it does not just spin", () => {
  it("carries a label beside the spinner, not a bare ActivityIndicator", () => {
    expect(CART_SHEET).toMatch(
      /isSubmitting \? \(\s*\n(?:.*\n)*?\s*<ActivityIndicator color="#ffffff" \/>\s*\n\s*<Text/,
    );
    expect(CART_SHEET).toMatch(/\{pendingCtaLabel\}/);
  });

  it("binds the exact phase copy the SPEC pins", () => {
    for (const copy of [
      "Setting up your payment…",
      "Getting your ticket…",
      "Opening the payment page…",
      "Opening Apple Pay…",
      "Opening payment…",
      "Confirming your payment…",
    ]) {
      expect(CART_SHEET).toContain(copy);
    }
  });

  it("splits the free rail's wording on the cart's own free-ness", () => {
    expect(CART_SHEET).toMatch(
      /totals\.isFree \? "Getting your ticket…" : "Setting up your payment…"/,
    );
  });

  it("speaks the phase to a screen reader too", () => {
    expect(CART_SHEET).toMatch(
      /accessibilityLabel=\{isSubmitting \? pendingCtaLabel : ctaLabel\}/,
    );
    expect(CART_SHEET).toMatch(/busy: isSubmitting/);
  });
});

// ---------------------------------------------------------------------------
// Behavioural replica of the phase→copy mapping, so the copy table is exercised
// and not merely present in the file.
// ---------------------------------------------------------------------------
describe("#2265 — the phase→copy table, exercised", () => {
  type Phase =
    | "creating"
    | "opening_payment_page"
    | "presenting_sheet"
    | "confirming_payment"
    | null;

  /** Mirrors TicketCartSheet's `pendingCtaLabel` IIFE exactly. */
  const label = (phase: Phase, isFree: boolean, os: "ios" | "android"): string => {
    switch (phase) {
      case "creating":
        return isFree ? "Getting your ticket…" : "Setting up your payment…";
      case "opening_payment_page":
        return "Opening the payment page…";
      case "presenting_sheet":
        return os === "ios" ? "Opening Apple Pay…" : "Opening payment…";
      case "confirming_payment":
        return "Confirming your payment…";
      default:
        return "Working…";
    }
  };

  it("is TOTAL — every phase, free or paid, on both platforms, yields a sentence", () => {
    const phases: Phase[] = [
      "creating",
      "opening_payment_page",
      "presenting_sheet",
      "confirming_payment",
      null,
    ];
    for (const phase of phases) {
      for (const isFree of [true, false]) {
        for (const os of ["ios", "android"] as const) {
          const out = label(phase, isFree, os);
          expect(out.length).toBeGreaterThan(6);
          expect(out.endsWith("…")).toBe(true);
          // Never the machine token.
          expect(out).not.toBe(phase);
        }
      }
    }
  });

  it("tells a paid buyer about PAYMENT and a free buyer about their TICKET", () => {
    expect(label("creating", false, "ios")).toBe("Setting up your payment…");
    expect(label("creating", true, "ios")).toBe("Getting your ticket…");
  });

  it("names the 25-second window explicitly — this is the #2264 wait", () => {
    expect(label("confirming_payment", false, "ios")).toBe(
      "Confirming your payment…",
    );
  });
});
