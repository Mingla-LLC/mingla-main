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

  // [TEST-MOD-APPROVED ORCH-1062] B2 drift (tests below) — ORCH-1150 [RSVP event
  // wizard] stores RSVP drafts as event_type='rsvp' and every event-only draft
  // READ/UPDATE now admits BOTH via `.in("event_type", DRAFT_EVENT_TYPES)`
  // (= ["event","rsvp"], eventDrafts.ts:64) instead of `.eq("event_type","event")`,
  // or RSVP drafts vanish from the Hub. The trip-exclusion invariant is preserved
  // (trips still never match). The extraction anchors also gained `= async` because
  // ORCH-1150's header comment (eventDrafts.ts:56-63) mentions several of these
  // function names before their definitions. Same-strength drift updates, not a
  // loosening. Fails-on-revert: reverting a `.in(...)` back to `.eq("event_type",
  // "event")` (dropping RSVP) flips the matching assertion red.
  test("eventDrafts.fetchDraftsForBrand filters event_type IN (event,rsvp)", () => {
    const fn = EVENT_DRAFTS.match(/fetchDraftsForBrand = async[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/\.in\("event_type",\s*DRAFT_EVENT_TYPES\)/);
  });

  test("eventDrafts.fetchDraftById filters event_type IN (event,rsvp)", () => {
    const fn = EVENT_DRAFTS.match(/fetchDraftById = async[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/\.in\("event_type",\s*DRAFT_EVENT_TYPES\)/);
  });

  test("eventDrafts.resolveMissingDraftLifecycle filters event_type IN (event,rsvp)", () => {
    const fn = EVENT_DRAFTS.match(/resolveMissingDraftLifecycle = async[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/\.in\("event_type",\s*DRAFT_EVENT_TYPES\)/);
  });

  test("eventDrafts.fetchExistingDraftSaveContext filters event_type IN (event,rsvp)", () => {
    const fn = EVENT_DRAFTS.match(/fetchExistingDraftSaveContext = async[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/\.in\("event_type",\s*DRAFT_EVENT_TYPES\)/);
  });

  test("eventDrafts.autosaveServerDraft routes RSVP via graph and events via draft RPC", () => {
    // [TEST-MOD-APPROVED #1977] RSVP autosave no longer UPDATE-filters events;
    // it calls business_update_rsvp_graph. Event drafts still use
    // business_update_event_draft. Trip exclusion remains via the draft RPCs.
    const fn = EVENT_DRAFTS.match(/autosaveServerDraft = async[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/business_update_rsvp_graph/);
    expect(fn?.[0]).toMatch(/business_update_event_draft/);
  });

  test("eventDrafts.createServerDraft routes RSVP drafts through business_create_rsvp_draft_graph", () => {
    // #1977 — RSVP draft promotion uses the canonical graph RPC; event drafts
    // still use business_create_event_draft with eventTypeForInsert.
    expect(EVENT_DRAFTS).toMatch(/business_create_rsvp_draft_graph/);
    expect(EVENT_DRAFTS).toMatch(/eventTypeForInsert:\s*"event"\s*\|\s*"rsvp"/);
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

  test("publicEventsService.fetchPublicBrandEvents filters the brand events list to event rows (excludes trips)", () => {
    // [TEST-MOD-APPROVED ORCH-1062] B2 drift — META-ORCH-0972 Sub-C: the brand
    // page now loads events + trips via SEPARATE typed fetches. Trip exclusion
    // moved out of getPublicBrandBySlug's `tripIds` post-filter and into
    // fetchPublicBrandEvents, which filters `row.event_type === "event"` right
    // after reading business_public_events_view (publicEventsService.ts:1433).
    // Same invariant (trip rows never leak into the brand events list), current
    // mechanism. Fails-on-revert: dropping the `row.event_type === "event"` filter
    // in fetchPublicBrandEvents flips this red.
    const fn = PUBLIC_EVENTS.match(/fetchPublicBrandEvents = async[^]*?^\};/m);
    expect(fn).not.toBeNull();
    expect(fn?.[0]).toMatch(/row\.event_type === ["']event["']/);
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
    // [TEST-MOD-APPROVED ORCH-1062] B1 stale-anchor repair — a comment at
    // tripsService.ts:644 ("same policy that governs `updateTripBasics`") made the
    // bare-name anchor match that mention instead of the real function, capturing
    // an earlier body with only 1 filter. Anchor on the declaration. The two
    // event_type='trip' filters (theme SELECT + UPDATE, lines 1023 + 1062) are
    // intact; assertion unchanged. Fails-on-revert: removing either filter drops
    // the count below 2.
    const fn = TRIPS.match(/export async function updateTripBasics[^]*?^\}/m);
    expect(fn).not.toBeNull();
    // [TEST-MOD-APPROVED #1971] Was: TWO `.eq("event_type","trip")` filters —
    // the theme SELECT and the events UPDATE. #1971 removed the client-side
    // UPDATE entirely: the write is now one canonical
    // `biz_apply_trip_draft_graph` call whose SQL raises `event_not_a_trip` on
    // a non-trip row, which is a STRONGER guarantee than a client filter (a
    // client filter can be bypassed by any other caller; the command cannot).
    // The remaining status probe keeps its filter, and the invariant this test
    // exists for — "this function can never touch a non-trip row" — is asserted
    // on BOTH halves below.
    const matches = fn?.[0].match(/\.eq\("event_type",\s*"trip"\)/g);
    expect((matches ?? []).length).toBeGreaterThanOrEqual(1);
    expect(fn?.[0]).toMatch(/applyTripDraftGraph\(/);
    expect(TRIPS).toMatch(
      /supabase\.rpc\(["']biz_apply_trip_draft_graph["']/,
    );
  });

  test("tripsService has at least 4 .eq event_type='trip' filters (getTrip + updateBasics select + updateBasics update + updatePricing probe)", () => {
    const matches = TRIPS.match(/\.eq\("event_type",\s*"trip"\)/g);
    expect(matches).not.toBeNull();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(4);
  });

  // [TEST-MOD-APPROVED #1971] The trip-only guarantee for every write this
  // issue moved server-side. A client `.eq("event_type","trip")` filter only
  // protects the caller that remembers to write it; the canonical commands
  // reject a non-trip row for EVERY caller, Ari included.
  test("issue #1971 canonical trip commands refuse a non-trip row server-side", () => {
    const migration = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20270509001971_issue_1971_ari_trip_lifecycle.sql",
      ),
      "utf8",
    );
    for (
      const command of [
        "biz_apply_trip_draft_graph",
        "biz_update_trip_live_command",
        "biz_publish_trip_command",
        "biz_soft_delete_trip",
      ]
    ) {
      const start = migration.indexOf(
        `CREATE OR REPLACE FUNCTION public.${command}(`,
      );
      expect(start).toBeGreaterThan(-1);
      const body = migration.slice(start, migration.indexOf("$fn$;", start));
      expect(body).toMatch(/event_type <> 'trip'/);
      expect(body).toMatch(/RAISE EXCEPTION 'event_not_a_trip'/);
    }
  });

  test("tripsService.updateTripPricing derives the trip currency server-side", () => {
    // [TEST-MOD-APPROVED #1971] Was: the function must contain a client-side
    // `.eq("event_type","trip")` currency probe. That probe existed only to
    // read `events.currency` before writing `ticket_types`; #1971 moved the
    // whole tier write into `biz_apply_trip_draft_graph`, which reads the
    // event's currency itself under a row lock. The probe is not weakened, it
    // is gone — so the assertion now pins what replaced it, plus the issue
    // #1014 rule the probe was really protecting (never fabricate USD).
    const idx = TRIPS.indexOf("export async function updateTripPricing");
    expect(idx).toBeGreaterThan(-1);
    const nextExport = TRIPS.indexOf("export ", idx + 1);
    const fnSource = TRIPS.slice(
      idx,
      nextExport === -1 ? TRIPS.length : nextExport,
    );
    expect(fnSource).toMatch(/applyTripDraftGraph\(/);
    // No client-side ticket_types / trip_pricing_tiers write survives.
    expect(fnSource).not.toMatch(/\.from\("ticket_types"\)[^]*?\.update\(/);
    expect(fnSource).not.toMatch(/\.from\("trip_pricing_tiers"\)[^]*?\.update\(/);
    expect(fnSource).not.toMatch(/"USD"/);
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
    // [TEST-MOD-APPROVED ORCH-1062] B1 stale-anchor repair — ORCH-0946 added a doc
    // comment mentioning `getPublicTripById` (publicEventsService.ts:1123) BEFORE
    // the function, so the bare-name anchor matched the comment and captured the
    // wrong block (fetchTicketTypesRemaining). Anchor on the `export const`
    // declaration. The real function (line 1666) still pins `.eq("event_type",
    // "trip")` at line 1675; assertion unchanged. Fails-on-revert: removing that
    // filter flips this red.
    const fn = PUBLIC_EVENTS.match(/export const getPublicTripById = async[^]*?^\};/m);
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
    // [TEST-MOD-APPROVED #1719] Live edits now enter the atomic poster wrapper;
    // the wrapper delegates to the existing refund-gated trip function.
    // [TEST-MOD-APPROVED #1971] ONE assertion is invalidated: the service now
    // calls `biz_update_trip_live_command`, which forwards this exact patch to
    // `issue_1719_update_live_trip_with_poster` unchanged and adds CAS + an
    // exactly-once receipt. The delegation is asserted at the migration, so the
    // chain is still proven end to end rather than merely renamed.
    expect(fnSource).toMatch(/supabase\.rpc\(["']biz_update_trip_live_command["']/);
    const migration = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20270509001971_issue_1971_ari_trip_lifecycle.sql",
      ),
      "utf8",
    );
    expect(migration).toMatch(
      /public\.issue_1719_update_live_trip_with_poster\(p_event_id, v_forward, p_reason\)/,
    );
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

// [TEST-MOD-APPROVED ORCH-1062] JUNK PIN DELETED — the "CI workflow registers
// i-proposed-tr2-events-type-filter job" block pinned a per-gate `node
// .github/scripts/strict-grep/i-proposed-tr2-events-type-filter.mjs` command in
// strict-grep-mingla-business.yml. CI moved to a MANIFEST-batch model: gates are
// listed in .github/scripts/strict-grep/MANIFEST.json (the tr2 gate IS registered,
// MANIFEST.json:1881) and executed via `run-batch.mjs --class A` — the per-gate
// `node` lines were deleted from the workflow ("The gate list is NOT in this file
// any more", workflow line 52). This is a CI-restructure, NOT a regression: the
// gate's REGISTRATION is enforced by the #1047 MANIFEST parity gates (P1-P12,
// DO-NOT-TOUCH, SC-6) and its BEHAVIOR is proven LIVE by
// tr2_rework3.tester_adversarial.test.ts (runs the gate against a bad fixture,
// asserts exit 1). Proven junk → deleted per SPEC §B1 (covered by a strict-grep
// gate + a live behavioral test).

describe("META-ORCH-1059 Sub-B — experience routing via routeForEventRow", () => {
  const ROUTE_HELPER = read("utils/routeForEventRow.ts");

  test("routeForEventRow routes ALL experiences (incl. drafts) to /experience/{id} dashboard", () => {
    // META-ORCH-1059: the experience branch ALWAYS returns the dashboard
    // (`/experience/{id}`) — draft or live. Unlike event/trip, a draft does NOT
    // jump straight to `/edit`; the dashboard's "Continue editing" action owns
    // that. Reintroducing a draft → `/experience/{id}/edit` branch (or the old
    // `/experience/coming-soon` stub) flips these assertions.
    expect(ROUTE_HELPER).toMatch(/event_type === ["']experience["']/);
    expect(ROUTE_HELPER).toMatch(/`\/experience\/\$\{row\.id\}`/);
  });

  test("the experience branch never routes to /edit or the coming-soon stub", () => {
    const expBranch = ROUTE_HELPER.match(
      /if \(row\.event_type === "experience"\)[\s\S]*?\n  \}/,
    );
    expect(expBranch).not.toBeNull();
    // No draft→edit jump: the dashboard is the single tap-through target.
    expect(expBranch?.[0]).not.toMatch(/`\/experience\/\$\{row\.id\}\/edit`/);
    // The dead coming-soon stub must be gone from the experience branch.
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

describe("META-ORCH-1059 Sub-C/D — buyer journey (public page + checkout entry)", () => {
  // CHECKOUT_FLOW read removed with the ORCH-1117 junk-pin deletion above.
  const PUBLIC_SERVICE = read("services/publicExperienceService.ts");

  test("the public experience route exists at app/exp/[brandSlug]/[experienceSlug]", () => {
    expect(() =>
      appRead("exp/[brandSlug]/[experienceSlug].tsx"),
    ).not.toThrow();
  });

  test("the experience checkout chain exists (index/buyer/payment/confirm/_layout)", () => {
    expect(() =>
      appRead("checkout-experience/[experienceEventId]/_layout.tsx"),
    ).not.toThrow();
    expect(() =>
      appRead("checkout-experience/[experienceEventId]/index.tsx"),
    ).not.toThrow();
    expect(() =>
      appRead("checkout-experience/[experienceEventId]/buyer.tsx"),
    ).not.toThrow();
    expect(() =>
      appRead("checkout-experience/[experienceEventId]/payment.tsx"),
    ).not.toThrow();
    expect(() =>
      appRead("checkout-experience/[experienceEventId]/confirm.tsx"),
    ).not.toThrow();
  });

  // [TEST-MOD-APPROVED ORCH-1062] JUNK PIN DELETED — ORCH-1117 REMOVED the inline
  // Get-spot CTA + its `router.push` from ExperienceCheckoutFlow; the component is
  // now a recap-only card (verified: zero `router.push` in the file). Navigation
  // into /checkout-experience moved to the public page's floating Buy bar via the
  // `experienceCheckoutPath` helper (constants/publicUrls.ts:132). This pin tested
  // routing behavior that no longer lives in this file, and the routing invariant
  // is ALREADY covered by two LIVE tests: app/exp/__tests__/public-experience-
  // page.test.ts (A-EXP-4: route-based via experienceCheckoutPath) and
  // components/offering/__tests__/offeringCtaDeadTap.orch1117.adversarial.test.ts
  // (expects experienceCheckoutPath(experience.id)). Proven junk → deleted per
  // SPEC §B1 (behavior covered by a live test).

  test("COMMS-0014/0016 — checkout POSTs to the SHARED ticket-checkout-create, no parallel money fn", () => {
    const BUYER = appRead("checkout-experience/[experienceEventId]/buyer.tsx");
    const PAYMENT = appRead(
      "checkout-experience/[experienceEventId]/payment.tsx",
    );
    // Both reuse the shared createTicketCheckout service (event_type-agnostic).
    expect(BUYER).toMatch(/createTicketCheckout/);
    expect(PAYMENT).toMatch(/createTicketCheckout/);
    // No bespoke edge-function name introduced for experiences.
    expect(BUYER).not.toMatch(/experience-checkout-create/);
    expect(PAYMENT).not.toMatch(/experience-checkout-create/);
    // Native path goes through the shared NativeCheckoutPaymentBoundary.
    expect(PAYMENT).toMatch(/NativeCheckoutPaymentBoundary/);
  });

  test("the public-by-slug resolver gates on published experiences only (draft never leaks)", () => {
    // Anon resolver: event_type='experience' + published lifecycle statuses.
    expect(PUBLIC_SERVICE).toMatch(/event_type["']?,\s*["']experience["']/);
    expect(PUBLIC_SERVICE).toMatch(/PUBLIC_STATUSES/);
    // "draft" must NOT be in the anon-visible status set.
    const statusDecl = PUBLIC_SERVICE.match(
      /PUBLIC_STATUSES\s*=\s*\[([^\]]*)\]/,
    );
    expect(statusDecl).not.toBeNull();
    expect(statusDecl?.[1]).not.toMatch(/draft/);
  });
});

// Silence unused-import warning for appRead — kept for symmetry with other
// audit tests that may need app/ reads in a future expansion.
void appRead;
