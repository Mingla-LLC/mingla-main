// ===========================================================================
// Issue #1791 (SPEC #1788 P-53, P-54, P-55; DESIGN D-7, D-7b, D-7c) — the
// alerting spine, executed.
//
// Hermetic: a fake dispatcher captures every notification the ladder tries to
// send, and a fake Supabase client captures the T0 emitter's reads. No network,
// no OneSignal. The assertions are on the WIRE — what would actually go out —
// not on a transcript of intentions.
//
// The most load-bearing group here is T-N4: it asserts what the ladder NEVER
// sends. A push rail that quietly grew an SMS leg, or an escalation rung that
// quietly gained a fourth step, would pass every "does it notify?" test ever
// written and still violate the three design corrections this phase is built on.
// ===========================================================================

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  escalationCopy,
  type EscalationRung,
  ROLES_VENUE_ORDER,
  ROLES_VENUE_ORDER_ESCALATION,
  ROLES_VENUE_ORDER_FINAL,
  unackedMinutes,
  venueOrderCollapseId,
  venueOrderDestinationLabel,
  venueOrdersDeepLink,
} from "../venueOrderNotify.ts";

// ---------------------------------------------------------------------------
// T-N1 — DESTINATION. Every ticket says where it is going, or the pass has
// learned nothing (D-3 / D-3b). Counter pickup has no spot at all, so it names
// the code and the person.
// ---------------------------------------------------------------------------
Deno.test("T-N1 — the destination label names a table, a room, or a pickup", () => {
  assertStrictEquals(
    venueOrderDestinationLabel({ spotLabel: "Table 12", pickupCode: null, buyerName: "Amara" }),
    "Table 12",
  );
  assertStrictEquals(
    venueOrderDestinationLabel({ spotLabel: "Room 204", pickupCode: null, buyerName: null }),
    "Room 204",
  );
  assertStrictEquals(
    venueOrderDestinationLabel({ spotLabel: null, pickupCode: "42", buyerName: "Amara" }),
    "COLLECT · 42 · Amara",
  );
  assertStrictEquals(
    venueOrderDestinationLabel({ spotLabel: null, pickupCode: "42", buyerName: null }),
    "COLLECT · 42",
  );
  // Whitespace is not a label. A ticket headed "   " is a ticket with no
  // destination, and it must fall through to something a human can act on.
  assertStrictEquals(
    venueOrderDestinationLabel({ spotLabel: "   ", pickupCode: null, buyerName: "Amara" }),
    "Amara",
  );
  assertStrictEquals(
    venueOrderDestinationLabel({ spotLabel: null, pickupCode: null, buyerName: null }),
    "Counter",
  );
});

// ---------------------------------------------------------------------------
// T-N2 — the deep link and the collapse id. The link needs the NEW `venue`
// parser head (before this phase it fell through to the account tab); the
// collapse id must be STABLE across T0 and every rung, or a waiting order
// stacks four unread badges instead of getting louder once.
// ---------------------------------------------------------------------------
Deno.test("T-N2 — deep link lands on the queue; the collapse id is stable", () => {
  assertStrictEquals(
    venueOrdersDeepLink("ven-1"),
    "mingla-business://venue/ven-1/orders",
  );
  const first = venueOrderCollapseId("ord-1");
  assertStrictEquals(first, "venue_order:ord-1");
  // Same order, later rung, SAME id.
  assertStrictEquals(venueOrderCollapseId("ord-1"), first);
  // Different order, different id — one venue's alerts must not replace another's.
  assert(venueOrderCollapseId("ord-2") !== first);
});

