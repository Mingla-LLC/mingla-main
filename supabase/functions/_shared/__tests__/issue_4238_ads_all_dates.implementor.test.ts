/**
 * Issue #4238 — one ad promotes every date of a series.
 *
 *   D1  The SQL resolver's schedule fields reach every caller of
 *       resolveAdDestination (ad-plan gates, hourly pause guard).
 *   D2  Failure messages for the new reasons are plain.
 *   D3  The legacy mirror: a past first date never ends a series; no
 *       bookable date left does; an RSVP off the Explorer feed is fine.
 *   D4  adScheduleBoundError: an ad on a dated page ends by the last
 *       bookable moment (missing / later end and late start refused).
 *   D5  Ari's words: "Covers all N dates until <day>" in the page's time
 *       zone, the default end, the refused later end, the refusal reasons.
 *
 * MINGLA-INVARIANT: I-4238-AD-ENDS-BY-LAST-BOOKABLE-MOMENT | issue #4238 | An ad plan for a dated offering ends on or before the offering's last bookable moment (the earliest of its last bookable date, its last ticket sale end and a trip's booking deadline); ad-plan refuses a missing or later end.
 */
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AdDestinationError, resolveAdDestination } from "../adDestination.ts";
import {
  adEffectiveScheduleEnd,
  adPageRefusalWords,
  adScheduleBoundError,
  adSeriesDatesWords,
} from "../adScheduleBound.ts";

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function viewDb(row: Record<string, unknown>) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return { from: () => query };
}

Deno.test("D1: RPC schedule fields pass through to callers", async () => {
  const next = iso(7 * 24 * HOUR);
  const last = iso(21 * 24 * HOUR);
  const resolved = await resolveAdDestination(
    {
      from() {
        throw new Error("legacy path must not run");
      },
      rpc: () =>
        Promise.resolve({
          data: {
            ok: true,
            page_type: "event",
            brand_slug: "acme",
            entity_slug: "weekly",
            event_id: "evt-1",
            venue_id: null,
            canonical_url: "https://host.usemingla.com/e/acme/weekly",
            availability: "available",
            availability_reason: null,
            result_kind: "tickets",
            next_date: next,
            last_bookable_at: last,
            dates_remaining: 3,
            timezone: "Africa/Lagos",
          },
          error: null,
        }),
    },
    { page_type: "event", brand_slug: "acme", entity_slug: "weekly" },
  );
  assertEquals(resolved.next_date, next);
  assertEquals(resolved.last_bookable_at, last);
  assertEquals(resolved.dates_remaining, 3);
  assertEquals(resolved.timezone, "Africa/Lagos");
});

Deno.test("D2: new refusal reasons read plainly and are not swallowed", async () => {
  for (
    const [availability, words] of [
      ["ended", "All of that page's dates have passed."],
      ["nothing_on_sale", "Nothing is on sale for that page right now."],
      ["bookings_closed", "Bookings are closed for that trip."],
      ["unlisted", "Unlisted trips and experiences can't be promoted."],
    ]
  ) {
    const err = await assertRejects(
      () =>
        resolveAdDestination(
          {
            from() {
              throw new Error("legacy path must not run");
            },
            rpc: () =>
              Promise.resolve({
                data: {
                  ok: false,
                  code: `destination_${availability}`,
                  availability,
                },
                error: null,
              }),
          },
          { page_type: "trip", brand_slug: "acme", entity_slug: "x" },
        ),
      AdDestinationError,
    );
    assertEquals(err.message, words);
    assertEquals(err.status, 422);
  }
});

Deno.test("D3: legacy mirror — a past first date never ends a series", async () => {
  const resolved = await resolveAdDestination(
    viewDb({
      id: "evt-1",
      brand_slug: "acme",
      slug: "weekly",
      status: "scheduled",
      event_type: "event",
      master_start_at: iso(-7 * 24 * HOUR),
      next_start_at: iso(7 * 24 * HOUR),
      upcoming_count: 3,
    }),
    { page_type: "event", brand_slug: "acme", entity_slug: "weekly" },
  );
  assertEquals(resolved.event_id, "evt-1");
  assertEquals(resolved.dates_remaining, 3);
});

Deno.test("D3: legacy mirror — no bookable date left is ended", async () => {
  const err = await assertRejects(
    () =>
      resolveAdDestination(
        viewDb({
          id: "evt-2",
          brand_slug: "acme",
          slug: "done",
          status: "scheduled",
          event_type: "event",
          next_start_at: null,
          upcoming_count: 0,
        }),
        { page_type: "event", brand_slug: "acme", entity_slug: "done" },
      ),
    AdDestinationError,
  );
  assertEquals(err.code, "destination_ended");
});

