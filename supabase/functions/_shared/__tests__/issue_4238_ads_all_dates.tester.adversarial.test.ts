/**
 * #4238 — tester adversarial suite for "one ad covers every date".
 * Attacks angles the implementor's suite does not:
 *
 *  P. The hourly pause guard (admin-ad-spend-sync) pauses a live ad exactly
 *     when resolveAdDestination throws a < 500 AdDestinationError. Fed the
 *     resolver's own payloads (shapes taken from the pg17 run): after the first
 *     date it must NOT throw; after the last date, or with nothing on sale, it
 *     must throw 422.
 *  C. ad-plan create_version, END TO END through handleAdPlan (fake db, no
 *     network), on an Admin (Mingla) plan for a dated page: a hostile schedule
 *     cannot get past the cap — 1 ms late, a later instant written with a
 *     +01:00 offset, no end, an end in the wrong field, a schedule array, a
 *     start at the limit, a five-digit year. An end EQUAL to the last bookable
 *     moment (Postgres microseconds vs JS milliseconds) passes, and nothing is
 *     saved for any refusal. A page without dates is not bounded.
 *  A. Ari's propose_ad_plan executor: no end → the plan carries the last
 *     bookable moment; a later end, or a page the server greys out, stops
 *     BEFORE any plan is opened. A slug in a different case gets the same
 *     default and cap (#4238 rework); the server bound in C is the backstop.
 *  F. freeze_targeting and the launch path cannot move the schedule.
 *
 * Fails on revert: deleting the adScheduleBoundError call in ad-plan
 * create_version fails C (version saved); restoring the `master_start_at`
 * rule is covered by the pg17 suite; deleting adEffectiveScheduleEnd in
 * propose_ad_plan fails A.
 */

// adChannel.ts owns the adapter registry and forms a cycle with the provider
// modules; evaluate it first, as every edge entrypoint does.
import "../adChannel.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AdDestinationError, resolveAdDestination } from "../adDestination.ts";
import { findTool } from "../agentTools.ts";
import {
  ADMIN,
  adminTables,
  callAdPlan,
  FakeAdPlanDb,
  videoCreative,
} from "../../ad-plan/__tests__/fakeAdPlanDb.ts";

type Row = Record<string, unknown>;

// ── P: the pause guard ──────────────────────────────────────────────────────

const rpcDb = (payload: Row) => ({
  from() {
    throw new Error("legacy path must not run");
  },
  rpc: () => Promise.resolve({ data: payload, error: null }),
});

/** admin-ad-spend-sync's decision, verbatim (index.ts, ACTIVE branch). */
async function pauseGuard(payload: Row): Promise<string | null> {
  try {
    await resolveAdDestination(rpcDb(payload), {
      page_type: "event",
      brand_slug: "issue-4238-tester",
      entity_slug: "weekly",
    });
    return null;
  } catch (err) {
    return err instanceof AdDestinationError && err.status < 500
      ? "destination_unavailable"
      : "destination_check_failed";
  }
}

const AFTER_FIRST_DATE = {
  ok: true,
  page_type: "event",
  brand_slug: "issue-4238-tester",
  entity_slug: "weekly",
  event_id: "42385555-1000-4000-8000-000000000003",
  venue_id: null,
  canonical_url: "https://host.usemingla.com/e/issue-4238-tester/weekly",
  availability: "available",
  availability_reason: null,
  result_kind: "tickets",
  starts_at: "2026-11-17T13:41:06.646695+00:00",
  next_date: "2026-11-17T13:41:06.646695+00:00",
  dates_remaining: 1,
  last_bookable_at: "2026-11-17T16:41:06.646695+00:00",
  timezone: "Africa/Lagos",
};

Deno.test("#4238 P a live ad after its FIRST date is not paused", async () => {
  assertEquals(await pauseGuard(AFTER_FIRST_DATE), null);
});

