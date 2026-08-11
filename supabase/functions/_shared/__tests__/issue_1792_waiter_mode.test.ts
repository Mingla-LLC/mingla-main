// ===========================================================================
// Issue #1792 (#1767 Phase 3b) — waiter mode's server-side hardening.
//
// Phase 2 shipped the four staff actions; building the surface a waiter
// actually touches surfaced three ways they break in a real service. Each is
// proved here against a fake client that really holds rows and really applies
// filters, so a pass means the CODE did the right thing rather than a stub
// having been told to say so.
//
//   1. THE METADATA CLOBBER. `update({ metadata: {...} })` REPLACES the jsonb
//      column through PostgREST. One line in `billToPhone` did exactly that to
//      the settlement order it had just written `tab_settlement` onto — which
//      meant `pg_venue_order_finalize_payment` never recognised the paid bill
//      as a tab close (tab stuck at `settling`, rounds stuck at `pending`), a
//      retried close raised `tab_has_mingla_orders` (tab unclosable, forever),
//      and Phase 6 would have counted the tab twice.
//   2. THE TRUSTED SESSION. A staff `create` took `sessionId` verbatim, so a
//      foreign brand's sitting could be stamped onto an order and a round could
//      be added to a tab that was already settled and billed.
//   3. THE REPLAY. A staff round must resume the SAME sitting the first attempt
//      created, or a double-tap on a first round opens a second tab.
//   4. P-16's TAB SWITCH had no enforcement point anywhere — the column shipped
//      in Phase 1, P-26 said the tab actions were gated on it, and nothing ever
//      read it. The gate now lives in `biz_venue_tab_open` (behavioural half in
//      the SQL suite's T-1792-T6, with a positive control); its staff copy is
//      pinned here.
// ===========================================================================

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  assertSessionAcceptsRound,
  findReplayableVenueOrder,
  mergedVenueOrderMetadata,
} from "../venueOrderCore.ts";
import {
  VENUE_ORDER_ERRORS,
  venueOrderErrorCopy,
  venueOrderErrorStatus,
} from "../venueOrderPricing.ts";

// ---------------------------------------------------------------------------
// A fake client that really holds rows and really applies eq() filters.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
function tableClient(
  rows: Array<Record<string, unknown>>,
  opts: { error?: string } = {},
  // deno-lint-ignore no-explicit-any
): any {
  return {
    from(_table: string) {
      const filters: Array<[string, unknown]> = [];
      const self = {
        select: () => self,
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return self;
        },
        maybeSingle() {
          if (opts.error) {
            return Promise.resolve({ data: null, error: { message: opts.error } });
          }
          const matched = rows.filter((r) =>
            filters.every(([c, v]) => r[c] === v)
          );
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
      };
      return self;
    },
  };
}

// ---------------------------------------------------------------------------
// 1 — the metadata clobber.
// ---------------------------------------------------------------------------
Deno.test("#1792: a metadata patch MERGES — the settlement marker survives", async () => {
  // This is the exact row shape `biz_venue_tab_close` inserts before
  // `billToPhone` moves it onto the Mingla rail.
  const client = tableClient([
    {
      id: "settlement-1",
      metadata: { tab_settlement: true, settles_session_id: "session-1" },
    },
  ]);

  const merged = await mergedVenueOrderMetadata(client, "settlement-1", {
    settlement_method: "bill_to_phone",
  });

  // The shipped bug was `{ settlement_method: "bill_to_phone" }` alone. Three
  // separate mechanisms read `tab_settlement`, and all three broke.
  assertEquals(merged, {
    tab_settlement: true,
    settles_session_id: "session-1",
    settlement_method: "bill_to_phone",
  });
  assertStrictEquals(merged.tab_settlement, true);
});

