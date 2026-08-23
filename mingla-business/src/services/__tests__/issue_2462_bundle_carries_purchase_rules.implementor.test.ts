/**
 * issue #2462 [free checkout dead-ends on "Nothing was reserved"] — HAPPY PATH.
 *
 * WHAT BROKE. `pg_direct_event_checkout_bundle` is the FIRST reader consulted by
 * both `getPublicEventBySlug` and `getPublicEventById`, and it never returned
 * `min_purchase_qty` / `max_purchase_qty` / `allow_transfers`. So
 * `directBundleTicketToStub` hardcoded `1 / null / true` — it had nothing to map.
 *
 * `QuantityRow` clamps to `min(remaining, maxPurchaseQty ?? Infinity)`, so a null
 * cap is NO cap. On We Go Again Exhibition the stepper offered up to 229 on a
 * ticket type the organiser capped at 1;
 * `biz_ticket_checkout_create_session` then refused with
 * `ticket_quantity_above_max` (verified against production), which the free-rail
 * mapper renders as "We could not reserve your free ticket. Nothing was reserved
 * — please try again." No retry could ever clear it.
 *
 * WHAT THIS PINS. The bundle path must carry the organiser's real numbers
 * through to the cart, and — the part that is easy to get wrong — `null` must
 * SURVIVE as `null`, because `maxPurchaseQty: null` is the legitimate "no cap"
 * answer that most ticket types carry. A fix that coerces null to a number is as
 * broken as the bug.
 *
 * FAILS ON REVERT: restore `minPurchaseQty: 1, maxPurchaseQty: null,
 * allowTransfers: true` in `directBundleTicketToStub` and the first test fails on
 * all three fields.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { getPublicEventById } from "../publicEventsService";

const EVENT_ID = "3014ea7e-f3e0-40d0-b112-a51f4e37e964";

/** One bundle envelope carrying `tickets`, shaped exactly as the RPC emits it. */
const bundleWithTickets = (
  tickets: Array<Record<string, unknown>>,
): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: "brand-2462",
  brandSlug: "wegoagainexhibition",
  eventSlug: "we-go-again-exhibition",
  name: "We Go Again Exhibition",
  description: "",
  status: "scheduled",
  tickets,
  brand: {
    id: "brand-2462",
    slug: "wegoagainexhibition",
    name: "We Go Again Exhibition",
    address: null,
    coverMediaUrl: null,
  },
});

const ticket = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "6aced218-02b0-4256-9597-a612fa11e198",
  name: "Day 2 Admission - 30th August",
  description: null,
  priceCents: 0,
  allInCents: 0,
  currency: null,
  capacity: 300,
  remaining: 229,
  isUnlimited: false,
  isFree: true,
  saleStartAt: null,
  saleEndAt: null,
  isHidden: false,
  isDisabled: false,
  requiresApproval: false,
  passwordProtected: false,
  availableOnline: true,
  availableInPerson: false,
  waitlistEnabled: false,
  displayOrder: 0,
  ...patch,
});

/**
 * Deliberately typed as the REAL `TicketStub`, not `Record<string, unknown>`:
 * that makes the assertions below a compile-time proof that these three fields
 * exist on the shape the cart consumes, as well as a runtime proof of the values.
 */
type ReadTickets = NonNullable<
  Awaited<ReturnType<typeof getPublicEventById>>
>["event"]["tickets"];

const readTickets = async (
  tickets: Array<Record<string, unknown>>,
): Promise<ReadTickets> => {
  mockRpc.mockImplementation((name: unknown) => {
    if (name !== "pg_direct_event_checkout_bundle") {
      throw new Error(`Unexpected RPC ${String(name)}`);
    }
    return Promise.resolve({ data: bundleWithTickets(tickets), error: null });
  });
  const detail = await getPublicEventById(EVENT_ID);
  // The bundle answered, so the fallback view must never be queried — otherwise
  // this test would be pinning the OTHER reader, which was never broken.
  expect(mockFrom).not.toHaveBeenCalled();
  return detail?.event.tickets ?? [];
};

describe("issue #2462 — the checkout bundle carries the organiser's purchase rules", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  test("the organiser's real min / max / transfers reach the cart", async () => {
    const [t] = await readTickets([
      ticket({ minPurchaseQty: 2, maxPurchaseQty: 1, allowTransfers: false }),
    ]);
    // THE BUG: this was `null`, so QuantityRow's clamp resolved to Infinity and
    // the stepper offered 229 on a ticket type capped at 1.
    expect(t.maxPurchaseQty).toBe(1);
    expect(t.minPurchaseQty).toBe(2);
    expect(t.allowTransfers).toBe(false);
  });

  test("a null cap SURVIVES as null — 'no cap' is a real answer, not a missing one", async () => {
    const [t] = await readTickets([
      ticket({ minPurchaseQty: 1, maxPurchaseQty: null, allowTransfers: true }),
    ]);
    expect(t.maxPurchaseQty).toBeNull();
    expect(t.minPurchaseQty).toBe(1);
    expect(t.allowTransfers).toBe(true);
  });

  test("a pre-#2462 bundle (keys absent) degrades to today's behaviour, never to a crash", async () => {
    // The real transitional window between shipping this client and applying the
    // migration. It must fail to the OLD defaults, not throw and not invent a cap.
    const [t] = await readTickets([ticket()]);
    expect(t.maxPurchaseQty).toBeNull();
    expect(t.minPurchaseQty).toBe(1);
    expect(t.allowTransfers).toBe(true);
  });

  test("a cap of 0 is not treated as 'no cap'", async () => {
    // `?? null` on a falsy check would turn 0 into "unlimited", which is the
    // exact class of coercion bug this issue is about. The schema does not
    // permit 0, so the honest mapping is to carry it through unchanged.
    const [t] = await readTickets([ticket({ maxPurchaseQty: 0 })]);
    expect(t.maxPurchaseQty).toBe(0);
  });
});
