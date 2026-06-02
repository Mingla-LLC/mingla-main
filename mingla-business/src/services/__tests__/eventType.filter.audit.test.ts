/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 3 — events-type-filter audit.
 *
 * Consolidated source-grep regression test. Pins that every event-only
 * client-code query against the `events` table filters by
 * event_type='event' (or 'trip' for trip-only paths) so trip rows don't
 * leak into event-only UI surfaces and vice versa. Companion to the
 * strict-grep CI gate at
 * .github/scripts/strict-grep/i-proposed-tr2-events-type-filter.mjs
 * (which catches NEW additions; this jest pins the existing fixes so
 * silent reverts at the source-line layer fail at PR time).
 *
 * Fails-on-revert: removing any cited `.eq("event_type", ...)` line
 * causes the matching assertion below to fail.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const SRC = join(__dirname, "..", "..", "..", "src");
const APP = join(__dirname, "..", "..", "..", "app");

function read(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

function appRead(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

describe("ORCH-0859 REWORK 3 — events_type filter audit (event-only callers)", () => {
  const EVENT_DRAFTS = read("services/eventDrafts.ts");
  const USE_BRANDS = read("hooks/useBrands.ts");
  const EVENT_COVER = read("services/eventCoverMediaService.ts");
  const BUSINESS_EVENTS = read("services/businessEvents.ts");
  const PUBLIC_EVENTS = read("services/publicEventsService.ts");

  test("eventDrafts.fetchDraftsForBrand filters event_type='event'", () => {
    const fn = EVENT_DRAFTS.match(/fetchDraftsForBrand[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/\.eq\("event_type",\s*"event"\)/);
  });

  test("eventDrafts.fetchDraftById filters event_type='event'", () => {
    const fn = EVENT_DRAFTS.match(/fetchDraftById[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/\.eq\("event_type",\s*"event"\)/);
  });

  test("eventDrafts.resolveMissingDraftLifecycle filters event_type='event'", () => {
    const fn = EVENT_DRAFTS.match(/resolveMissingDraftLifecycle[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/\.eq\("event_type",\s*"event"\)/);
  });

  test("eventDrafts.fetchExistingDraftSaveContext filters event_type='event'", () => {
    const fn = EVENT_DRAFTS.match(/fetchExistingDraftSaveContext[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/\.eq\("event_type",\s*"event"\)/);
  });

  test("eventDrafts.autosaveServerDraft (UPDATE) filters event_type='event'", () => {
    const fn = EVENT_DRAFTS.match(/autosaveServerDraft[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/\.eq\("event_type",\s*"event"\)/);
  });

  test("eventDrafts.createServerDraft INSERT payload sets event_type='event'", () => {
    expect(EVENT_DRAFTS).toMatch(/insert\(\{[^}]*event_type:\s*["']event["']/);
  });

  test("useBrands brand-stats counters (past/scheduled/live) all filter event_type='event'", () => {
    const eventTypeMatches = USE_BRANDS.match(
      /\.eq\("event_type",\s*"event"\)/g,
    );
    expect(eventTypeMatches).not.toBeNull();
    // 3 brand-stat counts (past/scheduled/live) all need the filter.
    expect(eventTypeMatches?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  test("eventCoverMediaService UPDATE filters event_type='event'", () => {
    expect(EVENT_COVER).toMatch(/\.eq\("event_type",\s*"event"\)/);
  });

  test("businessEvents.fetchBusinessEventById rejects trip rows via probe", () => {
    const fn = BUSINESS_EVENTS.match(/fetchBusinessEventById[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/event_type/);
    expect(fn?.[0]).toMatch(/event_type === ["']trip["']/);
    expect(fn?.[0]).toMatch(/return null/);
  });

  test("publicEventsService.getPublicEventBySlug rejects trip rows via probe", () => {
    const fn = PUBLIC_EVENTS.match(/getPublicEventBySlug[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/event_type === ["']trip["']/);
    expect(fn?.[0]).toMatch(/return null/);
  });

  test("publicEventsService.getPublicEventById rejects trip rows via probe", () => {
    const fn = PUBLIC_EVENTS.match(/getPublicEventById[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/event_type === ["']trip["']/);
    expect(fn?.[0]).toMatch(/return null/);
  });

  test("publicEventsService.getPublicBrandBySlug filters trip rows from brand events list", () => {
    const fn = PUBLIC_EVENTS.match(/getPublicBrandBySlug[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/tripIds/);
    expect(fn?.[0]).toMatch(/event_type === ["']trip["']/);
  });
});

describe("ORCH-0859 REWORK 3 — events_type filter audit (trip-only defensive)", () => {
  const TRIPS = read("services/tripsService.ts");
  // ORCH-0876 — needed by the getPublicTripById clause below. Same source
  // as the first describe block's PUBLIC_EVENTS; declared per-block scope.
  const PUBLIC_EVENTS = read("services/publicEventsService.ts");

  test("tripsService.getTrip pins event_type='trip'", () => {
    const fn = TRIPS.match(/export async function getTrip[^]*?^\}/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/\.eq\("event_type",\s*"trip"\)/);
  });

  test("tripsService.updateTripBasics theme SELECT pins event_type='trip'", () => {
    // The theme-select snippet is inside updateTripBasics; pin via local block.
    const fn = TRIPS.match(/updateTripBasics[^]*?^\}/m);
    expect(fn).not.toBeNull();
    // updateTripBasics has TWO event_type='trip' filters (theme SELECT + UPDATE).
    const matches = fn?.[0].match(/\.eq\("event_type",\s*"trip"\)/g);
    expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("tripsService has at least 4 .eq event_type='trip' filters (getTrip + updateBasics select + updateBasics update + updatePricing probe)", () => {
    const matches = TRIPS.match(/\.eq\("event_type",\s*"trip"\)/g);
    expect(matches).not.toBeNull();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(4);
  });

  test("tripsService.updateTripPricing source contains the trip-currency probe filter", () => {
    // Locate the function by its signature and scan to the next `export `.
    const idx = TRIPS.indexOf("export async function updateTripPricing");
    expect(idx).toBeGreaterThan(-1);
    const nextExport = TRIPS.indexOf("export ", idx + 1);
    const fnSource = TRIPS.slice(
      idx,
      nextExport === -1 ? TRIPS.length : nextExport,
    );
    expect(fnSource).toMatch(/\.eq\("event_type",\s*"trip"\)/);
  });

  // ============================================================
  // ORCH-0876 extension — 3 new clauses
  // ============================================================
  // (a) getPublicTripById (trip-only public-by-id resolver) MUST pin
  //     `.eq("event_type", "trip")`. Inverse of getPublicEventById's
  //     trip-rejection probe.
  // (b) updateLiveTripFields service MUST route through the
  //     `biz_update_live_trip` RPC (the RPC itself enforces event_type='trip'
  //     server-side via RAISE EXCEPTION 'event_not_a_trip').
  // (c) The migration body MUST contain `event_type <> 'trip'` enforcement
  //     and the matching `RAISE EXCEPTION 'event_not_a_trip'` line.
  //
  // Defense-in-depth: any future refactor that bypasses the RPC OR removes
  // the SQL enforcement will fail this test.

  test("publicEventsService.getPublicTripById pins event_type='trip'", () => {
    const fn = PUBLIC_EVENTS.match(/getPublicTripById[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/\.eq\("event_type",\s*"trip"\)/);
  });

  test("tripsService.updateLiveTripFields routes through biz_update_live_trip RPC", () => {
    const idx = TRIPS.indexOf("export async function updateLiveTripFields");
    expect(idx).toBeGreaterThan(-1);
    const nextExport = TRIPS.indexOf("export ", idx + 1);
    const fnSource = TRIPS.slice(
      idx,
      nextExport === -1 ? TRIPS.length : nextExport,
    );
    expect(fnSource).toMatch(/supabase\.rpc\(["']biz_update_live_trip["']/);
  });

  test("ORCH-0876 migration body enforces event_type='trip' + raises event_not_a_trip", () => {
    const migration = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20260616000000_orch_0876_trip_published_edit.sql",
      ),
      "utf8",
    );
    // Body must check the event_type at runtime
    expect(migration).toMatch(/v_event\.event_type\s*<>\s*'trip'/);
    // And raise the specific exception when violated
    expect(migration).toMatch(/RAISE EXCEPTION\s+'event_not_a_trip'/);
  });
});

describe("ORCH-0859 REWORK 3 — item A (trip publish RPC dual session flag)", () => {
  const MIGRATION = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "supabase",
      "migrations",
      "20260609000000_orch_0859_trip_publish_slug_flag.sql",
    ),
    "utf8",
  );

  test("trip publish RPC sets BOTH session flags so slug-immutability trigger permits the change", () => {
    expect(MIGRATION).toMatch(
      /set_config\('mingla\.business_publish_trip_draft',\s*'on',\s*true\)/,
    );
    expect(MIGRATION).toMatch(
      /set_config\('mingla\.business_publish_event_draft',\s*'on',\s*true\)/,
    );
  });

  test("migration self-verify probe asserts both flags are present in installed function", () => {
    expect(MIGRATION).toMatch(/event_flag_count < 1/);
    expect(MIGRATION).toMatch(
      /slug trigger will reject publish/,
    );
  });
});

describe("ORCH-0859 REWORK 3 — item C (wizard auto-seeds day cards from date range)", () => {
  const WIZARD = readFileSync(
    join(SRC, "components", "trip", "TripCreatorWizard.tsx"),
    "utf8",
  );

  test("wizard has a useEffect watching step1Draft.startAt + endAt that updates daysDraft length", () => {
    expect(WIZARD).toMatch(
      /useEffect[^]*?step1Draft\.startAt[^]*?step1Draft\.endAt/,
    );
    // Auto-seed must derive count and call setDaysDraft.
    expect(WIZARD).toMatch(/setDaysDraft/);
    expect(WIZARD).toMatch(/Math\.floor\(\(endMs - startMs\) \/ MS_PER_DAY\)/);
    expect(WIZARD).toMatch(/\+ 1/);
  });

  test("auto-seed preserves existing operator-filled entries (no clobber)", () => {
    // The grow branch spreads `current` first, then appends new cards —
    // existing entries' titles/narratives are preserved.
    expect(WIZARD).toMatch(/const next = \[\.\.\.current\]/);
    expect(WIZARD).toMatch(/`Day \$\{i \+ 1\}`/);
  });

  test("auto-seed shrinks to match when end-date moves earlier", () => {
    expect(WIZARD).toMatch(/current\.slice\(0,\s*dayCount\)/);
  });
});

describe("ORCH-0859 REWORK 3 — strict-grep gate registered", () => {
  test("CI workflow registers i-proposed-tr2-events-type-filter job", () => {
    const workflow = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        ".github",
        "workflows",
        "strict-grep-mingla-business.yml",
      ),
      "utf8",
    );
    expect(workflow).toMatch(/i-proposed-tr2-events-type-filter/);
    expect(workflow).toMatch(
      /node \.github\/scripts\/strict-grep\/i-proposed-tr2-events-type-filter\.mjs/,
    );
  });
});

describe("META-ORCH-1059 Sub-B — experience routing via routeForEventRow", () => {
  const ROUTE_HELPER = read("utils/routeForEventRow.ts");

  test("routeForEventRow routes experience drafts to /experience/{id}/edit", () => {
    // The experience branch must mirror the event/trip branch: draft → /edit,
    // everything else → the dashboard. Reverting to the old
    // `/experience/coming-soon` stub flips this assertion.
    expect(ROUTE_HELPER).toMatch(/event_type === ["']experience["']/);
    expect(ROUTE_HELPER).toMatch(
      /`\/experience\/\$\{row\.id\}\/edit`/,
    );
  });

  test("routeForEventRow routes published experiences to /experience/{id}", () => {
    expect(ROUTE_HELPER).toMatch(/`\/experience\/\$\{row\.id\}`/);
    // The dead coming-soon stub must be gone from the experience branch.
    const expBranch = ROUTE_HELPER.match(
      /if \(row\.event_type === "experience"\)[\s\S]*?\n  \}/,
    );
    expect(expBranch).not.toBeNull();
    expect(expBranch?.[0]).not.toMatch(/coming-soon/);
  });

  test("experience dashboard + edit routes exist under app/experience/[id]", () => {
    // The dashboard + edit screens are the tap-through targets above.
    expect(() => appRead("experience/[id]/index.tsx")).not.toThrow();
    expect(() => appRead("experience/[id]/edit.tsx")).not.toThrow();
  });

  test("biz_publish_experience migration writes exactly one ticket + UPDATEs (no new events INSERT)", () => {
    const migration = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20260825000000_meta_orch_1059_sub_b_publish_experience.sql",
      ),
      "utf8",
    );
    // UPDATE the existing row (draft-first), not a new INSERT INTO events.
    expect(migration).toMatch(/UPDATE\s+public\.events\s+SET/);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+public\.events/);
    // Exactly one ticket_types INSERT (I-1 one-ticket).
    const ticketInserts = migration.match(/INSERT\s+INTO\s+public\.ticket_types/gi) ?? [];
    expect(ticketInserts.length).toBe(1);
  });
});

// Silence unused-import warning for appRead — kept for symmetry with other
// audit tests that may need app/ reads in a future expansion.
void appRead;