Deno.test("#4238 P a live ad after its LAST date (or with nothing on sale) is paused", async () => {
  for (
    const payload of [
      {
        ok: false,
        code: "destination_ended",
        availability: "ended",
        dates_remaining: 0,
        next_date: null,
        last_bookable_at: null,
      },
      {
        ok: false,
        code: "destination_nothing_on_sale",
        availability: "nothing_on_sale",
        dates_remaining: 2,
      },
      {
        ok: false,
        code: "destination_bookings_closed",
        availability: "bookings_closed",
        dates_remaining: 2,
      },
    ]
  ) {
    assertEquals(
      await pauseGuard(payload),
      "destination_unavailable",
      String(payload.code),
    );
  }
});

Deno.test("#4238 P a past first date on the payload never pauses on its own", async () => {
  // The old rule read starts_at = master date. Even if a caller hands an old
  // past starts_at through, ok:true from the resolver is final.
  assertEquals(
    await pauseGuard({
      ...AFTER_FIRST_DATE,
      starts_at: "2026-10-01T00:00:00+00:00",
    }),
    null,
  );
});

// ── C: create_version end to end ────────────────────────────────────────────

const PLAN = "42385555-2000-4000-8000-000000000001";
const CONNECTION = "42385555-3000-4000-8000-000000000001";
const CREATIVE = "c0000000-0000-4000-8000-000000000001";
// Postgres hands timestamptz to JSON with microseconds; JS only has ms.
const LAST_PG = "2026-12-06T22:00:00.123456+00:00";
const LAST_JS = "2026-12-06T22:00:00.123Z";

function planDb(destination: Row) {
  const saved: Row[] = [];
  const db = new FakeAdPlanDb(
    adminTables({
      ad_plans: [{
        id: PLAN,
        owner_kind: "mingla",
        client_kind: "admin",
        brand_id: null,
        destination_family: "public_mingla_page",
        destination_key: "event:issue-4238-tester:weekly",
        current_version_id: null,
        state: "draft",
      }],
      ad_creatives: [videoCreative({ id: CREATIVE })],
      ad_connections: [{
        id: CONNECTION,
        platform: "google",
        currency: "NGN",
        connected: true,
        status: "connected",
      }],
    }),
    {
      ad_plan_destination_resolve: () => ({
        data: {
          ...destination,
          destination_family: "public_mingla_page",
          destination_key: "event:issue-4238-tester:weekly",
          ready: destination.ok === true,
          objective: "web_traffic",
          measurement_event: destination.result_kind ?? "clicks",
        },
      }),
      ad_plan_create_version: (args) => {
        saved.push(args);
        return { data: { id: "v-1", plan_hash: "f".repeat(64) } };
      },
    },
    { admin: ADMIN },
  );
  return { db, saved };
}

