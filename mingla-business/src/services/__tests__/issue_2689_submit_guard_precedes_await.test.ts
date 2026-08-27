/**
 * issue #2689 [a free ticket that succeeds is reported as a failure] — the
 * CLIENT half, and the root cause.
 *
 * WHAT PRODUCTION SHOWED. 142 of 142 free sessions minted an order. Not one
 * failed. What differed was whether a SECOND submit existed: every buyer shown
 * a failure had produced two `record-consent` POSTs 0.51-1.65s apart, and every
 * buyer shown success had produced one. Five of eight were told their purchase
 * failed while holding a valid ticket.
 *
 * WHY THEY TAPPED TWICE, and it is not impatience. `setSubmitting(true)` sat
 * BELOW `await recordConsent(...)`, a network round trip. `isContinueDisabled`
 * gates only on `submitting`, so for the whole of that await the button stayed
 * enabled, unspinnered and re-entrant — the screen carried NO evidence the first
 * tap had registered. Measured dead window: 2.0s and 2.7s.
 *
 * WHY THIS IS A SOURCE-ORDER TEST AND THAT IS ENOUGH. The defect IS an ordering
 * defect: one statement on the wrong side of one await. The screen is an
 * expo-router page whose full render harness does not exist in this suite, and a
 * test that re-implemented the guard would assert my own copy rather than the
 * shipped code — the unfalsifiable shape this issue has already produced three
 * times. Asserting the real file's statement order tests the actual defect, and
 * the REVERT GUARD at the bottom proves it fails when the fix is undone.
 */
import { readFileSync } from "fs";
import { join } from "path";

const BUYER = readFileSync(
  join(__dirname, "../../../app/checkout/[eventId]/buyer.tsx"),
  "utf8",
);

const at = (needle: string): number => {
  const i = BUYER.indexOf(needle);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
};

describe("#2689 the submit is claimed before any awaited work", () => {
  it("claims the guard and shows the spinner BEFORE the consent round trip", () => {
    const claim = at("submitInFlight.current = true;");
    const spinner = at("setSubmitting(true);");
    const consent = at("await recordConsent({");

    expect(claim).toBeLessThan(consent);
    expect(spinner).toBeLessThan(consent);
  });

  it("guards with a REF, because setSubmitting is batched and loses the race", () => {
    // Two taps in one tick both read the OLD `submitting` and both proceed. A
    // ref changes on the assignment itself. If this ever becomes a useState the
    // guard silently stops guarding the case it exists for.
    expect(BUYER).toContain("const submitInFlight = useRef<boolean>(false);");
    expect(BUYER).toContain("if (submitInFlight.current) return;");
  });

  it("releases the guard on the free rail's finally", () => {
    const free = BUYER.indexOf("if (totals.isFree) {");
    expect(free).toBeGreaterThanOrEqual(0);
    const release = BUYER.indexOf("submitInFlight.current = false;", free);
    expect(release).toBeGreaterThan(free);
    expect(BUYER.slice(free)).toContain(
      "submitInFlight.current = false;\n        setSubmitting(false);",
    );
  });

  it("releases the guard after the paid rail navigates, so back cannot strand it", () => {
    // The whole defect lives BEFORE navigation — the seconds when the screen
    // looks idle and the guest taps again. Once /payment is on screen there is
    // no button here to press, so the guard is released immediately after the
    // push. Holding it past that point would strand a guest who navigates back
    // on a permanently dead button: a stack push leaves this screen MOUNTED, so
    // the ref survives the return.
    //
    // An earlier draft released it via `useFocusEffect` instead. That hook is
    // absent from this screen's test harness, so it threw on render and took
    // SIX existing #2135 tests down with it — caught by the full suite, not by
    // me. Fewer dependencies is the point, not just the fix.
    const push = at("router.push(`/checkout/${eventId}/payment` as never);");
    const release = BUYER.indexOf("submitInFlight.current = false;", push);
    expect(release).toBeGreaterThan(push);
    expect(release - push).toBeLessThan(120);
    expect(BUYER).not.toContain("useFocusEffect");
  });

  it("the paid rail is covered too - the guard is claimed before its navigate", () => {
    const claim = at("submitInFlight.current = true;");
    const push = at("router.push(`/checkout/${eventId}/payment` as never);");
    expect(claim).toBeLessThan(push);
  });
});

describe("#2689 REVERT GUARD", () => {
  it("the shipped order DISAGREES with the order that caused the outage", () => {
    // The pre-fix shape, stated as data rather than prose: the only line that
    // disabled the button lived after the awaited consent write.
    const consent = at("await recordConsent({");
    const spinner = at("setSubmitting(true);");

    const preFixOrderHolds = spinner > consent;
    expect(preFixOrderHolds).toBe(false);

    // And the guard must not have been "fixed" by simply moving the state call
    // while leaving the re-entrant window open in the same tick.
    const claim = at("submitInFlight.current = true;");
    expect(claim).toBeLessThan(spinner);
  });

  it("no awaited call sits between the tap and the guard claim", () => {
    const handler = BUYER.indexOf("const handleContinue = useCallback(");
    expect(handler).toBeGreaterThanOrEqual(0);
    const claim = BUYER.indexOf("submitInFlight.current = true;", handler);
    const head = BUYER.slice(handler, claim);
    expect(head).not.toContain("await ");
  });
});
