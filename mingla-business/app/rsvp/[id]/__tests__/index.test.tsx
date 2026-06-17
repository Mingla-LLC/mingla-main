/* eslint-disable import/first */
/**
 * ORCH-1150-R2 D-4 — implementor happy-path regression test.
 *
 * Asserts the RSVP host dashboard (`app/rsvp/[id]/index.tsx`) EXISTS and is a
 * correct subtractive clone of the ticketed event detail:
 *   - KEEP: hero/cover, status pill, date·venue facts, "N going" headcount,
 *     a Guests link → /rsvp/[id]/guests, Edit → /rsvp/[id]/edit, Share +
 *     public-page link /e/{brandSlug}/{eventSlug}.
 *   - DROP: revenue card, ticket types, scan/scanners/orders/door/
 *     reconciliation/blasts/group-chat tiles, activity feed, end-sales/cancel,
 *     EventManageMenu — anything reading event.tickets or revenue.
 *   - DATA HOOK (F-2): the going-count is sourced from
 *     useBusinessEventsForBrand (the Hub LIST query), NOT from
 *     fetchBusinessEventById (which zeroes rsvpGoingCount).
 *
 * Structural source test — the screen's dependency graph (Expo Router +
 * useManagedEventRoute + Zustand stores) is too heavyweight to render in a
 * Node-environment jest cleanly; mirrors the sibling event-detail tests
 * (app/event/[id]/__tests__/cancel-no-navigation.test.tsx).
 *
 * Fails-on-revert: the route is file-based. DELETING index.tsx makes
 * expo-router fall through to +not-found.tsx (the white-screen bug). The
 * `readFileSync` here THROWS when the file is absent → every test in this
 * suite errors → the suite fails on revert. Verified by true line deletion of
 * the file (see IMPLEMENT report).
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const SCREEN_SOURCE_PATH = join(__dirname, "..", "index.tsx");

describe("ORCH-1150-R2 D-4 — RSVP host dashboard exists + is RSVP-tailored", () => {
  // Throws (suite fails) if the file was deleted → the fails-on-revert proof
  // for the missing-route white-screen bug.
  const source = readFileSync(SCREEN_SOURCE_PATH, "utf8");

  test("the RSVP detail screen file exists and exports a default screen", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(source).toMatch(/export default function RsvpDetailScreen/);
  });

  test("KEEP: renders the hero (cover + status pill + title + date·venue)", () => {
    expect(source).toContain("EventCoverMedia");
    expect(source).toContain("EventDetailHeroStatusPill");
    expect(source).toContain("formatDraftDateLine");
    expect(source).toContain("event.venueName");
  });

  test("KEEP: renders the 'N going' headcount via formatRsvpGoingLabel", () => {
    expect(source).toContain("formatRsvpGoingLabel");
    expect(source).toContain("goingCount");
    // empty-state copy for zero responses
    expect(source).toMatch(/No one's responded yet|0 going/);
  });

  test("KEEP: Guests link routes to /rsvp/[id]/guests", () => {
    expect(source).toMatch(/\/rsvp\/\$\{id\}\/guests/);
    expect(source).toContain('label="Guests"');
  });

  test("KEEP: Edit link routes to /rsvp/[id]/edit", () => {
    expect(source).toMatch(/\/rsvp\/\$\{id\}\/edit/);
    expect(source).toContain('label="Edit"');
  });

  test("KEEP: Share + public-page link /e/{brandSlug}/{eventSlug}", () => {
    expect(source).toContain("ShareModal");
    expect(source).toContain("eventPublicUrl");
    expect(source).toMatch(/\/e\/\$\{resolvedLiveEvent\.brandSlug\}\/\$\{resolvedLiveEvent\.eventSlug\}/);
  });

  test("DATA HOOK (F-2): going-count is read from useBusinessEventsForBrand, not the detail fetch", () => {
    expect(source).toContain("useBusinessEventsForBrand");
    // found-by-id against the Hub list cache (id OR serverEventId)
    expect(source).toMatch(/e\.id === id \|\| e\.serverEventId === id/);
  });

  test("DROP: NO revenue / KPI card", () => {
    expect(source).not.toContain("EventDetailKpiCard");
    expect(source).not.toContain("summarizeEventMoney");
    expect(source).not.toContain("moneySummary");
    expect(source).not.toMatch(/revenueGbp|payoutGbp/);
  });

  test("DROP: NO ticket types list / row", () => {
    expect(source).not.toContain("EventDetailTicketTypeRow");
    expect(source).not.toContain("TICKET TYPES");
    expect(source).not.toContain("soldCountByTier");
    expect(source).not.toContain("event.tickets");
  });

  test("DROP: NO scan / scanners / orders / door / reconciliation tiles", () => {
    expect(source).not.toContain("Scan tickets");
    expect(source).not.toContain("Scanners");
    expect(source).not.toContain('label="Orders"');
    expect(source).not.toContain("Door Sales");
    expect(source).not.toContain("ReconciliationCtaTile");
    expect(source).not.toContain("useEventOrders");
  });

  // ORCH-1150-R2 (D-8) — Blasts + Group-chat are COMMS, not money. D-4
  // originally dropped them; D-8 (later in the same retest batch) RE-ADDED
  // them. This DROP assertion is narrowed to the genuinely money/ticket-
  // coupled surfaces only. The Blasts/Group-chat presence is asserted
  // positively in the D-8 block below.
  test("DROP: NO activity feed, NO manage menu, NO cancel/end-sales (money/ticket surfaces)", () => {
    expect(source).not.toContain("EventDetailActivityRow");
    expect(source).not.toContain("recentActivity");
    expect(source).not.toContain("EventManageMenu");
    expect(source).not.toContain("EndSalesSheet");
    expect(source).not.toMatch(/Cancel event|handleCancelConfirm/);
  });

  test("REGRESSION: protective comment present", () => {
    expect(source).toContain("DO NOT delete");
  });
});

// ===========================================================================
// ORCH-1150-R2 (D-8) — Blasts + Group-chat tiles re-added (comms, not money)
// ===========================================================================
describe("ORCH-1150-R2 D-8 — RSVP detail keeps Blasts + Group-chat tiles", () => {
  const source = readFileSync(SCREEN_SOURCE_PATH, "utf8");

  test("renders a Group chat tile routing to the event-scoped /event/{id}/group-chat", () => {
    expect(source).toContain('label="Group chat"');
    expect(source).toContain("handleGroupChat");
    expect(source).toMatch(/router\.push\(`\/event\/\$\{id\}\/group-chat`/);
  });

  test("renders a Blasts tile routing to the event-scoped /event/{id}/blasts", () => {
    expect(source).toContain('label="Blasts"');
    expect(source).toContain("handleBlasts");
    expect(source).toMatch(/router\.push\(`\/event\/\$\{id\}\/blasts`/);
  });

  test("each cross-type push carries the route-by-event-type allowlist comment (gate stays green)", () => {
    // The two /event/... pushes from this /rsvp screen are only legal with the
    // strict-grep allowlist comment within 3 lines above. Reverting either
    // comment (or the tiles) trips i-proposed-tr2-route-by-event-type.
    const allowMatches = source.match(
      /orch-strict-grep-allow route-by-event-type/g,
    );
    expect(allowMatches).not.toBeNull();
    expect((allowMatches ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// ORCH-1150-R2 (D-9b) — RSVP detail Edit enters the edit screen on its
// edit-published path. The detail page is only shown for a PUBLISHED RSVP;
// without ?mode=edit-published the edit screen runs the draft-resolution path
// (useDraftById), finds no draft for a published RSVP, and bounces to the
// events list. handleEdit MUST therefore push the edit-published route.
//
// Fails-on-revert: delete the `?mode=edit-published` from the handleEdit push
// in index.tsx and the assertion below fails (the bare /rsvp/{id}/edit route
// is the bug that bounces to the events list).
// ===========================================================================
describe("ORCH-1150-R2 D-9b — RSVP detail Edit passes mode=edit-published", () => {
  const source = readFileSync(SCREEN_SOURCE_PATH, "utf8");

  test("handleEdit pushes the edit screen WITH ?mode=edit-published", () => {
    // The Edit tile's handler must enter the published-edit path so the edit
    // screen resolves the live event (useBusinessEventById) instead of the
    // non-existent draft (useDraftById) and bouncing to the events list.
    expect(source).toMatch(
      /router\.push\(\s*`\/rsvp\/\$\{id\}\/edit\?mode=edit-published`/,
    );
  });

  test("no bare /rsvp/{id}/edit push remains in handleEdit (the bounce bug)", () => {
    // The ONLY draft-mode (no ?mode=) /rsvp/{id}/edit navigation legitimately
    // left in this file is the "Defensive: draft → redirect" router.replace —
    // it is a router.replace, NOT a router.push. Assert no router.push targets
    // the bare edit route (that bare-push WAS the D-9b bounce bug).
    expect(source).not.toMatch(
      /router\.push\(\s*`\/rsvp\/\$\{id\}\/edit`/,
    );
  });
});