async function createVersion(
  destination: Row,
  schedule: unknown,
  extra: Row = {},
) {
  Deno.env.set(
    "SUPABASE_URL",
    Deno.env.get("SUPABASE_URL") || "https://edge.test",
  );
  Deno.env.set(
    "SUPABASE_SERVICE_ROLE_KEY",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "service-test",
  );
  const { handleAdPlan } = await import("../../ad-plan/index.ts");
  const { db, saved } = planDb(destination);
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string) =>
    Promise.reject(
      new TypeError(`blocked network: ${String(input)}`),
    )) as typeof fetch;
  try {
    const result = await callAdPlan(
      handleAdPlan as never,
      db,
      "admin",
      {
        action: "create_version",
        plan_id: PLAN,
        provider_allocations: [{
          platform: "google",
          connection_id: CONNECTION,
          host_budget_cents: 500000,
        }],
        canonical_plan: {
          name: "Weekly series",
          creative_library_id: CREATIVE,
          media_rights: {
            rights_confirmed: true,
            rights_basis: "owned",
            ai_generated: false,
          },
          ...(schedule === undefined ? {} : { schedule }),
          ...extra,
        },
      },
    );
    return { ...result, saved };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const DATED = { ...AFTER_FIRST_DATE, last_bookable_at: LAST_PG };

Deno.test("#4238 C Admin create_version on a dated page: an end EQUAL to the last bookable moment is saved", async () => {
  const { status, body, saved } = await createVersion(DATED, {
    ends_at: LAST_JS,
  });
  assertEquals(status, 201, JSON.stringify(body));
  assertEquals(saved.length, 1);
  assertEquals(
    ((saved[0].p_canonical_plan as Row).schedule as Row).ends_at,
    LAST_JS,
  );
});

Deno.test("#4238 C hostile schedules never reach ad_plan_create_version", async () => {
  const cases: Array<[string, unknown, Row, string]> = [
    [
      "1 ms late",
      { ends_at: "2026-12-06T22:00:00.124Z" },
      {},
      "schedule_ends_after_last_date",
    ],
    [
      "later instant written with a +01:00 offset",
      { ends_at: "2026-12-06T23:30:00+01:00" },
      {},
      "schedule_ends_after_last_date",
    ],
    ["no end", {}, {}, "schedule_end_required"],
    ["no schedule at all", undefined, {}, "schedule_end_required"],
    [
      "end in the wrong field",
      { end_at: "2026-12-01T00:00:00Z" },
      { ends_at: "2026-12-01T00:00:00Z" },
      "schedule_end_required",
    ],
    [
      "schedule as an array",
      [{ ends_at: LAST_JS }],
      {},
      "schedule_end_required",
    ],
    [
      "start at the limit",
      { starts_at: LAST_JS, ends_at: LAST_JS },
      {},
      "schedule_starts_after_last_date",
    ],
    [
      "five-digit year",
      { ends_at: "+275760-09-13T00:00:00.000Z" },
      {},
      "schedule_ends_after_last_date",
    ],
    ["numeric end", { ends_at: 1 }, {}, "schedule_end_required"],
  ];
  for (const [label, schedule, extra, detail] of cases) {
    const { status, body, saved } = await createVersion(DATED, schedule, extra);
    assertEquals(status, 422, `${label}: ${JSON.stringify(body)}`);
    assertEquals(body.error, "plan_preflight_failed", label);
    assertEquals(body.detail, detail, label);
    assertEquals(saved.length, 0, `${label}: a version was saved`);
  }
});

Deno.test("#4238 C a page without dates is not bounded (no end allowed)", async () => {
  const { status, saved } = await createVersion(
    {
      ok: true,
      page_type: "brand",
      brand_slug: "issue-4238-tester",
      canonical_url: "https://host.usemingla.com/b/issue-4238-tester",
      availability: "available",
      result_kind: "clicks",
    },
    {},
  );
  assertEquals(status, 201);
  assertEquals(saved.length, 1);
});

// ── A: Ari's propose_ad_plan executor ───────────────────────────────────────

const ARI_BRAND = "11111111-1111-4111-8111-111111111111";
const ARI_CREATIVE = "44444444-4444-4444-8444-444444444444";
const ARI_META = "88888888-8888-4888-8888-888888888888";

function ariClient(setup: Row, bodies: Array<{ name: string; body: Row }>) {
  return {
    rpc: () => Promise.resolve({ data: true, error: null }),
    from(table: string) {
      if (table === "ad_connections") {
        throw new Error("Ari read ad_connections under Host RLS");
      }
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: {
              id: ARI_CREATIVE,
              brand_id: ARI_BRAND,
              kind: "video",
              status: "active",
            },
            error: null,
          }),
      };
      return query;
    },
    functions: {
      invoke(name: string, request: { body: Row }) {
        bodies.push({ name, body: request.body });
        const action = String(request.body.action ?? "");
        if (name === "ad-plan" && action === "host_setup") {
          return Promise.resolve({ data: setup, error: null });
        }
        if (name === "ad-plan" && action === "open") {
          return Promise.resolve({
            data: { plan: { id: "22222222-2222-4222-8222-222222222222" } },
            error: null,
          });
        }
        if (name === "ad-plan" && action === "create_version") {
          return Promise.resolve({
            data: {
              version: {
                id: "33333333-3333-4333-8333-333333333333",
                plan_hash: "a".repeat(64),
              },
            },
            error: null,
          });
        }
        return Promise.resolve({
          data: { ok: true, results: [], targeting_snapshots: [] },
          error: null,
        });
      },
    },
  } as never;
}

