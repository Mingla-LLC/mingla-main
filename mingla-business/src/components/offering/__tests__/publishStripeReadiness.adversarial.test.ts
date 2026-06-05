/**
 * publishStripeReadiness — ADVERSARIAL parity regression (ORCH-1076 Stream B, tester-authored).
 *
 * [QA ORCH-1076] These tests attack a DIFFERENT angle than the implementor's
 * happy-path parity suite (`publishStripeReadiness.test.ts`): the implementor's
 * T-11 experience parity fixture derives `resolvedTotalMajor` from
 * ALREADY-ROUNDED `stop_price_cents` (`cents / 100`), which structurally cannot
 * surface the production divergence in per-stop pricing mode. In the live wizard
 * (`ExperienceCreatorWizard.tsx:289-292`) `resolvedTotalMajor` is the UNROUNDED
 * sum of the raw `parseFloat(stop.priceMajor)` major values, while the server
 * (`20260911000000_orch_1075_…sql:305-308`) sums the PER-STOP-ROUNDED
 * `(stop.price_cents)::integer` cents (each written by the wizard as
 * `Math.round(parseFloat(stop.priceMajor) * 100)`, lines 384-386).
 *
 * Those two computations DIVERGE for sub-cent per-stop prices that individually
 * round to 0 cents but sum to > 0 in major units (e.g. 3 × 0.004). The client
 * resolver then says "paid" (banner shows, Publish disabled) while the server
 * would resolve total = 0 cents and publish it as free. This is a FALSE-BLOCK
 * (safe direction — no buyer is ever shown a broken paid listing), but it is a
 * technical violation of the SPEC INV-1 "client paid-detection can NEVER
 * disagree with the server block" contract for the per-stop mode.
 *
 * This suite documents the divergence as the authoritative parity oracle.
 * `serverPerStopPaid` reproduces the server's per-stop-rounded sum from the SAME
 * raw major inputs the wizard receives (the faithful oracle), and asserts where
 * the current `experienceDraftIsPaid` matches it and where it does not.
 */

import {
  experienceDraftIsPaid,
  tripDraftIsPaid,
  offeringNeedsStripeToPublish,
} from "../publishStripeReadiness";

// Faithful server oracle for per-stop experience pricing, fed the RAW major
// strings the wizard actually receives. Mirrors the migration:
//   v_resolved_total := Σ (stop.price_cents)::int  where each
//   price_cents = round(parseFloat(stop.priceMajor) * 100)   [wizard write]
const serverPerStopPaid = (stopMajors: string[]): boolean => {
  const totalCents = stopMajors.reduce(
    (sum, m) => sum + Math.round((parseFloat(m) || 0) * 100),
    0,
  );
  return totalCents > 0;
};

// Production client computation: resolvedTotalMajor = Σ raw parseFloat(major).
const clientResolvedTotalMajor = (stopMajors: string[]): number =>
  stopMajors.reduce((sum, m) => {
    const v = parseFloat(m);
    return sum + (Number.isFinite(v) && v >= 0 ? v : 0);
  }, 0);

describe("ORCH-1076 adversarial — per-stop sub-cent client/server parity", () => {
  // Clean integer/normal cases: client and server AGREE (the happy path).
  test.each([
    { stops: ["10", "0", "5"], expectPaid: true },
    { stops: ["0", "0", "0"], expectPaid: false },
    { stops: ["", "", ""], expectPaid: false },
    { stops: ["0.01", "0", "0"], expectPaid: true },
    { stops: ["2.50", "1.50"], expectPaid: true },
  ])("normal per-stop %o → client === server", ({ stops, expectPaid }) => {
    const resolvedTotalMajor = clientResolvedTotalMajor(stops);
    const client = experienceDraftIsPaid({ isFree: false, resolvedTotalMajor });
    const server = serverPerStopPaid(stops);
    expect(client).toBe(expectPaid);
    expect(server).toBe(expectPaid);
    expect(client).toBe(server); // parity holds for normal inputs
  });

  // DIVERGENCE: each stop rounds to 0 cents individually, but the raw-major sum
  // is > 0. Server → free (0 cents). Client → paid. The current resolver
  // DISAGREES with the server in the safe (over-block) direction.
  test("sub-cent per-stop sum exposes the FALSE-BLOCK divergence", () => {
    const stops = ["0.004", "0.004", "0.004"]; // each round(0.004*100)=0; sum major=0.012
    const resolvedTotalMajor = clientResolvedTotalMajor(stops); // 0.012
    const client = experienceDraftIsPaid({ isFree: false, resolvedTotalMajor });
    const server = serverPerStopPaid(stops);

    expect(server).toBe(false); // server resolves 0 cents → would publish as free
    expect(client).toBe(true); // client over-blocks: banner shows, Publish disabled
    expect(client).not.toBe(server); // documented INV-1 per-stop divergence

    // It is a FALSE-BLOCK, never a false-green: the divergence direction means
    // the banner can only ever OVER-protect, so no buyer is ever exposed to a
    // brand that can't charge. (If this is ever tightened, the faithful mirror
    // is `Σ round(stop.major*100) > 0`, not `Σ major > 0`.)
    const needsStripe = offeringNeedsStripeToPublish({
      isPaid: client,
      stripeStatus: "not_connected",
    });
    expect(needsStripe).toBe(true); // over-block, the safe failure mode
  });

  // Trip resolver has NO per-stop path (single tier) → already rounds to cents,
  // so it is exactly server-faithful at the same boundary (control).
  test("trip resolver is exactly server-faithful at the 0.004/0.005 boundary", () => {
    expect(tripDraftIsPaid({ priceMajor: "0.004" })).toBe(false);
    expect(tripDraftIsPaid({ priceMajor: "0.005" })).toBe(true);
  });
});
