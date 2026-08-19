/**
 * issue #2264 [abandoned payment told the wrong story] + #2265 [nothing tells
 * the buyer anything is happening] — TESTER ADVERSARIAL.
 *
 * DIFFERENT ANGLE FROM THE IMPLEMENTOR.
 * -------------------------------------
 * The implementor's suite proves the flow does the RIGHT thing with the
 * server's EXPECTED replies: the four terminal codes, `null`, `""`, `"garbage"`,
 * a spent budget, a transport failure. Every one of those is an input someone
 * anticipated. This suite attacks the four places where #2264's own SPEC
 * substituted a weaker guarantee than it asked for, and feeds each of them the
 * inputs nobody anticipated.
 *
 * 1. THE RETURN-LEG MAPPER IS HELD TO A LOWER BAR THAN THE CREATE-LEG MAPPER.
 *    #2229's tester-adversarial suite pinned, in this very file's sibling and
 *    against this very module, that "prototype keys resolve as data, not as
 *    inherited members" — with the comment: *"The token classes are Sets today.
 *    If anyone refactors them to plain objects, `constructor` starts resolving
 *    to a function and the mapper silently mis-routes. Pinned here so that
 *    refactor cannot land quietly."* #2264 then added a SECOND mapper to the
 *    SAME file built on a plain object literal (SPEC DEVIATION-2), and the
 *    existing pin does not reach it. §4.1 rule 5 says "anything else, including
 *    `null`" must degrade to CHECKOUT_AWAITING_CONFIRMATION_MESSAGE. These
 *    tests hold the new mapper to the identical bar as the old one.
 *
 * 2. THE TWO NATIVE MAPPERS ARE ASSERTED EQUAL ONLY ON THE HAPPY CODES.
 *    The business parity suite compares the four constants and the four routing
 *    rules. It cannot see that the consumer mapper is a lookup table and the
 *    business mapper is an if-chain, so it cannot see them diverge on any input
 *    outside those four. Consumer/business copy parity is a MANUAL parity per
 *    SPEC §3 surface 4; this asserts it under hostile input, not happy input.
 *
 * 3. `NATIVE_PAYSTACK_RETURN_MESSAGES` IS A TRANSCRIPTION, NOT A DERIVATION.
 *    SPEC DEVIATION-1 moved the four constants out of NATIVE_CHECKOUT_MESSAGES
 *    into a sibling array, and substituted "my own T-3 walks the sibling array"
 *    as the replacement guarantee. A walker over a hand-maintained array only
 *    covers what someone remembered to append. This derives the mapper's ACTUAL
 *    reachable codomain by running it, and requires the array to equal it.
 *
 * 4. THE #2250 ORDERING RULE IS PINNED BY A COMMENT.
 *    `I-PROPOSED-PAYSTACK-ABANDONED-ONLY-AFTER-BROWSER-CLOSES` is the rule that
 *    makes consuming the terminal token safe at all (INVESTIGATE F-6), and the
 *    implementor pinned it with a verbatim comment. A comment survives a
 *    restructure that moves the poll above the browser await — which is exactly
 *    what #2250 will attempt. This asserts the ORDERING ITSELF, in source
 *    position, so the restructure reds the lane rather than the buyer.
 *
 * Plus: the new CI gate's advertised coverage is compared against its real
 * coverage, because SPEC §9 claims it reaches rails it does not reach (#2289).
 *
 * FAILS ON REVERT — measured, not asserted:
 *   • make `PAYSTACK_RETURN_MESSAGE_BY_CODE` prototype-bearing again (i.e. drop
 *     an own-property guard / `Object.create(null)` base) → the four hostile
 *     input cases in "the return-leg mapper survives the same hostile inputs"
 *     go red.
 *   • move the `pollPaystackOrder` call above the `openBrowserAsync` await in
 *     `followPaystackHandoff` → "the poll is positioned AFTER the browser
 *     await" goes red.
 *   • delete `enablePanDownToClose` / `backdropPressBehavior` / the
 *     `isSubmitting` early-return in `handleCancel` → the corresponding
 *     dismissal-route case goes red (one per route, so the suite localises
 *     WHICH route reopened).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CHECKOUT_ABANDONED_MESSAGE,
  CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
  CHECKOUT_PAYMENT_FAILED_MESSAGE,
  CHECKOUT_PAYMENT_MISMATCH_MESSAGE,
  CHECKOUT_UNAVAILABLE_MESSAGE,
  NATIVE_PAYSTACK_RETURN_MESSAGES,
  nativePaystackReturnMessage,
} from "../checkoutErrorMessages";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const read = (...parts: string[]): string =>
  readFileSync(join(REPO_ROOT, ...parts), "utf8");

const CONSUMER_FLOW = read(
  "app-mobile",
  "src",
  "payments",
  "nativeCheckoutFlow.ts",
);
const BUSINESS_FLOW = read(
  "mingla-business",
  "src",
  "payments",
  "nativeCheckoutFlow.native.ts",
);
const CART_SHEET = read(
  "app-mobile",
  "src",
  "components",
  "expandedCard",
  "TicketCartSheet.tsx",
);
const BASE_SHEET = read(
  "app-mobile",
  "src",
  "components",
  "ui",
  "BaseBottomSheet.tsx",
);
const RESOLVER = read(
  "supabase",
  "functions",
  "_shared",
  "paystackTicketReturnVerify.ts",
);
const GATE = read("scripts", "ci", "check-checkout-status-consumers.sh");

/**
 * Every input a `string | null` parameter can actually receive that nobody
 * writes a routing rule for. The prototype names are the load-bearing half:
 * on a plain object literal `T[code]` resolves them off `Object.prototype` and
 * returns a FUNCTION, which `?? fallback` cannot catch because a function is
 * neither null nor undefined.
 */
