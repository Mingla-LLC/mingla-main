// ===========================================================================
// Issue #1793 (#1767 Phase 4) — BUYER WEB's guest ordering, EXECUTED.
//
// This drives the real service against a fake Supabase client and asserts on
// what actually goes out on the wire and what actually comes back. It does NOT
// read its own source and assert strings about it: a pure source-text pin is
// forbidden as a regression proof here (I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN)
// because such pins rot on every refactor and caught none of the regressions
// they were written for. The genuinely STRUCTURAL half of this phase — the anon
// rail, the sitting written before the redirect, the same-tab assignment, the
// single ordering chunk, no client money math — is a strict-grep gate instead:
// `.github/scripts/strict-grep/issue-1793-guest-ordering-structure.mjs`.
//
// Four claims, each one a thing a guest would feel:
//
//   T-1793-B1  nothing with a price in it leaves this surface
//   T-1793-B2  a guest reads the SENTENCE, never the machine code
//   T-1793-B3  both provider rails come back as one redirect a caller can't miss
//   T-1793-B4  the honest ordering state survives the wire, and fails honest
//
// fails-on-revert: spread the cart line into the body and B1 dies; prefer
// `body.error` over `body.message` and B2 dies; drop either provider arm and B3
// dies; return anything but `unavailable` on a failed read and B4 dies.
// ===========================================================================

const rpc = jest.fn();
const invoke = jest.fn();

jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

import {
  createVenueOrder,
  fetchVenueOrderStatus,
  fetchVenueOrderingState,
  previewVenueOrder,
  VenueOrderError,
} from "../../../services/venueOrderingService";
import type { VenueOrderRequest } from "../../../services/venueOrderingService";

/** A body streams once; the rail's failures arrive as `{ context: Response }`. */
const failureFrom = (body: unknown) => ({
  context: { text: async () => JSON.stringify(body) },
});

const request = (
  over: Partial<VenueOrderRequest> = {},
): VenueOrderRequest => ({
  spotCode: "kq7m3pd2xw",
  venueId: "11111111-1111-4111-8111-111111111111",
  sessionId: null,
  lines: [
    {
      key: "k1",
      menuItemId: "22222222-2222-4222-8222-222222222222",
      itemName: "Negroni",
      quantity: 2,
      modifierIds: ["33333333-3333-4333-8333-333333333333"],
      modifierNames: ["Double"],
      notes: "no ice",
      // Everything a tampering client might try to smuggle onto a line:
      unitPriceCents: 1,
      priceCents: 1,
      lineTotalCents: 2,
      totalCents: 2,
      price: 0.01,
      amount: 0.01,
    } as unknown as VenueOrderRequest["lines"][number],
  ],
  buyer: { name: " Ada ", email: " ADA@example.com ", phone: " +447700900000 " },
  partySizeClaimed: 4,
  tipBps: 1000,
  tipFlatCents: null,
  entrySource: "qr",
  ...over,
});

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
});

// ---------------------------------------------------------------------------
describe("T-1793-B1 — nothing with a price in it leaves this surface", () => {
  test("the posted body carries item ids, counts, option ids and notes — and no price", async () => {
    invoke.mockResolvedValue({ data: { kind: "preview" }, error: null });
    await previewVenueOrder(request());

    expect(invoke).toHaveBeenCalledTimes(1);
    const [fn, options] = invoke.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(fn).toBe("venue-order-create");
    const wire = JSON.stringify(options.body);
    for (
      const key of [
        "unitPriceCents",
        "priceCents",
        "lineTotalCents",
        "amountCents",
        "subtotalCents",
        '"totalCents"',
        '"price"',
        '"amount"',
      ]
    ) {
      expect(wire).not.toContain(key);
    }
    // Exactly four keys on the line, whatever the cart object carried.
    const lines = options.body.lines as Array<Record<string, unknown>>;
    expect(Object.keys(lines[0]).sort()).toEqual([
      "menuItemId",
      "modifierIds",
      "notes",
      "quantity",
    ]);
    expect(lines[0].quantity).toBe(2);
    // The contact triple is trimmed on the way out; the SERVER still validates.
    expect(options.body.buyer).toEqual({
      name: "Ada",
      email: "ADA@example.com",
      phone: "+447700900000",
    });
    // `mode` and `surface` are what earn a hosted redirect rather than a sheet.
    expect(options.body.mode).toBe("preview");
    expect(options.body.surface).toBe("web");
  });

  test("a create carries the per-tap idempotency key and nothing else new", async () => {
    invoke.mockResolvedValue({
      data: { kind: "free_completed", orderId: "o1", sessionId: "s1" },
      error: null,
    });
    await createVenueOrder(request(), "vo-abc");
    const [, options] = invoke.mock.calls[0] as [
      string,
      { body: Record<string, unknown> },
    ];
    expect(options.body.idempotencyKey).toBe("vo-abc");
    expect(options.body.mode).toBe("create");
    expect(JSON.stringify(options.body)).not.toContain("unitPriceCents");
  });
});

