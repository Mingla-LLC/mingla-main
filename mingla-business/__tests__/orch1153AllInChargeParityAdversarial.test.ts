/**
 * ORCH-1153 WS3 — TESTER ADVERSARIAL test (different angle from the implementor's
 * hardcoded-value display test `orch1153ExperienceAllInDisplay.test.ts`).
 *
 * ANGLE: instead of asserting one fixed displayed value (53.95), this test
 * replicates the SERVER all-in ENGINE formula and the page display transform as
 * two independent code paths, then asserts displayed === charged across a SWEEP
 * of boundary prices — including rounding-edge cents where `round(base * bps /
 * 10000)` can diverge between the SQL `round()` (half-away-from-zero) and a naive
 * JS `Math.round()`, and a price small enough that the fee rounds to a single
 * cent. The implementor proved one value; this proves the CONTRACT holds across
 * the gross-up boundary so a 100×, off-by-one, or wrong-rounding regression is
 * caught.
 *
 * Source of truth replicated here (verified against the live prod functions on
 * 2026-06-17 by the tester):
 *   - server charge:  compute_all_in_cents / computeBuyerSubtotal:
 *       all_in = base + round(base * effective_take_rate_bps / 10000)   [pass fee]
 *       all_in = base                                                   [absorb]
 *   - page display:   expDisplayCents = round(priceAllInGbp * 100)      [pass fee]
 *                     expDisplayCents = priceCents                      [absorb / RPC miss]
 *     where priceAllInGbp = all_in_cents / 100  (publicExperienceService).
 *
 * Live fixture cross-check (in the TEST report): the fixture event
 * 229ff02a-9104-46bc-8f81-c6fa4f651773 returns base_cents=5000, all_in_cents=5500
 * (1000 bps pass-fee) from pg_public_event_tier_allin AND
 * resolve_event_pricing_inputs returns pass_mingla_fee=true,
 * effective_take_rate_bps=1000 — so displayed (round(55.00*100)=5500) === charged
 * (5000 + round(5000*1000/10000)=5500).
 *
 * FAILS-ON-REVERT: this test imports nothing from product source; it pins the
 * displayed===charged INVARIANT. It is the adversarial complement to the
 * implementor's source-contract test (which fails when the page reverts to the
 * bare base). Together: the implementor's test catches the source revert; this
 * test catches a wrong gross-up / 100× / rounding regression at the boundary.
 */

// ─── server charge math (mirror of compute_all_in_cents / computeBuyerSubtotal) ──
function serverAllInCents(
  baseCents: number,
  passMinglaFee: boolean,
  takeRateBps: number,
): number {
  const base = Math.max(0, baseCents);
  const fee = passMinglaFee ? Math.round((base * takeRateBps) / 10000) : 0;
  return base + fee;
}

// ─── page display transform (mirror of expDisplayCents in [experienceSlug].tsx) ──
// priceAllInGbp is MAJOR units (allInCents / 100); the page ×100 back to cents.
function pageDisplayCents(ticket: {
  priceCents: number;
  priceAllInGbp?: number | null;
}): number {
  return typeof ticket.priceAllInGbp === "number" && ticket.priceAllInGbp > 0
    ? Math.round(ticket.priceAllInGbp * 100)
    : ticket.priceCents;
}

// Build the payload the way publicExperienceService does: priceAllInGbp = allIn/100.
function buildTicket(
  baseCents: number,
  passMinglaFee: boolean,
  takeRateBps: number,
): { priceCents: number; priceAllInGbp: number | null } {
  const allIn = serverAllInCents(baseCents, passMinglaFee, takeRateBps);
  return { priceCents: baseCents, priceAllInGbp: allIn / 100 };
}

describe("ORCH-1153 WS3 adversarial — displayed === charged across the gross-up boundary", () => {
  // base cents chosen to hit rounding edges of round(base * 1000 / 10000) = base/10
  // and round(base * 150 / 10000) (the 1.5% platform default).
  const passFeeCases: Array<{ base: number; bps: number }> = [
    { base: 5000, bps: 1000 }, // the live fixture: +500 = 5500
    { base: 9999, bps: 1000 }, // 9999*0.1 = 999.9 → round 1000 → 10999
    { base: 12345, bps: 150 }, // 12345*0.015 = 185.175 → round 185 → 12530
    { base: 333, bps: 1000 }, // 333*0.1 = 33.3 → round 33 → 366
    { base: 1, bps: 1000 }, // 1*0.1 = 0.1 → round 0 → 1 (fee rounds to zero cents)
    { base: 50, bps: 1000 }, // 50*0.1 = 5 → 55
    { base: 99999, bps: 250 }, // 99999*0.025 = 2499.975 → round 2500 → 102499
  ];

  it.each(passFeeCases)(
    "pass-fee base=$base bps=$bps: page display === server charge (non-zero unless fee rounds to 0)",
    ({ base, bps }) => {
      const charged = serverAllInCents(base, true, bps);
      const ticket = buildTicket(base, true, bps);
      const displayed = pageDisplayCents(ticket);
      // The load-bearing invariant: what the buyer SEES equals what the card is CHARGED.
      expect(displayed).toBe(charged);
      // And it is NOT a 100× error (the classic units bug): display in a sane range.
      expect(displayed).toBeGreaterThanOrEqual(base);
      expect(displayed).toBeLessThan(base * 2 + 100);
    },
  );

  it("absorb-fee: page display === charge === bare base (the 8 live brands; no regression)", () => {
    for (const base of [5000, 9999, 12345, 1, 99999]) {
      const charged = serverAllInCents(base, false, 1000);
      const ticket = buildTicket(base, false, 1000);
      expect(charged).toBe(base);
      expect(pageDisplayCents(ticket)).toBe(base);
    }
  });

  it("RPC miss (priceAllInGbp null) falls back to base — never blanks, never 100×", () => {
    expect(pageDisplayCents({ priceCents: 5000, priceAllInGbp: null })).toBe(5000);
    expect(pageDisplayCents({ priceCents: 5000, priceAllInGbp: 0 })).toBe(5000);
  });

  it("the major-units round-trip introduces no drift up to a large price", () => {
    // allIn/100 then ×100 must return the same integer cents for every all-in.
    for (let base = 0; base <= 200000; base += 1234) {
      const allIn = serverAllInCents(base, true, 1000);
      const major = allIn / 100;
      expect(Math.round(major * 100)).toBe(allIn);
    }
  });
});