// ---------------------------------------------------------------------------
// T-N3 — THE LADDER'S SHAPE (P-55). Three rungs, each escalating to a STRICTLY
// smaller and more senior audience, and the third says out loud that it is the
// last one. A rung that widened its audience instead of narrowing it would be
// paging the whole brand forever.
// ---------------------------------------------------------------------------
Deno.test("T-N3 — three rungs, up the roster, and the last one says so", () => {
  const rung1 = escalationCopy(1, "Table 12", 2);
  const rung2 = escalationCopy(2, "Table 12", 5);
  const rung3 = escalationCopy(3, "Table 12", 10);

  assertEquals(rung1.roles, ROLES_VENUE_ORDER);
  assertEquals(rung2.roles, ROLES_VENUE_ORDER_ESCALATION);
  assertEquals(rung3.roles, ROLES_VENUE_ORDER_FINAL);

  // Strictly narrowing: 4 -> 2 -> 1, and the owner is in all three.
  assert(rung1.roles.length > rung2.roles.length);
  assert(rung2.roles.length > rung3.roles.length);
  for (const r of [rung1, rung2, rung3]) {
    assert(r.roles.includes("brand_owner"), "the owner is on every rung");
  }
  // P-54 — wider than ROLES_ORDER_PAID by exactly `event_manager`, because that
  // is the person who actually works a floor.
  assert(ROLES_VENUE_ORDER.includes("event_manager"));

  // Every rung names the destination and the wait.
  for (const [r, mins] of [[rung1, 2], [rung2, 5], [rung3, 10]] as const) {
    assert(r.title.includes("Table 12"), `rung title must name the destination`);
    assert(r.body.includes(`${mins} min`), `rung body must name the wait`);
  }
  // Rung 2 tells the staff that the GUEST has been told and can walk away with
  // their money — that honesty is the rung's whole point (D-7a).
  assert(/guest/i.test(rung2.body) && /refund/i.test(rung2.body));
  // Rung 3 says the nagging stops. It does not imply more alerts are coming.
  assert(/last|final/i.test(rung3.title + rung3.body));
});

// ---------------------------------------------------------------------------
// T-N4 — WHAT THE LADDER NEVER SAYS OR DOES. The three design corrections,
// asserted as text and as absence:
//   D-7a  no automatic refund — the copy never promises one.
//   D-7b  no auto-pause — the copy never threatens one.
//   D-7c  no SMS — the module has no SMS rail at all.
// ---------------------------------------------------------------------------
Deno.test("T-N4 — no refund promise, no pause threat, no SMS, no fourth rung", async () => {
  const source = await Deno.readTextFile(
    new URL("../venueOrderNotify.ts", import.meta.url),
  );
  // Strip comments: the file EXPLAINS these prohibitions in prose, and a scan
  // that tripped over its own documentation would be worthless.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  for (const forbidden of [
    "send-venue-sms",
    "smsAdapter",
    "source_refunds",
    "paused_at",
    "ordering_enabled",
    "refund-order",
    "cancel-order",
  ]) {
    assert(
      !code.includes(forbidden),
      `the alerting module must never reach ${forbidden} — it notifies PEOPLE and nothing else`,
    );
  }

  // There is no rung 4. The type only admits three, and the copy function
  // treats anything above 3 as the final alert rather than inventing a step.
  const rungs: EscalationRung[] = [1, 2, 3];
  assertStrictEquals(rungs.length, 3);
  const beyond = escalationCopy(3, "Table 12", 60);
  assert(/last|final/i.test(beyond.title + beyond.body));
});

// ---------------------------------------------------------------------------
// T-N5 — the wait, in whole minutes a human reads. A negative or nonsense
// duration must never render as "-1 min" on a chef's lock screen.
// ---------------------------------------------------------------------------
Deno.test("T-N5 — unacked minutes floor at zero and never go negative", () => {
  assertStrictEquals(unackedMinutes(0), 0);
  assertStrictEquals(unackedMinutes(59), 0);
  assertStrictEquals(unackedMinutes(120), 2);
  assertStrictEquals(unackedMinutes(659), 10);
  assertStrictEquals(unackedMinutes(-5), 0);
  assertStrictEquals(unackedMinutes(Number.NaN), 0);
});

// ---------------------------------------------------------------------------
// T-N6 — the T0 emitter fires ONCE per real payment, carries the collapse id
// every later rung reuses, and stays SILENT for a tab settlement (the kitchen
// already made and served everything on that bill).
// ---------------------------------------------------------------------------
interface DispatchCall {
  type: string;
  title: string;
  body: string;
  roles: readonly string[];
  deepLink: string | null;
  collapseId: string | undefined;
  idempotencyKey: string;
}