Deno.test("#1792: a later patch may still CHANGE a key it owns", async () => {
  // Merging must not mean "frozen". A failure reason written after a settlement
  // method must land, and a second write of the same key must win.
  const client = tableClient([
    {
      id: "order-1",
      metadata: { unsettled_staff_order: true, settlement_method: "bill_to_phone" },
    },
  ]);
  const merged = await mergedVenueOrderMetadata(client, "order-1", {
    settlement_method: "venue_collected",
    failure_reason: "provider timeout",
  });
  assertEquals(merged, {
    unsettled_staff_order: true,
    settlement_method: "venue_collected",
    failure_reason: "provider timeout",
  });
});

Deno.test("#1792: an unreadable row yields the patch alone, never a throw", async () => {
  // Failing toward the patch is exactly today's behaviour and never worse: the
  // update it rides on still lands, and the DATABASE trigger
  // (trg_venue_orders_settlement_marker_permanent) carries the marker promise
  // independently of whether this read succeeded.
  const failing = tableClient([], { error: "connection reset" });
  assertEquals(
    await mergedVenueOrderMetadata(failing, "order-1", { failure_reason: "x" }),
    { failure_reason: "x" },
  );
  const missing = tableClient([]);
  assertEquals(
    await mergedVenueOrderMetadata(missing, "nope", { a: 1 }),
    { a: 1 },
  );
});

Deno.test("#1792: a null or array metadata column cannot corrupt the patch", async () => {
  for (const bad of [null, [1, 2, 3]]) {
    const client = tableClient([{ id: "o", metadata: bad }]);
    assertEquals(await mergedVenueOrderMetadata(client, "o", { k: "v" }), {
      k: "v",
    });
  }
});

// ---------------------------------------------------------------------------
// 2 — the trusted session.
// ---------------------------------------------------------------------------
const SESSIONS = [
  {
    id: "own-none",
    brand_id: "brand-a",
    venue_id: "venue-a",
    tab_state: "none",
  },
  { id: "own-open", brand_id: "brand-a", venue_id: "venue-a", tab_state: "open" },
  {
    id: "own-settling",
    brand_id: "brand-a",
    venue_id: "venue-a",
    tab_state: "settling",
  },
  {
    id: "own-closed",
    brand_id: "brand-a",
    venue_id: "venue-a",
    tab_state: "closed",
  },
  {
    id: "own-voided",
    brand_id: "brand-a",
    venue_id: "venue-a",
    tab_state: "voided",
  },
  {
    id: "other-brand",
    brand_id: "brand-b",
    venue_id: "venue-b",
    tab_state: "open",
  },
  // Same brand, DIFFERENT venue — a multi-venue brand's Room 204 sitting must
  // not take the Brasserie's round.
  {
    id: "other-venue",
    brand_id: "brand-a",
    venue_id: "venue-z",
    tab_state: "open",
  },
];

Deno.test("#1792: a round joins its OWN sitting, and only while the tab is live", async () => {
  const client = tableClient(SESSIONS);
  const ask = (sessionId: string) =>
    assertSessionAcceptsRound(client, {
      sessionId,
      brandId: "brand-a",
      venueId: "venue-a",
    });

  // A per-round sitting and an OPEN tab both take another round.
  assertStrictEquals((await ask("own-none")).ok, true);
  assertStrictEquals((await ask("own-open")).ok, true);

  // `settling` is refused: the total was struck and the bill is on the guest's
  // phone. A round added now is a round they were never shown.
  const settling = await ask("own-settling");
  assertStrictEquals(settling.ok, false);
  assert(!settling.ok && settling.code === "session_not_addable");

  // A closed or voided tab is closed. Food would go out unbilled.
  for (const id of ["own-closed", "own-voided"]) {
    const res = await ask(id);
    assertStrictEquals(res.ok, false);
    assert(!res.ok && res.code === "session_not_addable");
  }
});