const HOSTILE_CODES: readonly string[] = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "",
  " ",
  "garbage",
  "PAYSTACK_CHARGE_ABANDONED",
  "Paystack_Charge_Abandoned",
  "paystack_charge_abandoned ",
  " paystack_charge_abandoned",
  "paystack_charge_abandoned\n",
  "paystack-charge-abandoned",
  "paystack_charge_abandoned; DROP TABLE orders",
  '{"error":"paystack_charge_abandoned"}',
  "<!doctype html><h1>502 Bad Gateway</h1>",
  "Edge Function returned a non-2xx status code",
  "x".repeat(10_000),
];

/** The four codes the SPEC pins as the routed set. */
const ROUTED: ReadonlyArray<readonly [string, string]> = [
  ["paystack_charge_abandoned", CHECKOUT_ABANDONED_MESSAGE],
  ["paystack_charge_failed", CHECKOUT_PAYMENT_FAILED_MESSAGE],
  ["paystack_payment_mismatch", CHECKOUT_PAYMENT_MISMATCH_MESSAGE],
  ["checkout_unavailable", CHECKOUT_UNAVAILABLE_MESSAGE],
];

/**
 * The business app has no `checkoutErrorMessages.ts` (#2229 scoped it out), so
 * its mapper is a module-private if-chain. Re-derive its routing FROM ITS OWN
 * SOURCE rather than importing it, so this test reads the shipped business
 * behaviour rather than a copy of the consumer's.
 */
const businessReturnMessage = (code: string | null): string => {
  const body = /const paystackReturnMessage[\s\S]*?\n};/.exec(BUSINESS_FLOW);
  if (body === null) {
    throw new Error(
      "business paystackReturnMessage not found — the parity target moved",
    );
  }
  const src = body[0];
  for (const [token, message] of ROUTED) {
    // Each arm is `if (code === "<token>") return CONST;` (possibly wrapped).
    const arm = new RegExp(
      `code === "${token}"[\\s\\S]{0,80}?return (CHECKOUT_[A-Z_]+);`,
    ).exec(src);
    if (arm !== null && code === token) {
      void message;
      return arm[1];
    }
  }
  const fallback = /\n\s*return (CHECKOUT_[A-Z_]+);\n};/.exec(src);
  if (fallback === null) {
    throw new Error("business mapper has no unconditional fallback return");
  }
  return fallback[1];
};

/** Constant NAME for a consumer message, so the two mappers are comparable. */
const consumerConstantName = (message: string): string => {
  const byMessage = new Map<string, string>([
    [CHECKOUT_ABANDONED_MESSAGE, "CHECKOUT_ABANDONED_MESSAGE"],
    [CHECKOUT_PAYMENT_FAILED_MESSAGE, "CHECKOUT_PAYMENT_FAILED_MESSAGE"],
    [CHECKOUT_PAYMENT_MISMATCH_MESSAGE, "CHECKOUT_PAYMENT_MISMATCH_MESSAGE"],
    [CHECKOUT_UNAVAILABLE_MESSAGE, "CHECKOUT_UNAVAILABLE_MESSAGE"],
    [
      CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
      "CHECKOUT_AWAITING_CONFIRMATION_MESSAGE",
    ],
  ]);
  return byMessage.get(message) ?? `UNMAPPED(${String(message).slice(0, 40)})`;
};