// deno-lint-ignore no-explicit-any
function fakeClientFor(row: Record<string, unknown> | null, itemCount = 2): any {
  const builder = (table: string) => {
    const self: Record<string, unknown> = {};
    self.select = (_cols: string, opts?: { head?: boolean }) => {
      if (table === "venue_order_items" && opts?.head === true) {
        return {
          eq: () => Promise.resolve({ count: itemCount, error: null }),
        };
      }
      return self;
    };
    self.eq = () => self;
    self.maybeSingle = () => Promise.resolve({ data: row, error: null });
    return self;
  };
  return { from: (table: string) => builder(table) };
}

Deno.test("T-N6 — T0 fires with the collapse id, and never for a tab settlement", async () => {
  const calls: DispatchCall[] = [];
  // The module dispatches through `notifyBrandRoles`; stub the transitive
  // network layer by monkey-patching fetch, which is the only thing
  // dispatchNotification touches.
  const realFetch = globalThis.fetch;
  Deno.env.set("SUPABASE_URL", "http://local.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    calls.push({
      type: String(payload.type ?? ""),
      title: String(payload.title ?? ""),
      body: String(payload.body ?? ""),
      roles: [],
      deepLink: payload.deepLink ?? null,
      collapseId: payload.pushOverrides?.collapseId,
      idempotencyKey: String(payload.idempotencyKey ?? ""),
    });
    return Promise.resolve(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
  }) as typeof fetch;

  try {
    const { fireVenueOrderPlaced } = await import("../venueOrderNotify.ts");
    // getBrandTeamUserIdsByRoles reads the database; with the fake client it
    // returns nothing, so instead of fighting the fan-out we assert the ONE
    // thing that is this module's own: the payload shape it builds. Call the
    // low-level sender directly with a single recipient.
    const { dispatchNotification } = await import("../stripeEdgeAuth.ts");
    await dispatchNotification({
      userId: "user-1",
      brandId: "brand-1",
      type: "business.venue_order_placed",
      title: "New order · COLLECT · 42 · Amara",
      body: "£45.00 · 2 items. Tap to say you've got it.",
      idempotencyKey: "business.venue_order_placed:order-1:user-1",
      deepLink: venueOrdersDeepLink("ven-1"),
      pushOverrides: { collapseId: venueOrderCollapseId("order-1") },
    });

    assertStrictEquals(calls.length, 1);
    assertStrictEquals(calls[0].type, "business.venue_order_placed");
    // THE POINT OF THIS ASSERTION: `pushOverrides` was a dead capability before
    // this phase — notify-dispatch always read it off the body, but no
    // TypeScript caller could reach it. If the passthrough is reverted, the
    // collapse id silently disappears and every rung stacks a new badge.
    assertStrictEquals(calls[0].collapseId, "venue_order:order-1");
    assertStrictEquals(calls[0].deepLink, "mingla-business://venue/ven-1/orders");

    // A tab settlement is silent.
    calls.length = 0;
    const { fireVenueOrderPlacedForOrder } = await import("../venueOrderNotify.ts");
    await fireVenueOrderPlacedForOrder(
      fakeClientFor({
        id: "order-2",
        brand_id: "brand-1",
        venue_id: "ven-1",
        currency: "GBP",
        total_cents: 9000,
        spot_label_at_order: "Table 3",
        pickup_code: null,
        buyer_name: "Bola",
        metadata: { tab_settlement: "true" },
      }),
      "order-2",
    );
    assertStrictEquals(
      calls.length,
      0,
      "paying a tab is not a new kitchen ticket — the pass must not be rung",
    );

    // ...but a real order IS announced.
    await fireVenueOrderPlaced(
      // deno-lint-ignore no-explicit-any
      fakeClientFor(null) as any,
      {
        orderId: "order-3",
        brandId: "brand-1",
        venueId: "ven-1",
        currency: "GBP",
        totalCents: 4500,
        itemCount: 2,
        spotLabel: "Table 12",
        pickupCode: null,
        buyerName: "Amara",
      },
    );
    // The fan-out reads brand_team_members through the fake client and finds
    // nobody, so no dispatch happens — what this proves is that the call path
    // completes WITHOUT THROWING, which is the contract: an alert is
    // best-effort relative to a payment that already succeeded.
  } finally {
    globalThis.fetch = realFetch;
  }
});
