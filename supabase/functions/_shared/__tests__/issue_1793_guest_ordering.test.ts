// ===========================================================================
// Issue #1793 (#1767 Phase 4) — the money proofs for GUEST ORDERING.
//
// Phase 4 is the phase in which a guest pays real money, so these are the four
// claims that have to be true before it ships, each proved against the REAL
// engine rather than a description of it:
//
//   T-1793-M1  the four lines a guest reads sum to the amount they are charged
//   T-1793-M2  a tip is OUTSIDE Mingla's fee; a service charge is INSIDE it
//   T-1793-M3  a price sent by a client is ignored — the server's row wins
//   T-1793-M4  the honest paused/off copy has ONE owner, and it is the server
//
// fails-on-revert: delete `feesAndTaxCents` from `computeVenueOrderMoney` and
// M1 dies; move `tip_cents` inside the fee basis and M2 dies; make `priceCart`
// read a price off its input and M3 dies; edit either P-29 sentence and M4 dies.
// ===========================================================================

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  computeVenueOrderMoney,
  type MenuItemRow,
  priceCart,
  type RequestedLine,
  venueOrderErrorCopy,
} from "../venueOrderPricing.ts";

const SWITCHES = { pass_tax: true, pass_mingla_fee: true, pass_service_fee: true };

const money = (over: Partial<Parameters<typeof computeVenueOrderMoney>[0]> = {}) =>
  computeVenueOrderMoney({
    subtotalCents: 4250,
    serviceChargeBps: 0,
    tipBps: null,
    tipFlatCents: null,
    switches: SWITCHES,
    region: "GB",
    currency: "GBP",
    effectiveTakeRateBps: 500,
    takeRateSource: "platform_default",
    ...over,
  });

// ---------------------------------------------------------------------------
// T-1793-M1 — the guest's four lines ARE the charge.
//
// The cart renders exactly `subtotal`, the venue's own service charge, ONE
// combined "Fees & tax" line and the tip, and it adds none of them up. So the
// identity has to hold on the SERVER, for every shape of order, or a guest can
// be shown four numbers that do not make the fifth.
// ---------------------------------------------------------------------------
Deno.test("T-1793-M1 — subtotal + service charge + fees&tax + tip === total, always", () => {
  const subtotals = [0, 1, 99, 100, 1234, 4250, 99999, 1_000_000];
  const serviceBps = [0, 250, 1000, 1250, 3000];
  const tipBps = [null, 0, 1000, 1250, 2000];
  const regions = ["GB", "US", "EU", "CH", "NG"] as const;
  let checked = 0;
  for (const subtotalCents of subtotals) {
    for (const serviceChargeBps of serviceBps) {
      for (const tip of tipBps) {
        for (const region of regions) {
          const result = money({
            subtotalCents,
            serviceChargeBps,
            tipBps: tip,
            region,
            currency: region === "NG" ? "NGN" : "GBP",
            vatRateBps: region === "NG" ? 750 : 0,
          });
          assertEquals(
            result.subtotalCents + result.serviceChargeCents +
              result.feesAndTaxCents + result.tipCents,
            result.totalCents,
            `four lines must equal the charge (subtotal=${subtotalCents} ` +
              `serviceBps=${serviceChargeBps} tipBps=${tip} region=${region})`,
          );
          // And the fee basis is subtotal + service charge, and NOTHING else.
          assertEquals(
            result.feeBasisCents,
            result.subtotalCents + result.serviceChargeCents,
          );
          checked += 1;
        }
      }
    }
  }
  // Vacuity guard: a matrix that silently collapsed to nothing would pass.
  assertEquals(checked, 8 * 5 * 5 * 5);
});

