/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 3 rework (0dcb35d214) — TESTER RETEST, adversarial.
 *
 *   F-1 planClearAt under a seeded sweep of 2–4 stop plans (overnight, split,
 *       24h, closed days, outdoor stops, rain, starts either side of
 *       midnight): EVERY offered "Start at" fix leaves the whole plan clear —
 *       no closed / closing-too-soon stop and no rain at an outdoor stop —
 *       and is never before the next sensible slot.
 *   F-2 rain AND a closed stop together: the closed warning wins, and its fix
 *       (if any) also clears the rain.
 *   Q-1 one "worth arriving" rule: over a week of starts, the schedule check
 *       calls a stop closed exactly when the sheet does (both read 15 min).
 *   Q-2 the single-card schedule check is NOT changed by the plan rule (a
 *       single place 10 minutes before close still schedules; its own sheet
 *       shows "Closes in 10 min", not "Closed").
 *   Q-3 the boundary: 15 minutes left is worth arriving, 14 is not, in both.
 *   C-1 the route cap note and the link agree: the note's "N" is the number
 *       of placeable stops, the link opens exactly 10 of them, and no note
 *       when every placeable stop fits (unplaceable stops are not counted).
 *   I-1 the identity-keyed reset: a new card OBJECT with the same id (GPS
 *       refetch, collab travel mode, realtime refresh) keeps the start and
 *       swaps; a different id, a close, and a reopen of the same card reset.
 *   Q-4 (pinned, P3) the deck smart chip still ignores the 15-minute rule.
 *   E-1 On the night: a leave-by already past reads "Leave now"; no drive
 *       means no footnote at all.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT (verified by the tester in an isolated worktree, see #4347):
 *   - fixStartFor without the planClearAt check -> F-1 (and the wave 3 file's W-5) fail;
 *   - checkAllCuratedStopsOpen without the 15-minute refusal -> Q-1, Q-3 fail;
 *   - routeCap returning null -> C-1 fails;
 *   - useResetOnPlanIdentity keyed on the visible flag only -> I-1 fails;
 *   - the "Leave now" branch removed -> E-1 fails.
 */
import React from "react";

jest.mock("../../../utils/openMapsTarget", () => ({ openMapsTarget: jest.fn() }));

const TestRenderer = require("react-test-renderer") as typeof import("react-test-renderer");
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

import {
  arrivalOpen,
  isOutdoorStop,
  nextSensibleSlot,
  planTimeline,
  planWarning,
  rainLikely,
  stopForecastAt,
  type PlanStop,
  type StopForecast,
} from "../curatedPlanModel";
import { MIN_USEFUL_OPEN_MINUTES, checkAllCuratedStopsOpen } from "../../../utils/curatedStopsAvailability";
import { checkSingleCardSchedulingAvailability } from "../../../utils/singleCardAvailability";
import { getOpenStatusAt } from "../../../utils/openingHoursUtils";
import { ROUTE_MAX_STOPS, planRouteTargets, routeAllStopsUrl, routeCap } from "../placeDirections";
import { useResetOnPlanIdentity } from "../planScroll";
import { curatedSmartChip } from "../../deckCard/deckCardModel";
import { onTheNightFacts } from "../../../screens/Experience/onTheNight";

const OFF = 60;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const g = (open: string, close: string): string => `${open.replace(" ", " ")} – ${close.replace(" ", " ")}`;
const week = (line: string): string[] => DAYS.map((d) => `${d}: ${line}`);
// 13 Nov 2026 is a Friday. Venue-local wall clock -> instant at UTC+1.
const venue = (day: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, day, h, m) - OFF * 60_000);

function stop(over: Partial<PlanStop> & { placeName: string }): PlanStop {
  return {
    placeId: over.placeName.toLowerCase().replace(/\s+/g, "-"),
    placeType: "casual_eats",
    address: `${over.placeName} street`,
    imageUrl: null,
    lat: 6.45,
    lng: 3.43,
    openingHours: { weekdayDescriptions: week(g("8:00 AM", "11:00 PM")) },
    estimatedDurationMinutes: 45,
    travelTimeFromPreviousStopMin: null,
    travelModeFromPreviousStop: "driving",
    utcOffsetMinutes: OFF,
    ...over,
  } as PlanStop;
}

function forecastFrom(day: number, rainy: (d: number, h: number) => boolean, hours = 72): StopForecast {
  const hourly = Array.from({ length: hours }, (_, i) => {
    const d = day + Math.floor(i / 24);
    const h = i % 24;
    const rain = rainy(d, h);
    return {
      time: `2026-11-${d}T${String(h).padStart(2, "0")}:00`,
      temperature: 70,
      condition: rain ? "Rain" : "Clouds",
      icon: rain ? "10n" : "04n",
      precipitation: rain ? 0.2 : 0,
      precipitationProbability: rain ? 90 : 5,
    };
  });
  return { hourly, utcOffsetSeconds: OFF * 60 };
}

/** Clear = what the sheet would show: no closed chip, no rain chip at an outdoor stop. */
function clearAt(stops: PlanStop[], forecasts: (StopForecast | null)[], start: Date): boolean {
  const tl = planTimeline(stops, start, "driving");
  return tl.every((s, i) => arrivalOpen(s.open)?.kind !== "closed" && !(isOutdoorStop(stops[i]) && rainLikely(stopForecastAt(forecasts[i], s.arrival))));
}

// Deterministic generator.
function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
const HOURS = [
  week(g("8:00 AM", "11:00 PM")),
  week(g("6:00 PM", "2:00 AM")),
  week(g("11:00 AM", "2:00 PM")).map((l) => `${l}, ${g("5:00 PM", "10:00 PM")}`),
  week("Open 24 hours"),
  DAYS.map((d) => `${d}: ${d === "Friday" || d === "Saturday" ? g("8:00 PM", "3:00 AM") : "Closed"}`),
  week(g("9:00 AM", "5:00 PM")),
  week(g("4:00 PM", "11:30 PM")),
];

describe("F — a fix never breaks another stop", () => {
  test("F-1 seeded sweep: every offered fix clears the whole plan and is never in the past", () => {
    const next = rng(4347);
    let offered = 0;
    let warnings = 0;
    for (let n = 0; n < 1500; n += 1) {
      const count = 2 + Math.floor(next() * 3);
      const stops = Array.from({ length: count }, (_, i) =>
        stop({
          placeName: `S${n}_${i}`,
          openingHours: { weekdayDescriptions: HOURS[Math.floor(next() * HOURS.length)] },
          estimatedDurationMinutes: 30 + Math.floor(next() * 5) * 30,
          travelTimeFromPreviousStopMin: i === 0 ? null : Math.floor(next() * 30),
          placeType: next() < 0.35 ? "park" : "casual_eats",
        }),
      );
      const wetHour = Math.floor(next() * 24);
      const forecasts = stops.map(() => forecastFrom(13, (d, h) => d === 13 + (wetHour % 2) && Math.abs(h - wetHour) <= 1));
      const start = venue(13, 10 + Math.floor(next() * 16), next() < 0.5 ? 0 : 30); // 10:00 .. 01:30 next day
      const now = venue(13, 8, Math.floor(next() * 60));
      const w = planWarning({ stops, start, now, forecasts, fallbackMode: "driving" });
      if (!w) continue;
      warnings += 1;
      if (w.fixStart === null) continue;
      offered += 1;
      expect([n, w.fixStart.getTime() >= nextSensibleSlot(now).getTime()]).toEqual([n, true]);
      expect([n, clearAt(stops, forecasts, w.fixStart)]).toEqual([n, true]);
      expect([n, planWarning({ stops, start: w.fixStart, now, forecasts, fallbackMode: "driving" })]).toEqual([n, null]);
    }
    // The sweep must actually exercise both branches.
    expect(warnings).toBeGreaterThan(300);
    expect(offered).toBeGreaterThan(50);
  });

  test("F-2 rain at an outdoor stop AND a closed stop: closed wins, and its fix also clears the rain", () => {
    const stops = [
      stop({ placeName: "Park", placeType: "park", estimatedDurationMinutes: 60 }),
      stop({ placeName: "Shop", openingHours: { weekdayDescriptions: week(g("9:00 AM", "5:00 PM")) } }),
    ];
    // Start 16:30: Park 16:30, Shop 17:30 (closed). Earlier fixes: 16:00 puts Park in the 16:00 rain.
    const forecasts = [forecastFrom(14, (d, h) => d === 14 && h === 16), null];
    const w = planWarning({ stops, start: venue(14, 16, 30), now: venue(14, 9, 0), forecasts });
    expect(w).toMatchObject({ kind: "closed", index: 1 });
    expect(w!.fixStart).not.toBeNull();
    expect(w!.fixStart!.getTime()).not.toBe(venue(14, 16, 0).getTime()); // the rainy start is skipped
    expect(clearAt(stops, forecasts, w!.fixStart!)).toBe(true);
  });
});

describe("Q — one worth-arriving rule", () => {
  test("Q-1 a week of starts: the schedule check says closed exactly when the sheet does", () => {
    let compared = 0;
    for (const hours of HOURS) {
      const stops = [
        stop({ placeName: "A", openingHours: { weekdayDescriptions: hours }, estimatedDurationMinutes: 50 }),
        stop({ placeName: "B", openingHours: { weekdayDescriptions: HOURS[(HOURS.indexOf(hours) + 3) % HOURS.length] }, travelTimeFromPreviousStopMin: 13 }),
      ];
      for (let t = venue(9, 0).getTime(); t < venue(16, 0).getTime(); t += 35 * 60_000) {
        const start = new Date(t);
        const tl = planTimeline(stops, start, null);
        const check = checkAllCuratedStopsOpen(stops, start, "en-US");
        tl.forEach((s, i) => {
          const sheetClosed = arrivalOpen(s.open)?.kind === "closed";
          const checkClosed = check.results[i].status === "closed";
          expect([start.toISOString(), i, checkClosed]).toEqual([start.toISOString(), i, sheetClosed]);
          compared += 1;
        });
      }
    }
    expect(compared).toBeGreaterThan(2000);
  });

  test("Q-2 the single-card check keeps its own rule: 10 minutes before close still schedules", () => {
    const place = { openingHours: { weekdayDescriptions: week(g("8:00 AM", "8:00 PM")) }, utcOffsetMinutes: OFF };
    expect(checkSingleCardSchedulingAvailability(place, venue(13, 19, 50), "en-US").isSafeToSchedule).toBe(true);
    expect(getOpenStatusAt(place.openingHours.weekdayDescriptions, venue(13, 19, 50), OFF)).toMatchObject({ kind: "closing", minutesLeft: 10 });
    expect(checkSingleCardSchedulingAvailability(place, venue(13, 20, 0), "en-US").isSafeToSchedule).toBe(false);
  });

  test("Q-3 boundary: 15 minutes left is worth arriving, 14 is not, in the sheet and the check alike", () => {
    expect(MIN_USEFUL_OPEN_MINUTES).toBe(15);
    const s = [stop({ placeName: "Bakery", openingHours: { weekdayDescriptions: week(g("8:00 AM", "8:00 PM")) } })];
    const at15 = venue(13, 19, 45);
    const at14 = venue(13, 19, 46);
    expect(arrivalOpen(planTimeline(s, at15, null)[0].open)?.kind).toBe("closes");
    expect(checkAllCuratedStopsOpen(s, at15, "en-US").allOpen).toBe(true);
    expect(arrivalOpen(planTimeline(s, at14, null)[0].open)?.kind).toBe("closed");
    const r = checkAllCuratedStopsOpen(s, at14, "en-US");
    expect(r.allOpen).toBe(false);
    expect(r.results[0].reason).toMatch(/^Closes within 15 min of arriving at /);
    // An overnight bar 10 min before its 2am close (Saturday 01:50): closed for both.
    const bar = [stop({ placeName: "Bar", openingHours: { weekdayDescriptions: week(g("6:00 PM", "2:00 AM")) } })];
    expect(checkAllCuratedStopsOpen(bar, venue(14, 1, 50), "en-US").allOpen).toBe(false);
    expect(checkAllCuratedStopsOpen(bar, venue(14, 1, 0), "en-US").allOpen).toBe(true);
  });
  // P3 (pinned): the deck's smart chip (deckCardModel.ts:425) still reads only
  // getOpenStatusAt's "closed", so it stays silent where the sheet and the
  // schedule check both call the stop closed.
  test("Q-4 (P3) the deck chip flags a stop that closes 10 min after arrival, like the sheet and the check", () => {
    const s = [stop({ placeName: "Bakery", openingHours: { weekdayDescriptions: week(g("8:00 AM", "8:00 PM")) } })];
    const at = venue(13, 19, 50);
    expect(checkAllCuratedStopsOpen(s, at, "en-US").allOpen).toBe(false);
    expect(curatedSmartChip(s.map((x) => ({ ...x, travelTimeFromUserMin: 0 })), at)).toMatchObject({ kind: "stopClosedAtArrival", stopNumber: 1 });
  });
});

describe("C — the route cap note", () => {
  test("C-1 the note counts placeable stops; the link opens exactly ROUTE_MAX_STOPS of them", () => {
    const placed = (n: number) => Array.from({ length: n }, (_, i) => ({ placeName: `Stop ${i + 1}`, lat: 6 + i / 100, lng: 3 + i / 100 }));
    expect(routeCap(planRouteTargets(placed(10)))).toBeNull();
    const twelve = planRouteTargets(placed(12));
    expect(routeCap(twelve)).toEqual({ opened: ROUTE_MAX_STOPS, total: 12 });
    const q = new URL(routeAllStopsUrl(twelve, "driving") as string).searchParams;
    expect(q.get("waypoints")!.split("|").length + 1).toBe(routeCap(twelve)!.opened);
    // 11 listed, one with neither coordinates nor name nor address: 10 placeable, no note.
    const withGhost = [...placed(10), { placeName: "", address: "", lat: null, lng: null }];
    expect(routeCap(planRouteTargets(withGhost))).toBeNull();
    // A stop with no name falls back to its address.
    expect(planRouteTargets([{ placeName: "", address: "12 Broad St" }])[0].label).toBe("12 Broad St");
  });
});

describe("I — the identity-keyed reset", () => {
  function Probe({ visible, id, onReset }: { visible: boolean; id: string | null; onReset: () => void }) {
    useResetOnPlanIdentity(visible, id, onReset);
    return null;
  }

  test("I-1 same id re-renders keep the plan; a different id, a close and a reopen reset it", () => {
    const resets: string[] = [];
    let label = "first";
    const el = (visible: boolean, id: string | null) => <Probe visible={visible} id={id} onReset={() => resets.push(label)} />;
    let root: import("react-test-renderer").ReactTestRenderer;
    TestRenderer.act(() => {
      root = TestRenderer.create(el(true, "plan-1"));
    });
    expect(resets).toEqual(["first"]);
    // GPS refetch / collab travel-mode change / realtime refresh: new props, same card id.
    for (let i = 0; i < 5; i += 1) {
      label = `rerender-${i}`;
      TestRenderer.act(() => root!.update(el(true, "plan-1")));
    }
    expect(resets).toEqual(["first"]);
    label = "next-card";
    TestRenderer.act(() => root!.update(el(true, "plan-2")));
    label = "closed";
    TestRenderer.act(() => root!.update(el(false, "plan-2")));
    label = "reopened";
    TestRenderer.act(() => root!.update(el(true, "plan-2")));
    expect(resets).toEqual(["first", "next-card", "closed", "reopened"]);
    TestRenderer.act(() => root!.unmount());
  });
});

describe("E — On the night", () => {
  const t = (key: string, o: Record<string, unknown> = {}) => `${key}${Object.keys(o).length ? JSON.stringify(o) : ""}`;
  test("E-1 a leave-by already past reads Leave now; no drive means no footnote", () => {
    const place = { lat: 40.758, lng: -73.9855 };
    const viewer = { lat: 40.65, lng: -73.95 }; // ~13 km: a drive well over 10 minutes
    const at = new Date(Date.UTC(2026, 10, 14, 1, 0));
    const now = new Date(at.getTime() - 10 * 60_000);
    const soon = onTheNightFacts({ at, now, forecast: null, timeZone: "America/New_York", viewer, place, language: "en", t });
    expect(soon?.footnote).toMatch(/^cards:exp\.leave_now /);
    expect(soon?.footnote).not.toMatch(/leave_by/);
    const weatherOnly = onTheNightFacts({
      at,
      now: new Date(at.getTime() - 60 * 60_000),
      forecast: {
        temperature: 50, condition: "Clouds", icon: "04n", description: "", feelsLike: 50, humidity: 0, windSpeed: 0, recommendation: "",
        hourlyForecast: [{ time: "2026-11-13T20:00", temperature: 50, condition: "Clouds", icon: "04n", precipitation: 0, precipitationProbability: 5 }],
        utcOffsetSeconds: -300 * 60,
      } as never,
      timeZone: "America/New_York",
      viewer: null,
      place,
      language: "en",
      t,
    });
    expect(weatherOnly?.weather).toMatch(/50°/);
    expect(weatherOnly?.footnote ?? null).toBeNull();
  });
});