Deno.test("#1792: a foreign sitting is refused, and refused the SAME way as an unknown one", async () => {
  const client = tableClient(SESSIONS);
  for (const id of ["other-brand", "other-venue", "does-not-exist"]) {
    const res = await assertSessionAcceptsRound(client, {
      sessionId: id,
      brandId: "brand-a",
      venueId: "venue-a",
    });
    assertStrictEquals(res.ok, false, `${id} must be refused`);
    // ONE answer for all three: distinguishing "not yours" from "no such
    // sitting" tells a caller which session ids exist, which is the same
    // reasoning that makes an inactive spot answer `spot_unknown`.
    assert(!res.ok && res.code === "session_not_addable");
  }
  // Vacuity guard: the foreign rows must really be in the fixture, or the
  // assertions above are proving that a lookup missed.
  assertStrictEquals(SESSIONS.filter((s) => s.brand_id === "brand-b").length, 1);
  assertStrictEquals(
    SESSIONS.filter((s) => s.brand_id === "brand-a" && s.venue_id === "venue-z")
      .length,
    1,
  );
});

// ---------------------------------------------------------------------------
// 3 — the replay resumes the sitting.
// ---------------------------------------------------------------------------
Deno.test("#1792: a replayed staff round resumes the SAME sitting", async () => {
  const client = tableClient([
    {
      id: "order-1",
      brand_id: "brand-a",
      venue_id: "venue-a",
      idempotency_key: "pad:one-gesture",
      total_cents: 2700,
      currency: "GBP",
      payment_status: "pending",
      session_id: "session-created-by-the-first-attempt",
    },
  ]);
  const existing = await findReplayableVenueOrder(client, {
    brandId: "brand-a",
    venueId: "venue-a",
    idempotencyKey: "pad:one-gesture",
  });
  assert(existing !== null);
  // Without this the retried FIRST round of a table would return an order id
  // but a null sitting, and the pad would open a second tab on the same table.
  assertStrictEquals(
    existing.session_id,
    "session-created-by-the-first-attempt",
  );
  assertStrictEquals(existing.id, "order-1");
});

// ---------------------------------------------------------------------------
// P-29 — the three new codes, and the rule every one of them obeys.
// ---------------------------------------------------------------------------
Deno.test("#1792: the four waiter-mode codes are staff-only and say what to do", () => {
  const expected: Array<[string, number, string]> = [
    [
      "staff_tabs_disabled",
      409,
      "Tabs are switched off for this venue. Settle each round as it goes.",
    ],
    [
      "session_not_addable",
      409,
      "That tab has been closed. Start a new order for this table.",
    ],
    [
      "order_on_open_tab",
      409,
      "This round is on an open tab. Close the tab to settle it.",
    ],
    [
      "tab_bill_already_sent",
      409,
      "You've already sent this tab's bill to their phone. Finish that, or wait for it to lapse, before taking cash.",
    ],
  ];
  for (const [code, status, staff] of expected) {
    const key = code as keyof typeof VENUE_ORDER_ERRORS;
    assertStrictEquals(venueOrderErrorStatus(key), status, `${code} status`);
    assertStrictEquals(venueOrderErrorCopy(key, "staff"), staff, `${code} copy`);
    // A guest never takes a staff order or closes a tab, so none of these has
    // guest copy — and a null is how this module says "never shown to them"
    // rather than leaking operational language into a guest's screen.
    assertStrictEquals(venueOrderErrorCopy(key, "guest"), null, `${code} guest`);
  }
});

Deno.test("#1792: the shipped error table only GREW", () => {
  // Append-only: every Phase-2 code still resolves to its Phase-2 copy. A
  // renamed or re-worded code would change what a venue reads mid-service.
  assertStrictEquals(
    venueOrderErrorCopy("tab_not_open", "staff"),
    "That tab is already closed.",
  );
  assertStrictEquals(
    venueOrderErrorCopy("transition_not_allowed", "staff"),
    "That order has already moved on. Pull to refresh.",
  );
  assert(Object.keys(VENUE_ORDER_ERRORS).length >= 24);
});