const SERIES_PAGE = {
  page_type: "event",
  brand_slug: "femzy",
  entity_slug: "sunday-rooftop",
  result_kind: "tickets",
  ok: true,
  availability: "available",
  next_date: "2026-11-08T17:00:00+00:00",
  dates_remaining: 5,
  last_bookable_at: "2026-12-06T22:00:00+00:00",
  timezone: "Africa/Lagos",
};

const ARI_ARGS = {
  brand_id: ARI_BRAND,
  name: "Sunday Rooftop",
  dest_page_type: "event",
  dest_brand_slug: "femzy",
  dest_entity_slug: "sunday-rooftop",
  platforms: ["meta"],
  budget_cents: 20000,
  daily_budget_cents: 2000,
  countries: ["NG"],
  rights_confirmed: true,
  rights_basis: "owned",
  ai_generated: false,
  creative_library_id: ARI_CREATIVE,
  optimize_for: "visits",
};

const SETUP = (page: Row) => ({
  currency: "NGN",
  connections: [{ id: ARI_META, platform: "meta", sales: { ready: true } }],
  pages: [page],
});

async function propose(args: Row, page: Row) {
  const bodies: Array<{ name: string; body: Row }> = [];
  let message: string | null = null;
  try {
    await findTool("propose_ad_plan")!.executor(
      args,
      ariClient(SETUP(page), bodies),
      ARI_BRAND,
      {} as never,
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  const version = bodies.find((row) => row.body.action === "create_version");
  const schedule = version
    ? ((version.body.canonical_plan as Row).schedule as Row)
    : null;
  return { bodies, message, schedule };
}

Deno.test("#4238 A Ari with no end date sends the last bookable moment", async () => {
  const { message, schedule } = await propose(ARI_ARGS, SERIES_PAGE);
  assertEquals(message, null);
  assertEquals(schedule?.ends_at, "2026-12-06T22:00:00.000Z");
});

Deno.test("#4238 A Ari refuses a later end BEFORE opening any plan, in plain words", async () => {
  const { message, bodies } = await propose(
    { ...ARI_ARGS, ends_at: "2026-12-07T00:00:00Z" },
    SERIES_PAGE,
  );
  assert(message && /last day people can book/.test(message), String(message));
  assert(/Sun 6 Dec|Sat 6 Dec|Sun 7 Dec/.test(message!), String(message));
  assert(!/schedule_|destination_|last_bookable/.test(message!), message!);
  assertEquals(
    bodies.map((row) => String(row.body.action)),
    ["host_setup"],
  );
});

Deno.test("#4238 A Ari refuses a greyed-out page BEFORE opening any plan", async () => {
  for (
    const [availability, words] of [
      // #4238 rework: Ari now gives the picker's own reason word for word.
      ["ended", /All its dates have passed/],
      ["nothing_on_sale", /Nothing is on sale/],
      ["private", /private/],
      ["unlisted", /Unlisted/],
    ] as const
  ) {
    const { message, bodies } = await propose(ARI_ARGS, {
      ...SERIES_PAGE,
      ok: false,
      availability,
      last_bookable_at: null,
    });
    assert(message && words.test(message), `${availability}: ${message}`);
    assertEquals(
      bodies.map((row) => String(row.body.action)),
      ["host_setup"],
      availability,
    );
  }
});

Deno.test("#4238 A a differently-cased slug gets Ari's own cap too (and the server bound stays the backstop)", async () => {
  // #4238 rework (P3): the SQL resolver lower-cases slugs, and so does Ari's
  // lookup now, so "Sunday-Rooftop" is the same page to both. A later end is
  // refused before any plan opens; with no end the default is the last
  // bookable moment. ad-plan's adScheduleBoundError still refuses it (C).
  const late = await propose(
    {
      ...ARI_ARGS,
      dest_entity_slug: "Sunday-Rooftop",
      ends_at: "2027-06-01T00:00:00Z",
    },
    SERIES_PAGE,
  );
  assert(
    late.message && /last day people can book/.test(late.message),
    String(late.message),
  );
  assertEquals(
    late.bodies.map((row) => String(row.body.action)),
    ["host_setup"],
  );
  const open = await propose(
    { ...ARI_ARGS, dest_entity_slug: " Sunday-Rooftop ", dest_brand_slug: "FEMZY" },
    SERIES_PAGE,
  );
  assertEquals(open.message, null);
  assertEquals(open.schedule?.ends_at, "2026-12-06T22:00:00.000Z");
  const server = await createVersion(DATED, {
    ends_at: "2027-06-01T00:00:00Z",
  });
  assertEquals(server.status, 422);
  assertEquals(server.body.detail, "schedule_ends_after_last_date");
  assertEquals(server.saved.length, 0);
});

// ── F: nothing after create_version can move the schedule ───────────────────

Deno.test("#4238 F freeze_targeting never reads a schedule; the launch refuses a schedule that differs from the frozen plan", async () => {
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  const freeze = plan.slice(
    plan.indexOf('if (action === "freeze_targeting")'),
    plan.indexOf("const requiredAction: HostAdAction"),
  );
  assert(freeze.length > 1000, "freeze_targeting block not found");
  assert(!/schedule/.test(freeze), "freeze_targeting touches the schedule");
  const launch = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const mismatch = launch.slice(
    launch.indexOf("function immutableRequestMismatch("),
    launch.indexOf("const frozenCopy"),
  );
  assert(
    /frozenSchedule\.ends_at \?\? null\) !== schedule\.ends_at/.test(mismatch),
  );
  assert(/plan_schedule_mismatch/.test(mismatch));
  // A real (non validate_only) create needs a plan version + hash.
  assert(
    /if \(body\.validate_only !== true\) \{\s+const planVersionId/.test(launch),
  );
});

Deno.test("#4238 C the cap is checked on the resolver's answer, not the client's", async () => {
  // A client cannot pass its own last_bookable_at: create_version reads it
  // from ad_plan_destination_resolve only.
  const { status, saved } = await createVersion(
    DATED,
    { ends_at: "2027-01-01T00:00:00Z" },
    {
      last_bookable_at: "2099-01-01T00:00:00Z",
      destination: { last_bookable_at: "2099-01-01T00:00:00Z" },
    },
  );
  assertEquals(status, 422);
  assertEquals(saved.length, 0);
});

// ── K: Ari's propose card in plain words ────────────────────────────────────

Deno.test("#4238 K Ari's card: the dates row and the schedule name the same day in plain words", async () => {
  const { preflightMoneyProposal } = await import("../agentDomainTools.ts");
  // Last bookable moment 23:30 UTC Sun 6 Dec = 00:30 Mon 7 Dec in Lagos.
  const page = {
    ...SERIES_PAGE,
    last_bookable_at: "2026-12-06T23:30:00+00:00",
    dates_remaining: 3,
  };
  const context = await preflightMoneyProposal(
    "propose_ad_plan",
    { ...ARI_ARGS },
    ariClient(SETUP(page), []),
  ) as Row;
  assertEquals(context.ad_dates, "Covers all 3 dates until Mon 7 Dec");
  const schedule = String(context.ad_schedule);
  // RED on 8a5c84770: "starts after approval → 2026-12-06T23:30:00.000Z" — a raw
  // UTC timestamp on a money card, and a different day from the Dates row.
  assert(
    !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(schedule),
    `raw timestamp on the card: ${schedule}`,
  );
  assert(
    schedule.includes("Mon 7 Dec"),
    `schedule names another day: ${schedule}`,
  );
});