// ---------------------------------------------------------------------------
// T-1793-M2 — the tip is outside Mingla's fee; the service charge is inside it.
//
// This is the pair D-2 and D-9 deliberately contrast, and it is the difference
// between "we take no cut of a tip" being a policy and being arithmetic.
// ---------------------------------------------------------------------------
Deno.test("T-1793-M2 — a tip moves the total and NOTHING else; a service charge moves the fee", () => {
  const noTip = money({ subtotalCents: 4250, tipBps: null });
  const bigTip = money({ subtotalCents: 4250, tipBps: 2000 });

  // The tip is real money and reaches the total…
  assertEquals(bigTip.tipCents, 850);
  assertEquals(bigTip.totalCents, noTip.totalCents + 850);
  // …and it touches NOTHING Mingla's fee is a function of.
  assertEquals(bigTip.feeBasisCents, noTip.feeBasisCents);
  assertEquals(bigTip.minglaFeeCents, noTip.minglaFeeCents);
  assertEquals(bigTip.platformServiceFeeCents, noTip.platformServiceFeeCents);
  assertEquals(bigTip.buyerSubtotalCents, noTip.buyerSubtotalCents);
  assertEquals(bigTip.feesAndTaxCents, noTip.feesAndTaxCents);

  // The venue's service charge is the deliberate opposite: it IS venue revenue,
  // so it enters the basis and Mingla's take-rate applies to it.
  const noService = money({ subtotalCents: 4250, serviceChargeBps: 0 });
  const withService = money({ subtotalCents: 4250, serviceChargeBps: 1250 });
  assertEquals(withService.serviceChargeCents, 531);
  assertEquals(withService.feeBasisCents, 4250 + 531);
  assert(
    withService.minglaFeeCents > noService.minglaFeeCents,
    "a service charge must raise Mingla's fee — it is venue revenue (D-9)",
  );
  // And it is its OWN line, never folded into the combined fees line.
  assertNotEquals(withService.serviceChargeCents, 0);
  assertEquals(
    withService.subtotalCents + withService.serviceChargeCents +
      withService.feesAndTaxCents + withService.tipCents,
    withService.totalCents,
  );
});

Deno.test("T-1793-M2b — a tip on an order that ALSO carries a service charge still earns Mingla nothing", () => {
  const base = money({ subtotalCents: 6000, serviceChargeBps: 1000, tipBps: null });
  const tipped = money({ subtotalCents: 6000, serviceChargeBps: 1000, tipBps: 1500 });
  assertEquals(tipped.minglaFeeCents, base.minglaFeeCents);
  assertEquals(tipped.feeBasisCents, base.feeBasisCents);
  // The tip percentage applies to the SUBTOTAL only — a venue's own service
  // charge can never inflate the tip the guest thought they were leaving.
  assertEquals(tipped.tipCents, 900);
});

// ---------------------------------------------------------------------------
// T-1793-M3 — a price sent by a client is ignored.
//
// `priceCart` is the only thing that turns a request into money, and it reads
// prices from SERVER menu rows. Here the requested line is deliberately
// poisoned with every price-shaped field a tampering client might try, and the
// answer must be identical to the clean request.
// ---------------------------------------------------------------------------
Deno.test("T-1793-M3 — a tampered client price is ignored; the server's menu row is the price", () => {
  const item: MenuItemRow = {
    id: "11111111-1111-4111-8111-111111111111",
    menu_id: "22222222-2222-4222-8222-222222222222",
    brand_id: "33333333-3333-4333-8333-333333333333",
    name: "Negroni",
    price_cents: 1200,
    currency: "GBP",
    is_available: true,
  };
  const itemsById = new Map([[item.id, item]]);
  const orderableItemIds = new Set([item.id]);

  const clean: RequestedLine = {
    menuItemId: item.id,
    quantity: 2,
    modifierIds: [],
    notes: null,
  };
  // Every price-shaped key a client could invent, all at once, all lying low.
  const tampered = {
    ...clean,
    unitPriceCents: 1,
    priceCents: 1,
    lineTotalCents: 2,
    amountCents: 2,
    subtotalCents: 2,
    totalCents: 2,
    price: 0.01,
    amount: 0.01,
  } as unknown as RequestedLine;

  const honest = priceCart({
    requested: [clean],
    itemsById,
    groupsByItemId: new Map(),
    modifiersById: new Map(),
    orderableItemIds,
  });
  const attacked = priceCart({
    requested: [tampered],
    itemsById,
    groupsByItemId: new Map(),
    modifiersById: new Map(),
    orderableItemIds,
  });
  assert(honest.ok && attacked.ok);
  assertEquals(attacked.subtotalCents, 2400);
  assertEquals(attacked.subtotalCents, honest.subtotalCents);
  assertEquals(attacked.lines[0].unitPriceCents, 1200);
  assertEquals(attacked.lines[0].lineTotalCents, 2400);

  // And the money the guest is charged is computed from THAT, so a 1p order is
  // not reachable through the request body at all.
  const charged = money({ subtotalCents: attacked.subtotalCents });
  assert(charged.totalCents >= 2400);
});

