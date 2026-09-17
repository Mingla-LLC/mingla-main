// ISSUE-3392 — a guest's private manage link must open the booking it was
// issued for, even when there is no refund.
//
// Before: `venue-reservation-refund-status` asked only
// `pg_guest_venue_refund_summary`, which raises `reservation_not_found` when a
// booking has no refund row. Every free booking (and every paid booking before
// a refund) opened the manage page to "We couldn't open this reservation."
//
// These tests drive the REAL `loadGuestReservationManageView` against a
// recording fake client (hermetic — no network):
//   M1  a valid token for a free, upcoming booking → view with canCancel=true,
//       looked up by THAT reservation id AND the v1 sha256 token hash.
//   M2  a wrong token → null (the caller answers 404, same as unknown id).
//   M3  a malformed id or an empty token → null with ZERO queries.
//   M4  cancelled / past / seated bookings → canCancel=false.
//   M5  the view never carries guest contact or payment identifiers.
//   M6  the edge function answers the guest path from this view and treats
//       "no refund row" as refund=null instead of a 404.
//
// FAILS-ON-REVERT: restoring the refund-only guest path in
// venue-reservation-refund-status/index.ts turns M6 RED; removing the token
// hash filter turns M1/M2 RED.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  guestCancelTokenHash,
  loadGuestReservationManageView,
} from "../guestReservationManageView.ts";

const RESERVATION_ID = "8b0f2f7a-3c1e-4d7b-9a51-6f1d2c3b4a5e";
const VENUE_ID = "2d6c8e4a-1b3f-4a5c-8d7e-9f0a1b2c3d4e";
const TOKEN = "guest-token-3392";

interface Recorded {
  table: string;
  filters: Array<[string, unknown]>;
}

function fakeClient(rows: {
  sessions: Array<Record<string, unknown>>;
  reservations: Array<Record<string, unknown>>;
  venues: Array<Record<string, unknown>>;
}) {
  const calls: Recorded[] = [];
  const tables: Record<string, Array<Record<string, unknown>>> = {
    reservation_checkout_sessions: rows.sessions,
    reservations: rows.reservations,
    venue_listings: rows.venues,
  };
  return {
    calls,
    from(table: string) {
      const record: Recorded = { table, filters: [] };
      calls.push(record);
      const builder = {
        select: () => builder,
        limit: () => builder,
        eq(column: string, value: unknown) {
          record.filters.push([column, value]);
          return builder;
        },
        maybeSingle() {
          const match = (tables[table] ?? []).find((row) =>
            record.filters.every(([column, value]) => row[column] === value)
          );
          return Promise.resolve({ data: match ?? null, error: null });
        },
      };
      return builder;
    },
  };
}

async function fixture(overrides: Record<string, unknown> = {}) {
  return fakeClient({
    sessions: [{
      reservation_id: RESERVATION_ID,
      venue_id: VENUE_ID,
      guest_cancel_token_hash: await guestCancelTokenHash(TOKEN),
      buyer_email: "guest@example.com",
    }],
    reservations: [{
      id: RESERVATION_ID,
      status: "confirmed",
      payment_status: "none",
      reserved_for: "2026-09-20T19:30:00.000Z",
      party_size: 4,
      venue_id: VENUE_ID,
      guest_phone_e164: "+19195550100",
      guest_email: "guest@example.com",
      ...overrides,
    }],
    venues: [{ id: VENUE_ID, name: "Rooftop Kitchen" }],
  });
}

const NOW = new Date("2026-09-15T12:00:00.000Z");

Deno.test("M1: a valid token opens a free upcoming booking, scoped to id + token hash", async () => {
  const client = await fixture();
  const view = await loadGuestReservationManageView(client, {
    reservationId: RESERVATION_ID,
    guestToken: TOKEN,
    now: NOW,
  });
  assertEquals(view, {
    status: "confirmed",
    paymentStatus: "none",
    reservedForUtc: "2026-09-20T19:30:00.000Z",
    partySize: 4,
    venueName: "Rooftop Kitchen",
    canCancel: true,
  });
  const sessionLookup = client.calls.find((c) =>
    c.table === "reservation_checkout_sessions"
  );
  assert(sessionLookup);
  assertEquals(sessionLookup.filters, [
    ["reservation_id", RESERVATION_ID],
    ["guest_cancel_token_hash", await guestCancelTokenHash(TOKEN)],
  ]);
});

Deno.test("M2: a wrong token is indistinguishable from an unknown booking", async () => {
  const client = await fixture();
  const view = await loadGuestReservationManageView(client, {
    reservationId: RESERVATION_ID,
    guestToken: "not-the-token",
    now: NOW,
  });
  assertEquals(view, null);
  assertEquals(
    client.calls.some((c) => c.table === "reservations"),
    false,
  );
});

Deno.test("M3: malformed ids and empty tokens never query", async () => {
  const client = await fixture();
  assertEquals(
    await loadGuestReservationManageView(client, {
      reservationId: "not-a-uuid",
      guestToken: TOKEN,
    }),
    null,
  );
  assertEquals(
    await loadGuestReservationManageView(client, {
      reservationId: RESERVATION_ID,
      guestToken: "   ",
    }),
    null,
  );
  assertEquals(client.calls.length, 0);
});

Deno.test("M4: only upcoming requested/confirmed/waitlisted bookings can be cancelled", async () => {
  for (
    const [overrides, expected] of [
      [{ status: "cancelled_by_guest" }, false],
      [{ status: "cancelled_by_venue", payment_status: "paid" }, false],
      [{ status: "seated" }, false],
      [{ status: "confirmed", reserved_for: "2026-09-01T19:30:00.000Z" }, false],
      [{ status: "requested" }, true],
      [{ status: "waitlisted" }, true],
    ] as Array<[Record<string, unknown>, boolean]>
  ) {
    const view = await loadGuestReservationManageView(
      await fixture(overrides),
      { reservationId: RESERVATION_ID, guestToken: TOKEN, now: NOW },
    );
    assert(view);
    assertEquals(view.canCancel, expected, JSON.stringify(overrides));
  }
});

Deno.test("M5: the view carries booking facts only — no contact or payment identifiers", async () => {
  const view = await loadGuestReservationManageView(await fixture({
    payment_status: "paid",
  }), { reservationId: RESERVATION_ID, guestToken: TOKEN, now: NOW });
  assert(view);
  assertEquals(Object.keys(view).sort(), [
    "canCancel",
    "partySize",
    "paymentStatus",
    "reservedForUtc",
    "status",
    "venueName",
  ]);
  assertEquals(view.paymentStatus, "paid");
});

Deno.test("M6: the refund-status guest path answers from the manage view and tolerates no refund", async () => {
  const source = await Deno.readTextFile(
    new URL("../../venue-reservation-refund-status/index.ts", import.meta.url),
  );
  assert(source.includes("loadGuestReservationManageView("));
  assert(source.includes('message.includes("reservation_not_found")'));
  assert(source.includes("reservation: view"));
});