// ---------------------------------------------------------------------------
describe("T-1793-B2 — a guest reads the sentence, never the machine code", () => {
  test("a typed failure surfaces its guest copy", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: failureFrom({
        error: "buyer_phone_required",
        message: "We need a phone number to text you when it's ready.",
      }),
    });
    await expect(previewVenueOrder(request())).rejects.toThrow(
      "We need a phone number to text you when it's ready.",
    );
  });

  test("the machine code is still available to branch on — it is just not shown", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: failureFrom({
        error: "ordering_paused",
        message: "The Brasserie has paused ordering right now. Try again shortly.",
      }),
    });
    const error = await previewVenueOrder(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VenueOrderError);
    expect((error as VenueOrderError).code).toBe("ordering_paused");
    expect((error as VenueOrderError).message).toContain("paused ordering");
  });

  test("an unreadable failure still says, in words, that nothing was charged", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { context: { text: async () => "<html>502</html>" } },
    });
    await expect(previewVenueOrder(request())).rejects.toThrow(
      "Nothing has been charged",
    );
  });
});

// ---------------------------------------------------------------------------
describe("T-1793-B3 — both provider rails come back as ONE redirect", () => {
  test("hosted checkout", async () => {
    invoke.mockResolvedValue({
      data: {
        kind: "requires_web_redirect",
        orderId: "o1",
        sessionId: "s1",
        buyerStatusToken: "bst",
        guestCancelToken: "gct",
        url: "https://checkout.example/pay/1",
      },
      error: null,
    });
    const created = await createVenueOrder(request(), "vo-1");
    expect(created.kind).toBe("requires_web_redirect");
    expect(created).toMatchObject({
      hostedUrl: "https://checkout.example/pay/1",
      buyerStatusToken: "bst",
      guestCancelToken: "gct",
    });
  });

  test("the NG rail — a different field on the wire, the same field to the caller", async () => {
    invoke.mockResolvedValue({
      data: {
        kind: "requires_paystack_redirect",
        orderId: "o1",
        sessionId: "s1",
        buyerStatusToken: "bst",
        guestCancelToken: "gct",
        authorizationUrl: "https://ng.example/pay/1",
      },
      error: null,
    });
    const created = await createVenueOrder(request(), "vo-1");
    expect(created).toMatchObject({ hostedUrl: "https://ng.example/pay/1" });
  });

  test("a replayed submit returns the EXISTING order, never a second one", async () => {
    invoke.mockResolvedValue({
      data: {
        kind: "already_created",
        orderId: "o1",
        totalCents: 2400,
        currency: "GBP",
        paymentStatus: "paid",
      },
      error: null,
    });
    const created = await createVenueOrder(request(), "vo-1");
    expect(created).toEqual({
      kind: "already_created",
      orderId: "o1",
      totalCents: 2400,
      currency: "GBP",
      paymentStatus: "paid",
    });
  });

  test("a zero-total round is complete on arrival and carries its pickup code", async () => {
    invoke.mockResolvedValue({
      data: {
        kind: "free_completed",
        orderId: "o1",
        sessionId: "s1",
        buyerStatusToken: "bst",
        guestCancelToken: "gct",
        pickupCode: "47",
      },
      error: null,
    });
    const created = await createVenueOrder(request(), "vo-1");
    expect(created).toMatchObject({ kind: "free_completed", pickupCode: "47" });
  });
});

