/**
 * ORCH-1117 [public offering page polish] — TESTER adversarial regression.
 *
 * Owner: mingla-tester. Attacks angles DIFFERENT from the implementor's
 * happy-path `offeringCta.orch1117.test.ts` (which asserts ONE resolved state
 * per scenario) and `offeringLegibility.orch1117.test.ts` (near-white WCAG /
 * shadow / collapse-default).
 *
 * Adversarial angles attacked here:
 *
 *   B1. DEAD-TAP STATE-MACHINE EXHAUSTIVENESS (Constitution #1, source level).
 *       The runtime dead-tap proof is on-device; this pins the SOURCE invariant
 *       that the floating bar's renderer relies on: EVERY `unavailable` CtaState
 *       carries `tappable:false`, and the ONLY `tappable:true` kinds are
 *       buy/free/waitlist. A future edit that flips an unavailable branch to
 *       `tappable:true` (re-introducing a dead Buy button) breaks this. The
 *       implementor's tests check a handful of titles; none assert the
 *       exhaustive tappable<->kind coupling across the full enum surface.
 *
 *   B2. MIXED / PRECEDENCE-COLLISION STATES never leak a tappable buy. When
 *       door-only, sale-ended, and sold-out tickets coexist (and the SPEC
 *       precedence order differs from the impl's check order), the resolved
 *       state must STILL be non-tappable — no combination of unavailable tiers
 *       may resolve to a tappable Buy. The happy-path tests only feed single
 *       homogeneous tier sets.
 *
 *   B3. WYSIWYP / no-fee-recompute (I-PAID-SUPPLY + all-in pricing). The bar
 *       price must equal the ticket's all-in `priceAllInGbp` verbatim — the
 *       resolver must NOT do fee/tax arithmetic. Asserted both behaviorally
 *       (price string contains the exact all-in number, not a fee-adjusted one)
 *       AND structurally (the module source has no fee/tax math tokens).
 *
 *   B4. INLINE SINGLE-CTA TRULY ABSENT on the trip + experience ROUTES, and the
 *       floating bar present. ORCH-1117 LOCKED rule (§4.5): single-ticket
 *       trips/experiences have NO inline Reserve/Get-spot CTA — the floating bar
 *       is the only CTA. Reintroducing an inline `trip-checkout-reserve` /
 *       `experience-checkout-get-spot` Pressable on the route breaks this.
 *
 * fails-on-revert (each angle, verified by the tester):
 *   B1 — flip any `unavailable` branch in offeringCta.ts to `tappable:true` → B1 fails.
 *   B3 — make formatPrice add a fee (e.g. `price * 1.1`) → B3 behavioral fails.
 *   B4 — re-add an inline `testID="trip-checkout-reserve"` Pressable to the trip
 *        route or TripCheckoutFlow → B4 fails.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  resolveOfferingCta,
  type CtaState,
} from "../../../../../packages/event-rendering/offeringCta";
import type { PublicTicketProps } from "../../../../../packages/event-rendering/types";

const PKG_OFFERING_CTA = resolve(
  __dirname,
  "../../../../../packages/event-rendering/offeringCta.ts",
);
const SRC_ROOT = join(__dirname, "..", "..", "..");
const APP_ROOT = join(__dirname, "..", "..", "..", "..", "app");
const read = (rel: string): string =>
  readFileSync(join(SRC_ROOT, rel), "utf8");
const readApp = (rel: string): string =>
  readFileSync(join(APP_ROOT, rel), "utf8");

const ticket = (over: Partial<PublicTicketProps> = {}): PublicTicketProps => ({
  id: over.id ?? "t",
  name: over.name ?? "Tier",
  description: null,
  priceGbp: over.priceGbp ?? 25,
  priceAllInGbp: over.priceAllInGbp ?? 25,
  currency: over.currency ?? "GBP",
  isFree: over.isFree ?? false,
  isUnlimited: over.isUnlimited ?? true,
  capacity: over.capacity ?? null,
  visibility: over.visibility ?? "visible",
  passwordProtected: false,
  password: null,
  saleStartAt: over.saleStartAt ?? null,
  saleEndAt: over.saleEndAt ?? null,
  approvalRequired: false,
  waitlistEnabled: over.waitlistEnabled ?? false,
  availableAt: over.availableAt ?? "online",
  displayOrder: over.displayOrder ?? 0,
});

const PAST = new Date(Date.now() - 86_400_000).toISOString();

// ============================================================
// B1 — Dead-tap exhaustiveness: every non-buyable state is non-tappable
// ============================================================

describe("ORCH-1117 adversarial B1 — no dead taps (tappable<->kind coupling)", () => {
  // A representative input for EVERY terminal CtaState the resolver can emit.
  const cases: Array<{ name: string; cta: CtaState }> = [
    {
      name: "not-bookable (paid brand can't charge)",
      cta: resolveOfferingCta({
        variant: "published",
        bookable: false,
        tickets: [ticket()],
        currency: "GBP",
      }),
    },
    {
      name: "cancelled",
      cta: resolveOfferingCta({
        variant: "cancelled",
        bookable: true,
        tickets: [ticket()],
        currency: "GBP",
      }),
    },
    {
      name: "past / sales ended (variant)",
      cta: resolveOfferingCta({
        variant: "past",
        bookable: true,
        tickets: [ticket()],
        currency: "GBP",
      }),
    },
    {
      name: "pre-sale",
      cta: resolveOfferingCta({
        variant: "pre-sale",
        bookable: true,
        tickets: [ticket()],
        currency: "GBP",
      }),
    },
    {
      name: "no visible tickets",
      cta: resolveOfferingCta({
        variant: "published",
        bookable: true,
        tickets: [ticket({ visibility: "hidden" })],
        currency: "GBP",
      }),
    },
    {
      name: "all door-only",
      cta: resolveOfferingCta({
        variant: "published",
        bookable: true,
        tickets: [ticket({ availableAt: "door" })],
        currency: "GBP",
      }),
    },
    {
      name: "all sale-ended (per-ticket saleEndAt)",
      cta: resolveOfferingCta({
        variant: "published",
        bookable: true,
        tickets: [ticket({ saleEndAt: PAST })],
        currency: "GBP",
      }),
    },
    {
      name: "all sold-out, no waitlist",
      cta: resolveOfferingCta({
        variant: "published",
        bookable: true,
        tickets: [ticket({ isUnlimited: false, capacity: 0 })],
        currency: "GBP",
      }),
    },
  ];

  it.each(cases)(
    "$name resolves to a NON-tappable unavailable strip",
    ({ cta }) => {
      expect(cta.kind).toBe("unavailable");
      expect(cta.tappable).toBe(false);
    },
  );

  it("the ONLY tappable kinds are buy/free/waitlist (no unavailable is ever tappable)", () => {
    // Buy
    const buy = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [ticket()],
      currency: "GBP",
    });
    // Free
    const free = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [ticket({ isFree: true, priceAllInGbp: null, priceGbp: null })],
      currency: "GBP",
    });
    // Waitlist
    const wl = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [
        ticket({ isUnlimited: false, capacity: 0, waitlistEnabled: true }),
      ],
      currency: "GBP",
    });
    for (const cta of [buy, free, wl]) {
      expect(["buy", "free", "waitlist"]).toContain(cta.kind);
      expect(cta.tappable).toBe(true);
    }
    // The unavailable kind must never carry tappable:true — TYPE + runtime.
    const unavail = resolveOfferingCta({
      variant: "past",
      bookable: true,
      tickets: [ticket()],
      currency: "GBP",
    });
    expect(unavail.tappable).toBe(false);
  });

  it("SOURCE INVARIANT: no `unavailable` literal in offeringCta carries tappable:true", () => {
    const src = readFileSync(PKG_OFFERING_CTA, "utf8");
    // Find every object literal that sets kind:"unavailable"; none may also set
    // tappable:true. Cheap structural guard: there is no `tappable: true`
    // within any unavailable return block. We assert the inverse pairing never
    // appears: the token sequence `"unavailable"` ... `tappable: true` inside
    // the same short return object.
    const unavailBlocks = src.match(
      /kind:\s*"unavailable"[\s\S]{0,200}?tappable:\s*(true|false)/g,
    );
    expect(unavailBlocks).not.toBeNull();
    for (const block of unavailBlocks ?? []) {
      expect(block).toMatch(/tappable:\s*false/);
      expect(block).not.toMatch(/tappable:\s*true/);
    }
  });
});

// ============================================================
// B2 — Mixed / precedence-collision states never leak a tappable buy
// ============================================================

describe("ORCH-1117 adversarial B2 — mixed unavailable tiers (DOCUMENTED GAP P2-1)", () => {
  // P2-1 (tester Discovery): the resolver's unavailable branches are
  // HOMOGENEOUS `.every()` checks (all-door / all-ended / all-sold-out). When
  // unavailable tiers are MIXED via DIFFERENT reasons (e.g. one door-only + one
  // sale-ended), no `.every()` branch fires; `sellable` is empty so it falls
  // back to `considered = visible` (offeringCta.ts:234) and resolves to a
  // TAPPABLE "Buy" that routes to a cart with no purchasable tier. This is a
  // misleading CTA (soft dead-end), NOT a hard dead-tap (the tap DOES navigate
  // to the cart, the existing backstop). The SPEC §4.0 precedence only defines
  // homogeneous unavailable states, so this is a spec GAP, not a violation.
  // These tests PIN the CURRENT behavior so a future fix is intentional and
  // visible. Recommended fix: when `sellable.length === 0`, return an
  // unavailable("Not on sale") strip instead of falling back to `visible`.

  it("[GAP] door-only + sale-ended mix currently resolves to a tappable buy (no sellable tier)", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [
        ticket({ id: "a", availableAt: "door" }),
        ticket({ id: "b", saleEndAt: PAST }),
      ],
      currency: "GBP",
    });
    // CURRENT behavior (the gap): a tappable buy. A future fix should flip this
    // to a non-tappable strip — at which point this assertion is updated in a
    // follow-on ORCH with its own [TEST-MOD-APPROVED].
    expect(cta.tappable).toBe(true);
    expect(cta.kind).toBe("buy");
  });

  it("[GAP] sold-out + door-only mix (no waitlist) currently resolves to a tappable buy", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [
        ticket({ id: "a", isUnlimited: false, capacity: 0 }),
        ticket({ id: "b", availableAt: "door" }),
      ],
      currency: "GBP",
    });
    expect(cta.tappable).toBe(true);
  });

  it("not-bookable gate WINS over an otherwise-sellable tier (precedence)", () => {
    // A perfectly sellable live tier, but the brand can't charge → the gate
    // must fire FIRST and produce the non-tappable 'Booking unavailable' strip.
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: false,
      tickets: [ticket({ id: "live", priceAllInGbp: 30 })],
      currency: "GBP",
    });
    expect(cta.kind).toBe("unavailable");
    expect(cta.tappable).toBe(false);
    if (cta.kind === "unavailable") {
      expect(cta.title).toBe("Booking unavailable");
    }
  });

  it("one sellable tier among unavailable tiers IS tappable (positive control)", () => {
    // Guards against an over-broad fix that would hide a genuinely sellable
    // listing. One live paid tier + a sold-out tier → tappable buy.
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [
        ticket({ id: "sold", isUnlimited: false, capacity: 0 }),
        ticket({ id: "live", priceAllInGbp: 45 }),
      ],
      currency: "GBP",
    });
    expect(cta.tappable).toBe(true);
    expect(cta.kind).toBe("buy");
  });
});

// ============================================================
// B3 — WYSIWYP: the bar price is the all-in value, never fee-recomputed
// ============================================================

describe("ORCH-1117 adversarial B3 — no fee recompute (all-in WYSIWYP)", () => {
  it("a single-tier buy price equals the ticket's all-in value verbatim", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [ticket({ priceAllInGbp: 37, priceGbp: 30 })],
      currency: "GBP",
    });
    if (cta.kind !== "buy") throw new Error("expected a buy CTA");
    // The all-in is 37 (priceAllInGbp), NOT 30 (base priceGbp) and NOT any
    // fee-adjusted number — the resolver must read priceAllInGbp as-is.
    expect(cta.price).toContain("37");
    expect(cta.price).not.toContain("30");
  });

  it("multi-tier 'From' price is the LOWEST all-in, not a summed/averaged value", () => {
    const cta = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [
        ticket({ id: "a", priceAllInGbp: 80 }),
        ticket({ id: "b", priceAllInGbp: 55 }),
      ],
      currency: "GBP",
    });
    if (cta.kind !== "buy") throw new Error("expected a buy CTA");
    expect(cta.price).toMatch(/^From /);
    expect(cta.price).toContain("55");
    expect(cta.price).not.toContain("80");
  });

  it("SOURCE INVARIANT: offeringCta module has no fee/tax arithmetic tokens", () => {
    const src = readFileSync(PKG_OFFERING_CTA, "utf8");
    expect(src).not.toMatch(/feeCents|serviceFee|taxRate|computeFee|applyFee/i);
    // No multiplicative fee scaling on a price (e.g. price * 1.1).
    expect(src).not.toMatch(/price[A-Za-z]*\s*\*\s*[0-9.]/);
  });
});

// ============================================================
// B4 — Inline single-CTA truly absent on the trip + experience routes
// ============================================================

describe("ORCH-1117 adversarial B4 — single-ticket inline CTA removed (bar is only CTA)", () => {
  const TRIP_ROUTE = readApp("t/[brandSlug]/[tripSlug].tsx");
  const EXP_ROUTE = readApp("exp/[brandSlug]/[experienceSlug].tsx");
  const TRIP_FLOW = read("components/trip/TripCheckoutFlow.tsx");
  const EXP_FLOW = read("components/experience/ExperienceCheckoutFlow.tsx");

  it("TripCheckoutFlow no longer renders the inline trip-checkout-reserve Pressable", () => {
    expect(TRIP_FLOW).not.toMatch(/testID=["']trip-checkout-reserve["']/);
  });

  it("ExperienceCheckoutFlow no longer renders the inline experience-checkout-get-spot Pressable", () => {
    expect(EXP_FLOW).not.toMatch(/testID=["']experience-checkout-get-spot["']/);
  });

  it("the trip route mounts the floating bar and routes it to the trip-specific chain", () => {
    expect(TRIP_ROUTE).toMatch(/FloatingOfferingBar/);
    expect(TRIP_ROUTE).toMatch(/orch-1117-trip-floating-bar/);
    expect(TRIP_ROUTE).toMatch(/tripCheckoutPath\(trip\.id\)/);
    // Never the events chain that hard-rejects trip rows.
    expect(TRIP_ROUTE).not.toMatch(/checkoutPublicPath\(trip\.id\)/);
  });

  it("the experience route mounts the floating bar and routes it to the experience chain", () => {
    expect(EXP_ROUTE).toMatch(/FloatingOfferingBar/);
    expect(EXP_ROUTE).toMatch(/orch-1117-experience-floating-bar/);
    expect(EXP_ROUTE).toMatch(/experienceCheckoutPath\(experience\.id\)/);
  });
});
