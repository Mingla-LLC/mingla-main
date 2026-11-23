/**
 * #4490 spec 08 O3 part A2 — the kitchen on the Till (§11 T5 / T7): a sent round
 * reads "Ready {time}" once every station is ready, "Not accepted · {n} min"
 * from 3 minutes, and nothing once it was picked up; the check shows "Ready to
 * take out · {destination}" with Picked up, or "Nobody has accepted
 * {destination}'s order" with Print ticket; the Till hears station changes on
 * venue_orders (T6).
 *
 * fails-on-revert: roundKitchenState / readyToTakeOut / unacceptedRound and the
 * Till's two banners are pinned here.
 */
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

import type { TillLine, TillSale } from "../../../../services/venueTillService";
import {
  basketRows,
  NOT_ACCEPTED_AFTER_MINUTES,
  readyToTakeOut,
  roundKitchenState,
  tillDestination,
  unacceptedRound,
} from "../tillModel";
import { TILL_COPY } from "../tillCopy";

const SENT = "2026-11-23T20:00:00Z";
const T = (min: number): number => Date.parse(SENT) + min * 60_000;

const round = (over: Partial<TillLine>): TillLine => ({
  id: "l1",
  kind: "menu_round",
  state: "held",
  amountMinor: 1000,
  label: null,
  orderId: "o1",
  groupId: null,
  sent: true,
  fulfillmentStatus: "placed",
  pickupCode: null,
  sentAt: SENT,
  acknowledgedAt: null,
  stationTickets: [{ station: "kitchen", acceptedAt: null, readyAt: null, pickedUpAt: null }],
  items: [{ id: "i1", menuItemId: "m1", name: "Suya", quantity: 1, unitMinor: 1000, lineTotalMinor: 1000, notes: null, modifiers: [], voided: false, prepState: "pending" }],
  ...over,
});
const sale = (lines: TillLine[]): TillSale => ({ checkLabel: "Tolu", spotLabel: null, lines } as unknown as TillSale);

describe("08-O3 A2 round kitchen state", () => {
  test("sent and waiting, then Not accepted from 3 minutes", () => {
    expect(NOT_ACCEPTED_AFTER_MINUTES).toBe(3);
    expect(roundKitchenState(round({}), T(2))).toEqual({ kind: "waiting" });
    expect(roundKitchenState(round({}), T(3))).toEqual({ kind: "not_accepted", minutes: 3 });
    expect(TILL_COPY.notAccepted(4)).toBe("Not accepted · 4 min");
  });
  test("accepted, then Ready once EVERY station is ready, then nothing once picked up", () => {
    const two = [
      { station: "kitchen" as const, acceptedAt: "a", readyAt: "2026-11-23T20:12:00Z", pickedUpAt: null },
      { station: "bar" as const, acceptedAt: "a", readyAt: null, pickedUpAt: null },
    ];
    expect(roundKitchenState(round({ acknowledgedAt: "a", stationTickets: two }), T(20))).toEqual({ kind: "accepted" });
    const ready = two.map((t) => ({ ...t, readyAt: t.readyAt ?? "2026-11-23T20:14:00Z" }));
    expect(roundKitchenState(round({ acknowledgedAt: "a", stationTickets: ready }), T(20))).toEqual({ kind: "ready", readyAt: "2026-11-23T20:14:00Z" });
    const gone = ready.map((t) => ({ ...t, pickedUpAt: "p" }));
    expect(roundKitchenState(round({ acknowledgedAt: "a", stationTickets: gone }), T(20))).toBeNull();
    expect(roundKitchenState(round({ fulfillmentStatus: "delivered" }), T(20))).toBeNull();
  });
  test("a held (unsent) or voided round has no kitchen state", () => {
    expect(roundKitchenState(round({ sentAt: null, sent: false }), T(30))).toBeNull();
    expect(roundKitchenState(round({ state: "voided" }), T(30))).toBeNull();
  });
  test("basket rows carry the state; a voided item carries none", () => {
    const rows = basketRows(sale([round({ items: [
      { id: "i1", menuItemId: "m1", name: "Suya", quantity: 1, unitMinor: 1, lineTotalMinor: 1, notes: null, modifiers: [], voided: false, prepState: "pending" },
      { id: "i2", menuItemId: "m2", name: "Asun", quantity: 1, unitMinor: 1, lineTotalMinor: 1, notes: null, modifiers: [], voided: true, prepState: "voided" },
    ] })]), T(5));
    expect(rows.map((r) => r.kitchen)).toEqual([{ kind: "not_accepted", minutes: 5 }, null]);
  });
});

describe("08-O3 A2 the check's banners", () => {
  test("Ready to take out lists the rounds and stations on the pass", () => {
    const s = sale([round({ acknowledgedAt: "a", stationTickets: [
      { station: "kitchen", acceptedAt: "a", readyAt: "r", pickedUpAt: null },
      { station: "bar", acceptedAt: "a", readyAt: "r", pickedUpAt: "p" },
    ] })]);
    expect(readyToTakeOut(s)).toEqual([{ orderId: "o1", stations: ["kitchen"] }]);
    expect(TILL_COPY.readyToTakeOut(tillDestination(s, TILL_COPY.thisCheck))).toBe("Ready to take out · Tolu");
  });
  test("Nobody has accepted names the oldest waiting round and a station to print", () => {
    const s = sale([round({})]);
    expect(unacceptedRound(s, T(2))).toBeNull();
    expect(unacceptedRound(s, T(4))).toEqual({ orderId: "o1", station: "kitchen", minutes: 4 });
    expect(TILL_COPY.nobodyAccepted("Table 6")).toBe("Nobody has accepted Table 6's order");
  });
  test("the Till shows both banners with their actions and hears station changes on venue_orders", () => {
    const screen = fs.readFileSync(path.join(__dirname, "../TillScreen.tsx"), "utf8");
    expect(screen).toContain('testID="till-ready-banner"');
    expect(screen).toContain('runStationAction("picked_up", round.orderId, station)');
    expect(screen).toContain('testID="till-unaccepted-banner"');
    expect(screen).toContain('kind: "kitchen_ticket", venueId, orderId: waitingRound.orderId');
    const hook = fs.readFileSync(path.join(__dirname, "../../../../hooks/useVenueTill.ts"), "utf8");
    expect(hook).toMatch(/table: "venue_orders", filter: `venue_id=eq\.\$\{venueId\}`/);
  });
});