// ---------------------------------------------------------------------------
describe("T-1793-B4 — the honest state survives the wire, and fails honest", () => {
  test("a paused venue arrives as `paused`, with its spot still resolved", async () => {
    rpc.mockResolvedValue({
      data: {
        state: "paused",
        venue_id: "v1",
        venue_name: "The Brasserie",
        spot_state: "ok",
        spot: { label: "Table 12", kind: "table", serving_menu_id: "m1" },
        service_charge_bps: 1250,
        service_charge_label: "Service",
        tips_enabled: true,
        tip_presets_bps: [1000, 1500],
        counter_pickup_enabled: true,
        prep_time_minutes: 20,
      },
      error: null,
    });
    const config = await fetchVenueOrderingState({
      brandSlug: "b",
      venueSlug: "v",
      spotCode: "kq7m3pd2xw",
    });
    expect(config.state).toBe("paused");
    expect(config.spot).toEqual({
      label: "Table 12",
      kind: "table",
      servingMenuId: "m1",
    });
    // The venue's own charge reaches the guest surface so the tip can default to
    // none rather than stack on it (D-9).
    expect(config.serviceChargeBps).toBe(1250);
    expect(config.serviceChargeLabel).toBe("Service");
    expect(config.tipPresetsBps).toEqual([1000, 1500]);
    // The RPC was called with the spot code — the honest read resolves a printed
    // code even while the venue is paused.
    expect(rpc).toHaveBeenCalledWith("pg_public_venue_ordering_state", {
      p_brand_slug: "b",
      p_venue_slug: "v",
      p_spot_code: "kq7m3pd2xw",
    });
  });

  test("a failed read is `unavailable` — no affordance, and NO claim", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const config = await fetchVenueOrderingState({
      brandSlug: "b",
      venueSlug: "v",
      spotCode: null,
    });
    expect(config.state).toBe("unavailable");
    expect(config.counterPickupEnabled).toBe(false);
    expect(config.tipsEnabled).toBe(false);
  });

  test("an unrecognised state is `unavailable`, never optimistically `on`", async () => {
    rpc.mockResolvedValue({ data: { state: "banana" }, error: null });
    expect(
      (await fetchVenueOrderingState({
        brandSlug: "b",
        venueSlug: "v",
        spotCode: null,
      })).state,
    ).toBe("unavailable");
  });

  test("the status read copies the server's four lines through untouched", async () => {
    invoke.mockResolvedValue({
      data: {
        orderId: "o1",
        paymentStatus: "paid",
        fulfillmentStatus: "ready",
        pickupCode: "47",
        spotLabel: null,
        canCancel: false,
        canRequestRefund: true,
        escalationLevel: 0,
        totals: {
          currency: "GBP",
          subtotalCents: 4250,
          serviceChargeCents: 531,
          feesAndTaxCents: 239,
          tipCents: 425,
          totalCents: 5445,
          refundedAmountCents: 0,
        },
      },
      error: null,
    });
    const live = await fetchVenueOrderStatus("o1", "bst");
    expect(live).not.toBeNull();
    // Not recomputed, not rounded, not re-derived: copied.
    expect(live?.totals.feesAndTaxCents).toBe(239);
    // And the server's own identity still holds on the way through, which is
    // what lets the receipt render four lines and add none of them up.
    const t = live!.totals;
    expect(t.subtotalCents + t.serviceChargeCents + t.feesAndTaxCents + t.tipCents)
      .toBe(t.totalCents);
    // A pickup code is the recorded fact the collect-vs-deliver branch reads.
    expect(live?.pickupCode).toBe("47");
  });

  test("a status read that fails returns null rather than a fabricated order", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await fetchVenueOrderStatus("o1", "bst")).toBeNull();
  });
});