// ---------------------------------------------------------------------------

describe("#2264 TA-1 — the return-leg mapper meets the SAME bar as the create-leg mapper", () => {
  it("routes the four codes the server actually mints", () => {
    for (const [code, message] of ROUTED) {
      expect(nativePaystackReturnMessage(code)).toBe(message);
    }
  });

  it("degrades null to 'we don't know yet', never to a certainty", () => {
    expect(nativePaystackReturnMessage(null)).toBe(
      CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
    );
  });

  it("the return-leg mapper survives the same hostile inputs #2229 pinned", () => {
    // #2229's suite pins EXACTLY this property against `nativeCheckoutErrorMessage`
    // in this same module, with a comment warning that a refactor to a plain
    // object would let `constructor` resolve to a function. SPEC §4.1 rule 5:
    // "anything else, including null" -> CHECKOUT_AWAITING_CONFIRMATION_MESSAGE.
    const leaked: string[] = [];
    for (const code of HOSTILE_CODES) {
      const actual = nativePaystackReturnMessage(code);
      if (typeof actual !== "string") {
        leaked.push(`${code.slice(0, 24)} -> ${typeof actual}`);
        continue;
      }
      if (actual !== CHECKOUT_AWAITING_CONFIRMATION_MESSAGE) {
        leaked.push(`${code.slice(0, 24)} -> ${actual.slice(0, 40)}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it("never returns anything but a string, for any input the type allows", () => {
    for (const code of [null, ...HOSTILE_CODES]) {
      expect(typeof nativePaystackReturnMessage(code)).toBe("string");
    }
  });

  it("never hands the buyer a machine token or an empty sentence", () => {
    for (const code of [null, ...HOSTILE_CODES, ...ROUTED.map((r) => r[0])]) {
      const message = nativePaystackReturnMessage(code);
      expect(typeof message).toBe("string");
      expect(String(message).trim().length).toBeGreaterThan(20);
      // A routed token must never appear verbatim in what the buyer reads.
      expect(String(message)).not.toContain("paystack_charge");
      expect(String(message)).not.toContain("_");
    }
  });
});

describe("#2264 TA-2 — consumer and business agree on EVERY input, not just the happy four", () => {
  it("both flows route the four codes to the same constant", () => {
    for (const [code, message] of ROUTED) {
      expect(businessReturnMessage(code)).toBe(consumerConstantName(message));
    }
  });

  it("both flows fall back to the same constant on null", () => {
    expect(businessReturnMessage(null)).toBe(
      consumerConstantName(nativePaystackReturnMessage(null)),
    );
  });

  it("both flows agree under hostile input — parity here is MANUAL (SPEC §3 surface 4)", () => {
    const divergent: string[] = [];
    for (const code of HOSTILE_CODES) {
      const business = businessReturnMessage(code);
      const consumer = consumerConstantName(nativePaystackReturnMessage(code));
      if (business !== consumer) {
        divergent.push(`${code.slice(0, 24)}: business=${business} consumer=${consumer}`);
      }
    }
    expect(divergent).toEqual([]);
  });
});

describe("#2264 TA-3 — NATIVE_PAYSTACK_RETURN_MESSAGES is the mapper's REAL codomain", () => {
  it("contains every message the mapper can actually return", () => {
    const reachable = new Set<string>();
    for (const code of [null, ...HOSTILE_CODES, ...ROUTED.map((r) => r[0])]) {
      const message = nativePaystackReturnMessage(code);
      if (typeof message === "string") reachable.add(message);
    }
    for (const message of reachable) {
      expect(NATIVE_PAYSTACK_RETURN_MESSAGES).toContain(message);
    }
  });

  it("contains nothing the mapper can never return — a walker over dead entries proves nothing", () => {
    const reachable = new Set<string>();
    for (const code of [null, ...HOSTILE_CODES, ...ROUTED.map((r) => r[0])]) {
      const message = nativePaystackReturnMessage(code);
      if (typeof message === "string") reachable.add(message);
    }
    for (const message of NATIVE_PAYSTACK_RETURN_MESSAGES) {
      expect(reachable).toContain(message);
    }
  });

  it("covers every terminal code the LIVE server resolver can mint", () => {
    // Derived from the resolver, per SPEC §4.1's instruction to derive rather
    // than transcribe. A new terminal arm on the server reds this immediately.
    const codes = new Set<string>();
    for (const m of RESOLVER.matchAll(/code:\s*"([a-z0-9_]+)"/g)) {
      codes.add(m[1]);
    }
    expect(codes.size).toBeGreaterThan(0);
    for (const code of codes) {
      const message = nativePaystackReturnMessage(code);
      expect(NATIVE_PAYSTACK_RETURN_MESSAGES).toContain(message);
    }
  });

  it("the mismatch string is the ONLY routed one that withholds 'not been charged'", () => {
    // SC-6. Money provably moved on a mismatch; the awaiting string is the
    // honest unknown. Everything else must state that nothing was charged.
    expect(CHECKOUT_PAYMENT_MISMATCH_MESSAGE).not.toMatch(/not been charged/i);
    expect(CHECKOUT_PAYMENT_MISMATCH_MESSAGE).toMatch(/support@usemingla\.com/);
    expect(CHECKOUT_AWAITING_CONFIRMATION_MESSAGE).not.toMatch(
      /not been charged/i,
    );
    expect(CHECKOUT_AWAITING_CONFIRMATION_MESSAGE).toMatch(/don't pay again/i);
    for (const message of [
      CHECKOUT_ABANDONED_MESSAGE,
      CHECKOUT_PAYMENT_FAILED_MESSAGE,
      CHECKOUT_UNAVAILABLE_MESSAGE,
    ]) {
      expect(message).toMatch(/not been charged/i);
    }
  });
});

describe("#2265 TA-4 — EVERY dismissal route BaseBottomSheet exposes is closed while pending", () => {
  /**
   * The implementor's T-11 asserts the two PROPS. `BaseBottomSheet` dismisses
   * by four routes, and the other two never touch a prop: the Android hardware
   * back handler and the RN-Modal `onRequestClose` both call `onClose()`
   * directly. They are safe ONLY because this sheet passes
   * `onClose={handleCancel}` and `handleCancel` early-returns while submitting.
   * Re-point `onClose` at `onCancel` and T-11 stays green while a pending sheet
   * becomes dismissable by hardware back. Pinned here.
   */
  it("route 1 — the swipe gesture is disarmed while submitting", () => {
    expect(CART_SHEET).toMatch(/enablePanDownToClose=\{!isSubmitting\}/);
    // and the default it is overriding really is permissive
    expect(BASE_SHEET).toMatch(/enablePanDownToClose\s*=\s*true/);
  });

  it("route 2 — the backdrop press is disarmed while submitting", () => {
    expect(CART_SHEET).toMatch(
      /backdropPressBehavior=\{isSubmitting \? "none" : "close"\}/,
    );
    expect(BASE_SHEET).toMatch(/backdropPressBehavior\s*=\s*'close'/);
  });

  it("route 3 — the hardware back / onRequestClose route goes through handleCancel", () => {
    // BaseBottomSheet calls onClose() directly from both.
    expect(BASE_SHEET).toMatch(/addEventListener\('hardwareBackPress'/);
    expect(BASE_SHEET).toMatch(/onRequestClose=\{onClose\}/);
    // ...so the sheet MUST hand it the guarded callback, not the raw one.
    expect(CART_SHEET).toMatch(/onClose=\{handleCancel\}/);
    expect(CART_SHEET).not.toMatch(/onClose=\{onCancel\}/);
  });

  it("route 4 — handleCancel itself refuses while submitting", () => {
    expect(CART_SHEET).toMatch(
      /const handleCancel = useCallback\(\(\): void => \{\s*\n\s*if \(isSubmitting\) return;/,
    );
  });

  it("the CTA names the phase rather than spinning silently (SC-7/8/10)", () => {
    for (const copy of [
      "Setting up your payment…",
      "Getting your ticket…",
      "Opening the payment page…",
      "Confirming your payment…",
    ]) {
      expect(CART_SHEET).toContain(copy);
    }
    // and the phase is spoken, not only drawn
    expect(CART_SHEET).toMatch(/accessibilityLabel=\{isSubmitting \? pendingCtaLabel : ctaLabel\}/);
    expect(CART_SHEET).toMatch(/busy: isSubmitting/);
  });
});

describe("#2264 TA-5 — the #2250 ordering rule is pinned by POSITION, not only by a comment", () => {
  /**
   * INVESTIGATE F-6: Paystack reports `abandoned` from initialize onward, so a
   * poll that honours the terminal token while the browser is still OPEN would
   * tell a paying buyer they walked away. Today that is structurally impossible
   * because the poll runs after `openBrowserAsync` resolves. A comment cannot
   * enforce that; source position can.
   */
  const handoff = (() => {
    const m = /async function followPaystackHandoff[\s\S]*?\n}\n/.exec(
      CONSUMER_FLOW,
    );
    if (m === null) throw new Error("followPaystackHandoff not found");
    return m[0];
  })();

  it("followPaystackHandoff awaits the browser before it ever polls", () => {
    const browserAt = handoff.indexOf("openBrowserAsync");
    const pollAt = handoff.indexOf("pollPaystackOrder(");
    expect(browserAt).toBeGreaterThan(-1);
    expect(pollAt).toBeGreaterThan(-1);
    expect(pollAt).toBeGreaterThan(browserAt);
  });

  it("the confirming_payment phase is emitted only after the browser await", () => {
    const browserAt = handoff.indexOf("openBrowserAsync");
    const phaseAt = handoff.indexOf('emitPhase(onPhase, "confirming_payment")');
    expect(phaseAt).toBeGreaterThan(-1);
    expect(phaseAt).toBeGreaterThan(browserAt);
  });

  it("opening_payment_page is emitted BEFORE the browser, confirming_payment after", () => {
    const openAt = handoff.indexOf(
      'emitPhase(onPhase, "opening_payment_page")',
    );
    const browserAt = handoff.indexOf("openBrowserAsync");
    const confirmAt = handoff.indexOf(
      'emitPhase(onPhase, "confirming_payment")',
    );
    expect(openAt).toBeGreaterThan(-1);
    expect(openAt).toBeLessThan(browserAt);
    expect(browserAt).toBeLessThan(confirmAt);
  });

  it("both native flows still carry the F-6 protective comment", () => {
    for (const src of [CONSUMER_FLOW, BUSINESS_FLOW]) {
      expect(src).toContain(
        "I-PROPOSED-PAYSTACK-ABANDONED-ONLY-AFTER-BROWSER-CLOSES",
      );
    }
  });

  it("a terminal verdict does NOT clear the held hand-off (the copy promises a way back)", () => {
    // CHECKOUT_ABANDONED_MESSAGE says "reopen the payment page to finish".
    // That sentence is only true while the hold survives the abandonment.
    expect(CHECKOUT_ABANDONED_MESSAGE).toMatch(/reopen the payment page/i);
    const terminalArm = /if \(poll\.kind === "terminal"\)[\s\S]{0,400}?\n\s{4}\}/.exec(
      CONSUMER_FLOW,
    );
    expect(terminalArm).not.toBeNull();
    expect(terminalArm?.[0]).not.toContain("clearHeldHandoff");
  });
});

describe("#2264 TA-6 — the new CI gate promises exactly what it delivers (#2289)", () => {
  /**
   * SPEC §9 claimed the registry "catches DISC-B's rails the day someone adds a
   * terminal arm to them". The implementor reported, correctly, that it does
   * not: it registers `ticket-checkout-status` callers only. A gate whose NAME
   * or FAILURE MESSAGE over-claims teaches readers to believe coverage that is
   * not there — which is the #2242 shape. This pins the honest scope.
   */
  it("registers ticket-checkout-status and does not claim the other rails", () => {
    expect(GATE).toContain("ticket-checkout-status");
    // It must not silently advertise coverage of rails it never scans.
    const advertisesReservation =
      /(?:^|\n)[^#\n]*venue-reservation-confirm/.test(GATE);
    const advertisesVenueOrder = /(?:^|\n)[^#\n]*venue-order-status/.test(GATE);
    expect(advertisesReservation).toBe(false);
    expect(advertisesVenueOrder).toBe(false);
  });

  it("carries a self-test, so a gate that can no longer fail is caught", () => {
    expect(GATE).toContain("--self-test");
  });

  it("the retired timeout string is dead in both files this SPEC owns", () => {
    expect(CONSUMER_FLOW).not.toContain(
      "We couldn't confirm your payment yet",
    );
    expect(BUSINESS_FLOW).not.toContain(
      "We couldn't confirm your payment yet",
    );
  });

  it("both flows declare status AND error on the checkout-status response", () => {
    for (const src of [CONSUMER_FLOW, BUSINESS_FLOW]) {
      const generic = /invoke<\{[\s\S]{0,240}?\}>\("ticket-checkout-status"/.exec(
        src,
      );
      expect(generic).not.toBeNull();
      expect(generic?.[0]).toContain("status?: string");
      expect(generic?.[0]).toContain("error?: string");
    }
  });
});