Deno.test("T-1793-M3b — venue-order-create refuses a request that even MENTIONS a price", () => {
  // The runtime guard lives inside `serve(...)` and cannot be imported, so its
  // shape is pinned from source. This is a deliberate belt on top of M3's
  // braces: M3 proves a smuggled price is IGNORED, this proves it is REJECTED,
  // and P-20 requires the second ("a price sent by a client is a validation
  // error, not a hint").
  const source = Deno.readTextFileSync(
    new URL("../../venue-order-create/index.ts", import.meta.url),
  );
  for (
    const key of [
      "unitPriceCents",
      "priceCents",
      "lineTotalCents",
      "amountCents",
      "subtotalCents",
      "totalCents",
      '"price"',
      '"amount"',
    ]
  ) {
    assert(
      source.includes(key),
      `venue-order-create must reject a body carrying ${key} (P-20)`,
    );
  }
  // Applied to EVERY line, and to the top-level body.
  assert(source.includes("for (const raw of rawLines"));
  assert(source.includes('for (const key of PRICE_KEYS) {\n    if (key in body) return fail("order_total_invalid");'));
});

// ---------------------------------------------------------------------------
// T-1793-M4 — the honest paused/off copy has ONE owner.
//
// The guest banner Phase 4 shows BEFORE an order is attempted, and the error
// the rail would have returned if it HAD been attempted, must be the same
// sentence. Two copies of one sentence is how a guest is told two things.
// ---------------------------------------------------------------------------
Deno.test("T-1793-M4 — the paused / not-yet-orderable sentences are shared with the guest surface", () => {
  const paused = venueOrderErrorCopy("ordering_paused", "guest", {
    venue: "The Brasserie",
  });
  const notYet = venueOrderErrorCopy("venue_not_orderable", "guest", {
    venue: "The Brasserie",
  });
  assertEquals(
    paused,
    "The Brasserie has paused ordering right now. Try again shortly.",
  );
  assertEquals(notYet, "The Brasserie isn't taking orders through Mingla yet.");

  const rules = Deno.readTextFileSync(
    new URL(
      "../../../../packages/brand-rendering/venueOrdering/venueOrderingRules.ts",
      import.meta.url,
    ),
  );
  assert(
    rules.includes("has paused ordering right now. Try again shortly."),
    "the guest banner must reuse P-29's ordering_paused sentence verbatim",
  );
  assert(
    rules.includes("isn't taking orders through Mingla yet."),
    "the guest banner must reuse P-29's venue_not_orderable sentence verbatim",
  );
  assert(
    rules.includes("This code isn't active. Ask a member of staff."),
    "an unknown spot code must reuse P-29's spot_unknown sentence verbatim",
  );
});

// ---------------------------------------------------------------------------
// T-1793-M5 — the service-window rule has ONE meaning across the boundary.
//
// The guest surface hides an "Add" button outside a menu's window; the server
// refuses the order outside it. If the two ever disagree about a window that
// crosses midnight, a late-night menu either cannot be ordered from at all or
// offers a basket the kitchen refuses.
// ---------------------------------------------------------------------------
Deno.test("T-1793-M5 — the midnight-wrapping window rule is stated identically on both sides", () => {
  const client = Deno.readTextFileSync(
    new URL(
      "../../../../packages/brand-rendering/venueOrdering/venueOrderingRules.ts",
      import.meta.url,
    ),
  );
  const server = Deno.readTextFileSync(new URL("../venueOrderPricing.ts", import.meta.url));
  const rule = "if (end >= start) return now >= start && now < end;";
  assert(server.includes(rule), "the server's wrap rule moved");
  assert(client.includes(rule), "the guest surface's wrap rule must match it");
});
