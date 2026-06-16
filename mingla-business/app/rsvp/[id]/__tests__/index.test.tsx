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

  test("DROP: NO blasts / group-chat tiles, NO activity feed, NO manage menu, NO cancel/end-sales", () => {
    expect(source).not.toContain('label="Blasts"');
    expect(source).not.toContain("Group chat");
    expect(source).not.toContain("EventDetailActivityRow");
    expect(source).not.toContain("recentActivity");
    expect(source).not.toContain("EventManageMenu");
    expect(source).not.toContain("EndSalesSheet");
    expect(source).not.toMatch(/Cancel event|handleCancelConfirm/);
  });

  test("REGRESSION: protective comment + only /rsvp routes (no hardcoded /event/ or /trip/)", () => {
    expect(source).toContain("DO NOT delete");
    // The route gate (i-proposed-tr2) bans /event/ and /trip/ literals; this
    // screen only pushes /rsvp/... , /e/... , /brand/... and /(tabs)/...
    expect(source).not.toMatch(/`\/event\//);
    expect(source).not.toMatch(/`\/trip\//);
  });
});