Deno.test("D3: legacy mirror — an RSVP off the Explorer feed is advertisable", async () => {
  const resolved = await resolveAdDestination(
    viewDb({
      id: "rsvp-1",
      brand_slug: "acme",
      slug: "dinner",
      status: "scheduled",
      event_type: "rsvp",
      rsvp_discoverable: false,
      next_start_at: iso(7 * 24 * HOUR),
      upcoming_count: 1,
    }),
    { page_type: "rsvp", brand_slug: "acme", entity_slug: "dinner" },
  );
  assertEquals(
    resolved.canonical_url,
    "https://host.usemingla.com/e/acme/dinner",
  );
});

Deno.test("D3: legacy mirror — a departed trip is ended", async () => {
  await assertRejects(
    () =>
      resolveAdDestination(
        viewDb({
          id: "trip-1",
          brand_slug: "acme",
          slug: "away",
          status: "scheduled",
          event_type: "trip",
          next_start_at: iso(-HOUR),
          upcoming_count: 1,
        }),
        { page_type: "trip", brand_slug: "acme", entity_slug: "away" },
      ),
    AdDestinationError,
  );
});

Deno.test("D4: schedule bound for a dated page", () => {
  const last = iso(10 * 24 * HOUR);
  const dest = { last_bookable_at: last };
  assertEquals(adScheduleBoundError({}, dest), "schedule_end_required");
  assertEquals(
    adScheduleBoundError({ ends_at: iso(11 * 24 * HOUR) }, dest),
    "schedule_ends_after_last_date",
  );
  assertEquals(
    adScheduleBoundError({ starts_at: last, ends_at: last }, dest),
    "schedule_starts_after_last_date",
  );
  assertEquals(
    adScheduleBoundError({ starts_at: "not a date", ends_at: last }, dest),
    "schedule_invalid",
  );
  assertEquals(adScheduleBoundError({ ends_at: last }, dest), null);
  assertEquals(
    adScheduleBoundError(
      { starts_at: iso(HOUR), ends_at: iso(5 * 24 * HOUR) },
      dest,
    ),
    null,
  );
});

Deno.test("D4: pages without dates are not bounded", () => {
  assertEquals(adScheduleBoundError({}, { page_type: "brand" }), null);
  assertEquals(adScheduleBoundError(undefined, null), null);
  assertEquals(adScheduleBoundError({}, { last_bookable_at: "garbage" }), null);
});

Deno.test("D4: ad-plan create_version refuses before saving a version", async () => {
  const source = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  const call = source.indexOf("adScheduleBoundError(");
  const save = source.indexOf('db.rpc("ad_plan_create_version"');
  assert(
    call > 0 && save > call,
    "schedule bound runs before ad_plan_create_version",
  );
});

Deno.test("D5: Ari's dates words use the page's time zone", () => {
  // 23:30 UTC on Sat 5 Dec is Sun 6 Dec in Lagos (UTC+1).
  const page = {
    last_bookable_at: "2026-12-05T23:30:00.000Z",
    timezone: "Africa/Lagos",
    dates_remaining: 5,
  };
  assertEquals(adSeriesDatesWords(page), "Covers all 5 dates until Sun 6 Dec");
  assertEquals(
    adSeriesDatesWords({ ...page, dates_remaining: 1 }),
    "Covers Sun 6 Dec",
  );
  assertEquals(adSeriesDatesWords({ page_type: "brand" }), null);
});

Deno.test("D5: Ari's end — default, kept, refused", () => {
  const page = {
    last_bookable_at: "2026-12-05T23:30:00.000Z",
    timezone: "Africa/Lagos",
  };
  assertEquals(adEffectiveScheduleEnd(undefined, page), {
    ok: true,
    endsAt: "2026-12-05T23:30:00.000Z",
  });
  assertEquals(adEffectiveScheduleEnd("2026-12-01T00:00:00.000Z", page), {
    ok: true,
    endsAt: "2026-12-01T00:00:00.000Z",
  });
  const late = adEffectiveScheduleEnd("2026-12-20T00:00:00.000Z", page);
  assertEquals(late.ok, false);
  assert(!late.ok && late.message.includes("Sun 6 Dec"));
  assertEquals(adEffectiveScheduleEnd(undefined, { page_type: "brand" }), {
    ok: true,
    endsAt: null,
  });
});

Deno.test("D5: refusal words name the reason plainly", () => {
  assert(adPageRefusalWords({ availability: "ended" }).includes("dates"));
  assert(
    adPageRefusalWords({ availability: "nothing_on_sale", page_type: "rsvp" })
      .includes("no spots"),
  );
  assert(
    adPageRefusalWords({ availability: "bookings_closed" }).includes(
      "Bookings are closed",
    ),
  );
  assert(adPageRefusalWords({ availability: "unlisted" }).includes("Unlisted"));
  for (
    const availability of [
      "draft",
      "private",
      "unlisted",
      "ended",
      "nothing_on_sale",
      "bookings_closed",
      "x",
    ]
  ) {
    assert(
      !/destination|provider|snapshot|canonical/i.test(
        adPageRefusalWords({ availability }),
      ),
    );
  }
});
