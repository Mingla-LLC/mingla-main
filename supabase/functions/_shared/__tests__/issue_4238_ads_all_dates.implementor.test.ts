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
 *   D6  (rework) Ari's cards: the Schedule row names plain days in the page's
 *       zone, never a raw timestamp, and agrees with the Dates row; a page
 *       the server greys out is refused BEFORE the card with the picker's own
 *       reason; the page lookup ignores slug case and spaces.
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
  adFindSetupPage,
  adPageRefusalWords,
  adPageUnavailableReason,
  adScheduleBoundError,
  adScheduleWords,
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
      .includes("No spots left."),
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

// ── D6: rework ──────────────────────────────────────────────────────────────

const D6_BRAND = "11111111-1111-4111-8111-111111111111";
// 23:30 UTC Sun 6 Dec = 00:30 Mon 7 Dec in Lagos.
const D6_PAGE = {
  page_type: "event",
  brand_slug: "femzy",
  entity_slug: "sunday-rooftop",
  ok: true,
  availability: "available",
  next_date: "2026-11-08T17:00:00+00:00",
  dates_remaining: 3,
  last_bookable_at: "2026-12-06T23:30:00+00:00",
  timezone: "Africa/Lagos",
};
const D6_ARGS = {
  brand_id: D6_BRAND,
  name: "Sunday Rooftop",
  dest_page_type: "event",
  dest_brand_slug: "femzy",
  dest_entity_slug: "sunday-rooftop",
  platforms: ["meta"],
  budget_cents: 20000,
  daily_budget_cents: 2000,
  countries: ["NG"],
};

function d6Client(page: Record<string, unknown>, actions: string[]) {
  return {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from() {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return query;
    },
    functions: {
      invoke(_name: string, request: { body: Record<string, unknown> }) {
        actions.push(String(request.body.action ?? ""));
        return Promise.resolve({
          data: { currency: "NGN", connections: [], pages: [page] },
          error: null,
        });
      },
    },
  } as never;
}

Deno.test("D6: schedule words are plain days in the page's zone", () => {
  assertEquals(
    adScheduleWords(undefined, "2026-12-06T23:30:00+00:00", "Africa/Lagos"),
    "Starts after approval · runs until Mon 7 Dec",
  );
  assertEquals(
    adScheduleWords("2026-11-08T17:00:00Z", null, "Africa/Lagos"),
    "Starts Sun 8 Nov · no end date",
  );
  assertEquals(
    adScheduleWords(undefined, "2026-12-06T23:30:00Z"),
    "Starts after approval · runs until Sun 6 Dec",
  );
});

Deno.test("D6: Ari's propose card names the same day in Dates and Schedule, no timestamp", async () => {
  const { preflightMoneyProposal } = await import("../agentDomainTools.ts");
  const context = await preflightMoneyProposal(
    "propose_ad_plan",
    { ...D6_ARGS },
    d6Client(D6_PAGE, []),
  ) as Record<string, unknown>;
  assertEquals(context.ad_dates, "Covers all 3 dates until Mon 7 Dec");
  assertEquals(
    context.ad_schedule,
    "Starts after approval · runs until Mon 7 Dec",
  );
  assert(!/\d{4}-\d{2}-\d{2}T/.test(String(context.ad_schedule)));
});

Deno.test("D6: Ari refuses a greyed-out page before the card, with the picker's reason", async () => {
  const { preflightMoneyProposal } = await import("../agentDomainTools.ts");
  for (
    const [availability, pageType, reason] of [
      ["nothing_on_sale", "rsvp", "No spots left."],
      ["ended", "event", "All its dates have passed."],
      ["private", "event", "This page is private, so an ad can't link to it."],
    ] as const
  ) {
    const actions: string[] = [];
    await assertRejects(
      () =>
        preflightMoneyProposal(
          "propose_ad_plan",
          { ...D6_ARGS, dest_page_type: pageType },
          d6Client({
            ...D6_PAGE,
            page_type: pageType,
            ok: false,
            availability,
            last_bookable_at: null,
          }, actions),
        ),
      Error,
      reason,
    );
    assertEquals(actions, ["host_setup"], availability);
  }
});

Deno.test("D6: Ari's page lookup ignores slug case and spaces", async () => {
  assertEquals(
    adFindSetupPage([D6_PAGE], {
      dest_page_type: "event",
      dest_brand_slug: " Femzy ",
      dest_entity_slug: "Sunday-Rooftop",
    }),
    D6_PAGE,
  );
  assertEquals(
    adFindSetupPage([D6_PAGE], {
      dest_page_type: "event",
      dest_brand_slug: "femzy",
      dest_entity_slug: "other",
    }),
    undefined,
  );
  const { preflightMoneyProposal } = await import("../agentDomainTools.ts");
  const context = await preflightMoneyProposal(
    "propose_ad_plan",
    { ...D6_ARGS, dest_entity_slug: "SUNDAY-ROOFTOP" },
    d6Client(D6_PAGE, []),
  ) as Record<string, unknown>;
  assertEquals(context.ad_dates, "Covers all 3 dates until Mon 7 Dec");
});

Deno.test("D6: Ari's refusal reasons are the Host picker's, word for word", async () => {
  const picker = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/components/marketing/ads/hostAdPageLabels.ts",
      import.meta.url,
    ),
  );
  const fn = picker.slice(
    picker.indexOf("export function hostAdPageUnavailableReason"),
  );
  for (
    const page of [
      { availability: "draft" },
      { availability: "private" },
      { availability: "unlisted", page_type: "trip" },
      { availability: "unlisted", page_type: "experience" },
      { availability: "ended" },
      { availability: "nothing_on_sale", page_type: "rsvp" },
      { availability: "nothing_on_sale", page_type: "event" },
      { availability: "bookings_closed" },
      { availability: "not_live" },
      { availability: "x" },
    ]
  ) {
    const reason = adPageUnavailableReason(page);
    assert(fn.includes(`"${reason}"`), `picker lacks: ${reason}`);
    assertEquals(
      adPageRefusalWords(page),
      `That page can't be promoted. ${reason}`,
    );
  }
});

Deno.test("D6: Ari's approve (LAUNCH) card names plain days in the page's zone, no timestamp", async () => {
  const { preflightMoneyProposal } = await import("../agentDomainTools.ts");
  const hash = "c".repeat(64);
  const planId = "d4238000-0000-4000-8000-000000000001";
  const versionId = "d4238000-0000-4000-8000-000000000002";
  const aggregate = {
    plan: { id: planId, brand_id: D6_BRAND, state: "ready_for_launch" },
    version: {
      id: versionId,
      plan_hash: hash,
      host_budget_cents: 20000,
      host_currency: "NGN",
      canonical_plan: {
        destination: { ...D6_PAGE, title: "Sunday Rooftop" },
        schedule: { ends_at: "2026-12-06T23:30:00.000Z" },
        audience_intent: { countries: ["NG"] },
      },
    },
    provider_allocations: [],
    targeting_snapshots: [],
  };
  const client = {
    rpc: () => Promise.resolve({ data: [], error: null }),
    functions: {
      invoke: () => Promise.resolve({ data: aggregate, error: null }),
    },
  };
  const context = await preflightMoneyProposal(
    "approve_ad_plan",
    {
      brand_id: D6_BRAND,
      plan_id: planId,
      plan_version_id: versionId,
      plan_hash: hash,
    },
    client,
  ) as Record<string, unknown>;
  assertEquals(context.ad_dates, "Covers all 3 dates until Mon 7 Dec");
  assertEquals(
    context.ad_schedule,
    "Starts after approval · runs until Mon 7 Dec",
  );
});
