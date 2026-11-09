/**
 * #4347 wave 3 + rework + follow-ups — TESTER ADVERSARIAL (model layer).
 *
 * A different angle from the implementor's happy paths
 * (issue_4347_plan_model.implementor.test.ts, the overnight Deno suite):
 *
 *   O  the ONE overnight-hours model, attacked with Google's REAL separators
 *      (U+202F before AM/PM, U+2009 around the dash), a closed previous day, a
 *      missing previous-day line, 24h strings next to Closed, split hours, an
 *      unknown-hours plan, and a whole-week sweep proving `isPlaceOpenAt` is
 *      exactly the yes/no projection of `getOpenStatusAt` (what the Saved
 *      "open" filter, the open-now badges and the schedule check now read).
 *   T  arrival times: one model shared by the sheet, the schedule check and
 *      the deck chip, across midnight and with a venue clock that is not the
 *      device's; the start-time change moves every reader together.
 *   W  the ONE warning: priority when rain comes FIRST in the plan, a start
 *      fix never in the past, never beyond the forecast, a fix-less warning
 *      hidden, outdoor only by category (slug variants, never the name), and
 *      the fix not breaking ANOTHER stop.
 *   R  Route all stops: hostile labels round-trip through the URL, the
 *      waypoint cap keeps the order and the destination, unplaceable stops,
 *      Linking rejection surfaced, and no raw maps URL elsewhere in src.
 *   S  the planScroll store under a 2,000-frame scroll: publishes stay bounded.
 *   E  "On the night" leave-by maths in a venue zone that is not the device's.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * Known defects are pinned with test.failing (they pass once fixed):
 *   W-5  a "Start at …" fix can move the plan onto a start where an EARLIER
 *        stop is closed (the fix clears one stop by breaking another);
 *   T-4  a stop that closes 10 minutes after you arrive: the sheet says
 *        "Closed at …" and warns, while the schedule check says every stop is
 *        open and schedules it.
 *
 * FAILS-ON-REVERT (verified by the tester in an isolated worktree, see #4347):
 *   - isPlaceOpenAt restored to the pre-follow-up body (the arrival day's own
 *     line only) -> O-1, O-3, O-6 and T-2 fail;
 *   - routeAllStopsUrl without encodeURIComponent on the tokens -> R-1 fails;
 *   - routeAllStopsUrl without the waypoint cap -> R-2 fails;
 *   - the (0,0) guard dropped from stopToken -> R-3 fails;
 *   - planWarning returning a fix-less warning -> W-3 fails;
 *   - the store's `same` guard removed (publish every frame) -> S-1 fails;
 *   - fixStartFor without the minStart floor -> W-2 fails.
 */
import * as fs from "fs";
import * as path from "path";

jest.mock("../../../utils/openMapsTarget", () => ({ openMapsTarget: jest.fn() }));

import {
  arrivalOpen,
  isOutdoorStop,
  nextSensibleSlot,
  planTimeline,
  planWarning,
  type PlanStop,
  type StopForecast,
} from "../curatedPlanModel";
import { checkAllCuratedStopsOpen, curatedArrivalTimes } from "../../../utils/curatedStopsAvailability";
import { getOpenStatusAt, isPlaceOpenAt, isPlaceOpenNow } from "../../../utils/openingHoursUtils";
import { curatedSmartChip } from "../../deckCard/deckCardModel";
import { GOOGLE_MAPS_MAX_WAYPOINTS, openRouteAllStops, routeAllStopsUrl } from "../placeDirections";
import { PlanScrollStore } from "../planScroll";
import { LEAVE_BUFFER_MINUTES, onTheNightFacts } from "../../../screens/Experience/onTheNight";

const RN = require("react-native");

// Google's real weekdayDescriptions: narrow no-break space before AM/PM and a
// thin space either side of the en dash.
const g = (open: string, close: string): string => `${open.replace(" ", " ")} – ${close.replace(" ", " ")}`;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const lines = (by: Record<string, string>): string[] => DAYS.filter((d) => d in by).map((d) => `${d}: ${by[d]}`);

// A Fri/Sat late bar, every other day closed. Venue clock UTC+1 (Lagos); the
// jest process clock is not UTC+1, so a device-clock bug would show.
const OFF = 60;
const BAR = lines({
  Monday: "Closed",
  Tuesday: "Closed",
  Wednesday: "Closed",
  Thursday: "Closed",
  Friday: g("6:00 PM", "2:00 AM"),
  Saturday: g("6:00 PM", "2:00 AM"),
  Sunday: "Closed",
});
// Venue-local wall clock -> instant, for the venue at UTC+1. 13 Nov 2026 is a Friday.
const venue = (day: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, day, h, m) - OFF * 60_000);

describe("O — the one overnight-hours model", () => {
  test("O-1 Fri/Sat 6pm-2am with Google's real separators: 23:30 and 01:00 on both nights", () => {
    expect(isPlaceOpenAt(BAR, venue(13, 23, 30), OFF)).toBe(true); // Fri 23:30
    expect(isPlaceOpenAt(BAR, venue(14, 1, 0), OFF)).toBe(true); // Sat 01:00, Friday night still running
    expect(isPlaceOpenAt(BAR, venue(14, 23, 30), OFF)).toBe(true); // Sat 23:30
    expect(isPlaceOpenAt(BAR, venue(15, 1, 0), OFF)).toBe(true); // Sun 01:00, Saturday night still running
    expect(isPlaceOpenAt(BAR, venue(15, 2, 0), OFF)).toBe(false); // Sun 02:00, closed on the dot
    expect(isPlaceOpenAt(BAR, venue(13, 1, 0), OFF)).toBe(false); // Fri 01:00, Thursday was closed
  });

  test("O-2 a closed previous day carries nothing over; a 24h day next to Closed ends at midnight", () => {
    const h = lines({ Thursday: "Closed", Friday: "Open 24 hours", Saturday: "Closed", Sunday: "Closed", Monday: "Closed", Tuesday: "Closed", Wednesday: "Closed" });
    expect(isPlaceOpenAt(h, venue(13, 0, 30), OFF)).toBe(true);
    expect(isPlaceOpenAt(h, venue(13, 23, 59), OFF)).toBe(true);
    expect(isPlaceOpenAt(h, venue(14, 0, 30), OFF)).toBe(false);
    expect(getOpenStatusAt(h, venue(13, 12, 0), OFF)).toMatchObject({ kind: "open", closesAtMinute: 0 });
    const always = DAYS.map((d) => `${d}: open 24 hours`); // lower-case variant
    expect(getOpenStatusAt(always, venue(13, 3, 0), OFF)).toEqual({ kind: "open24h" });
    expect(isPlaceOpenAt(always, venue(16, 3, 0), OFF)).toBe(true);
  });

  test("O-3 a missing previous-day line: the target day still decides; a missing TARGET day is unknown (blocks)", () => {
    const onlySat = lines({ Saturday: g("6:00 PM", "2:00 AM") });
    expect(isPlaceOpenAt(onlySat, venue(14, 1, 0), OFF)).toBe(false); // Sat 01:00, no Friday line: no carry-over
    expect(isPlaceOpenAt(onlySat, venue(14, 20, 0), OFF)).toBe(true);
    expect(isPlaceOpenAt(onlySat, venue(15, 1, 0), OFF)).toBeNull(); // Sunday line missing -> unknown
    const r = checkAllCuratedStopsOpen([{ placeName: "Late", openingHours: onlySat, utcOffsetMinutes: OFF }], venue(15, 1, 0), "en-US");
    expect(r.allOpen).toBe(false);
    expect(r.results[0].status).toBe("unknown");
  });

  test("O-4 split hours: open in each range, closed in the gap and on the boundary", () => {
    const split = DAYS.map((d) => `${d}: ${g("11:00 AM", "2:00 PM")}, ${g("5:00 PM", "10:00 PM")}`);
    expect(isPlaceOpenAt(split, venue(13, 12, 0), OFF)).toBe(true);
    expect(isPlaceOpenAt(split, venue(13, 14, 0), OFF)).toBe(false);
    expect(isPlaceOpenAt(split, venue(13, 15, 30), OFF)).toBe(false);
    expect(isPlaceOpenAt(split, venue(13, 21, 59), OFF)).toBe(true);
  });

  test("O-5 an unknown-hours stop blocks the whole plan, even when every other stop is open", () => {
    const open = DAYS.map((d) => `${d}: Open 24 hours`);
    for (const unknown of [null, undefined, "", "[]", { weekday_text: ["OpenNow: false"] }, ["not a day line"]]) {
      const r = checkAllCuratedStopsOpen(
        [
          { placeName: "A", openingHours: open, utcOffsetMinutes: OFF },
          { placeName: "B", openingHours: unknown, utcOffsetMinutes: OFF },
        ],
        venue(13, 20, 0),
        "en-US",
      );
      expect(r.allOpen).toBe(false);
      expect(r.results[1].status).toBe("unknown");
    }
  });

  test("O-6 a week at 15-minute steps: isPlaceOpenAt and isPlaceOpenNow are exactly the yes/no of getOpenStatusAt", () => {
    const sets = [
      BAR,
      DAYS.map((d) => `${d}: ${g("9:00 AM", "12:00 AM")}`),
      DAYS.map((d) => `${d}: ${g("11:00 AM", "2:00 PM")}, ${g("5:00 PM", "1:30 AM")}`),
      lines({ Monday: "Open 24 hours", Tuesday: g("6:00 PM", "4:00 AM"), Wednesday: "Closed", Thursday: g("10:00 AM", "10:00 PM"), Friday: g("8:00 PM", "3:00 AM"), Saturday: "Open 24 hours", Sunday: g("12:00 PM", "12:00 AM") }),
    ];
    let compared = 0;
    for (const h of sets) {
      for (let t = venue(9, 0).getTime(); t < venue(16, 0).getTime(); t += 15 * 60_000) {
        const at = new Date(t);
        const status = getOpenStatusAt(h, at, OFF);
        if (status === null) continue;
        const yes = status.kind !== "closed";
        expect([at.toISOString(), isPlaceOpenAt(h, at, OFF)]).toEqual([at.toISOString(), yes]);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(2000);
    jest.useFakeTimers().setSystemTime(venue(14, 1, 0));
    try {
      expect(isPlaceOpenNow(BAR, OFF)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── Arrival times ───────────────────────────────────────────────────────────

const week = (line: string): string[] => DAYS.map((d) => `${d}: ${line}`);
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

describe("T — one arrival model", () => {
  const LATE: PlanStop[] = [
    stop({ placeName: "Dinner", openingHours: { weekdayDescriptions: week(g("8:00 AM", "2:00 AM")) }, estimatedDurationMinutes: 120 }),
    stop({ placeName: "Club", openingHours: { weekdayDescriptions: BAR }, estimatedDurationMinutes: 90, travelTimeFromPreviousStopMin: 20 }),
    stop({ placeName: "Suya", openingHours: { weekdayDescriptions: week(g("6:00 PM", "3:00 AM")) }, estimatedDurationMinutes: 30, travelTimeFromPreviousStopMin: 10 }),
  ];

  test("T-1 a plan that crosses midnight: the sheet, the schedule check and the deck chip agree stop by stop", () => {
    const start = venue(13, 22, 0); // Fri 22:00 -> Club at 00:20 Sat, Suya at 02:00 Sat
    const tl = planTimeline(LATE, start, "driving");
    expect(tl.map((s) => s.arrival.toISOString())).toEqual(curatedArrivalTimes(LATE, start).map((s) => s.arrival.toISOString()));
    expect(tl[1].arrival.getTime()).toBe(venue(14, 0, 20).getTime());
    expect(tl[2].arrival.getTime()).toBe(venue(14, 2, 0).getTime());
    const check = checkAllCuratedStopsOpen(LATE, start, "en-US");
    expect(check.results.map((r) => r.status)).toEqual(["open", "open", "open"]);
    expect(tl.map((s) => arrivalOpen(s.open)?.kind === "closed")).toEqual([false, false, false]);
    // The deck chip (started "now", no lead) sees no closed stop either.
    expect(curatedSmartChip(LATE.map((s) => ({ ...s, travelTimeFromUserMin: 0 })), start)).toBeNull();
  });

  test("T-2 a start two hours later breaks the Friday-night club in ALL three readers at once", () => {
    // Thu 23:00: dinner is open, but the club at Fri 01:20 is Thursday night, and Thursday is closed.
    const thu = venue(12, 23, 0); // Thu 23:00 -> Club at Fri 01:20, Thursday closed
    const check = checkAllCuratedStopsOpen(LATE, thu, "en-US");
    expect(check.results[1].status).toBe("closed");
    expect(arrivalOpen(planTimeline(LATE, thu, "driving")[1].open)?.kind).toBe("closed");
    expect(curatedSmartChip(LATE.map((s) => ({ ...s, travelTimeFromUserMin: 0 })), thu)).toMatchObject({ stopNumber: 2 });
  });

  test("T-3 a venue clock that is not the device's: every reader uses the stop's own offset", () => {
    // Same instant; a New York stop (UTC-5) at 19:00 local is 00:00Z.
    const ny = stop({ placeName: "NY bar", utcOffsetMinutes: -300, openingHours: { weekdayDescriptions: week(g("5:00 PM", "11:00 PM")) } });
    const at = new Date(Date.UTC(2026, 10, 14, 0, 0)); // Fri 19:00 New York
    expect(arrivalOpen(planTimeline([ny], at, null)[0].open)?.kind).toBe("open");
    expect(checkAllCuratedStopsOpen([ny], at, "en-US").allOpen).toBe(true);
    const atFour = new Date(Date.UTC(2026, 10, 14, 9, 0)); // Sat 04:00 New York
    expect(arrivalOpen(planTimeline([ny], atFour, null)[0].open)?.kind).toBe("closed");
    expect(checkAllCuratedStopsOpen([ny], atFour, "en-US").allOpen).toBe(false);
  });

  // P3 (pinned): MIN_USEFUL_MINUTES makes the sheet call a stop "closed" when
  // fewer than 15 minutes remain; the schedule check has no such window.
  test("T-4 (P3) a stop that closes 10 min after arrival: the schedule check and the sheet agree", () => {
    const closingSoon = [stop({ placeName: "Bakery", openingHours: { weekdayDescriptions: week(g("8:00 AM", "8:00 PM")) } })];
    const at = venue(13, 19, 50);
    const sheetSaysClosed = arrivalOpen(planTimeline(closingSoon, at, null)[0].open)?.kind === "closed";
    const scheduleSaysOpen = checkAllCuratedStopsOpen(closingSoon, at, "en-US").allOpen;
    expect(sheetSaysClosed && scheduleSaysOpen).toBe(false);
  });
});

// ── The ONE warning ─────────────────────────────────────────────────────────

function forecastFor(day: number, rainHours: number[], hoursCovered = 48): StopForecast {
  const hourly = Array.from({ length: hoursCovered }, (_, i) => {
    const d = day + Math.floor(i / 24);
    const h = i % 24;
    const rain = d === day && rainHours.includes(h);
    return {
      time: `2026-11-${d}T${String(h).padStart(2, "0")}:00`,
      temperature: 80,
      condition: rain ? "Rain" : "Clouds",
      icon: rain ? "10d" : "04d",
      precipitation: rain ? 0.2 : 0,
      precipitationProbability: rain ? 90 : 5,
    };
  });
  return { hourly, utcOffsetSeconds: OFF * 60 };
}

describe("W — the one warning", () => {
  test("W-1 rain at stop 1 AND a closed stop 3: one warning, and it is the closed one", () => {
    const stops = [
      stop({ placeName: "Park", placeType: "park", estimatedDurationMinutes: 60 }),
      stop({ placeName: "Cafe", estimatedDurationMinutes: 60 }),
      stop({ placeName: "Shop", openingHours: { weekdayDescriptions: week(g("9:00 AM", "5:00 PM")) } }),
    ];
    const start = venue(14, 15, 0); // Park 15:00 (rain), Shop 17:00 (closed)
    const w = planWarning({ stops, start, now: venue(14, 9, 0), forecasts: [forecastFor(14, [15]), null, null] });
    expect(w).toMatchObject({ kind: "closed", index: 2 });
  });

  test("W-2 the start fix is never before the next sensible slot, for any now / start", () => {
    const stops = [stop({ placeName: "Shop", openingHours: { weekdayDescriptions: week(g("9:00 AM", "5:00 PM")) } })];
    for (let nowH = 8; nowH <= 18; nowH += 1) {
      for (let startH = 10; startH <= 21; startH += 1) {
        const now = venue(14, nowH, 7);
        const w = planWarning({ stops, start: venue(14, startH, 0), now, forecasts: [null] });
        if (w?.fixStart) expect(w.fixStart.getTime()).toBeGreaterThanOrEqual(nextSensibleSlot(now).getTime());
      }
    }
  });

  test("W-3 no swap (host experience / optional stop) and no fix: no warning at all; rain fix never past the forecast", () => {
    const shut = [stop({ placeName: "Shut", openingHours: { weekdayDescriptions: week("Closed") } })];
    expect(planWarning({ stops: shut, start: venue(14, 12, 0), now: venue(14, 9, 0), forecasts: [null], canSwap: false })).toBeNull();
    const optional = [stop({ placeName: "Main" }), stop({ placeName: "Extra", optional: true, openingHours: { weekdayDescriptions: week("Closed") } })];
    expect(planWarning({ stops: optional, start: venue(14, 12, 0), now: venue(14, 9, 0), forecasts: [null, null] })).toBeNull();
    // Rain at the arrival hour, forecast ends 2 hours later, and every hour it covers is wet.
    const park = [stop({ placeName: "Park", placeType: "park" })];
    const short = forecastFor(14, Array.from({ length: 18 }, (_, h) => h), 18);
    const w = planWarning({ stops: park, start: venue(14, 14, 0), now: venue(14, 9, 0), forecasts: [short], canSwap: false });
    expect(w).toBeNull();
  });

  test("W-4 outdoor is a category, never a name; slug variants of a real category still count", () => {
    expect(isOutdoorStop({ placeType: "bar" } as PlanStop)).toBe(false);
    expect(isOutdoorStop({ placeType: "Rooftop Park Bar" } as PlanStop)).toBe(false);
    expect(isOutdoorStop({ placeType: "restaurant", comboCategory: "Beach Club" } as unknown as PlanStop)).toBe(false);
    expect(isOutdoorStop({ placeType: "City Park" } as PlanStop)).toBe(true);
    expect(isOutdoorStop({ placeType: "botanical-garden" } as PlanStop)).toBe(true);
    const named = [stop({ placeName: "Riverside Park Gardens Beach", placeType: "restaurant" })];
    expect(planWarning({ stops: named, start: venue(14, 15, 0), now: venue(14, 9, 0), forecasts: [forecastFor(14, [15])] })).toBeNull();
  });

  // P2 (pinned): the fix is searched for THIS stop only.
  test.failing("W-5 (P2) applying the offered 'Start at' fix never leaves the plan with a closed stop", () => {
    const stops = [
      stop({ placeName: "Gallery", openingHours: { weekdayDescriptions: week(g("6:00 PM", "11:00 PM")) }, estimatedDurationMinutes: 120 }),
      stop({ placeName: "Bakery", openingHours: { weekdayDescriptions: week(g("8:00 AM", "8:00 PM")) } }),
    ];
    const input = { stops, start: venue(14, 18, 0), now: venue(14, 12, 0), forecasts: [null, null] };
    const w = planWarning(input);
    expect(w).toMatchObject({ kind: "closed", index: 1 });
    expect(w!.fixStart).not.toBeNull(); // offered: 17:30
    expect(planWarning({ ...input, start: w!.fixStart! })).toBeNull(); // ...but at 17:30 the Gallery is closed
  });
});

// ── Route all stops ─────────────────────────────────────────────────────────

describe("R — Route all stops", () => {
  const parse = (url: string) => {
    const u = new URL(url);
    return { host: u.host, path: u.pathname, q: u.searchParams };
  };

  test("R-1 hostile names round-trip: & | # ? + % é and a newline cannot add or split parameters", () => {
    const names = ["Tom & Jerry's | Bar", "Café #1?", "A+B 100%", "Line\nBreak=yes&travelmode=walking"];
    const url = routeAllStopsUrl(names.map((label) => ({ label })), "walking") as string;
    const { host, path: p, q } = parse(url);
    expect(host).toBe("www.google.com");
    expect(p).toBe("/maps/dir/");
    expect(q.getAll("travelmode")).toEqual(["walking"]);
    expect(q.get("destination")).toBe(names[3]);
    expect(q.get("waypoints")!.split("|")).toEqual(["Tom & Jerry's ", " Bar", "Café #1?", "A+B 100%"]);
    // The pipe INSIDE a name is the one ambiguity left: Google splits waypoints on it.
    expect([...q.keys()].sort()).toEqual(["api", "destination", "travelmode", "waypoints"]);
  });

  test("R-2 twelve stops: the first 9 middle stops in order, the last stop is still the destination", () => {
    const stops = Array.from({ length: 12 }, (_, i) => ({ lat: 6 + i / 100, lng: 3 + i / 100 }));
    const { q } = parse(routeAllStopsUrl(stops, "driving") as string);
    const wp = q.get("waypoints")!.split("|");
    expect(wp).toHaveLength(GOOGLE_MAPS_MAX_WAYPOINTS);
    expect(wp[0]).toBe("6,3");
    expect(wp[8]).toBe(`${6 + 8 / 100},${3 + 8 / 100}`);
    expect(q.get("destination")).toBe(`${6 + 11 / 100},${3 + 11 / 100}`);
    expect(q.get("origin")).toBeNull(); // "from where I am", no location needed
  });

  test("R-3 (0,0) and non-finite coordinates fall back to the label; nothing placeable -> no URL, toast, no Linking", () => {
    const { q } = parse(routeAllStopsUrl([{ lat: 0, lng: 0, label: "Null Island Cafe" }, { lat: NaN, lng: 3, label: "Shop" }], "transit") as string);
    expect(q.get("waypoints")).toBe("Null Island Cafe");
    expect(q.get("destination")).toBe("Shop");
    const open = jest.spyOn(RN.Linking, "openURL").mockResolvedValue(true);
    const onUnavailable = jest.fn();
    openRouteAllStops([{ label: "  " }, { lat: null, lng: null }], { onUnavailable });
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  test("R-4 Linking rejecting the link surfaces the failure (no silent dead tap)", async () => {
    const open = jest.spyOn(RN.Linking, "openURL").mockRejectedValue(new Error("no handler"));
    const onUnavailable = jest.fn();
    openRouteAllStops([{ lat: 6.4, lng: 3.4 }, { lat: 6.5, lng: 3.5 }], { mode: "bicycling", onUnavailable });
    await Promise.resolve();
    await Promise.resolve();
    expect(open).toHaveBeenCalledWith(expect.stringContaining("travelmode=bicycling"));
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  test("R-5 no other file in app-mobile/src composes a google.com/maps/dir or apple maps URL", () => {
    const SRC = path.resolve(__dirname, "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__" && e.name !== "node_modules") walk(p);
        } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
          const s = fs.readFileSync(p, "utf8");
          if (/google\.com\/maps\/dir|maps\.apple\.com|comgooglemaps:\/\/|maps:\/\/\?/.test(s.replace(/^\s*(\/\/|\*).*$/gm, ""))) hits.push(path.relative(SRC, p));
        }
      }
    };
    walk(SRC);
    expect(hits).toEqual(["components/expandedCard/placeDirections.ts"]);
  });
});

// ── The navigator store ─────────────────────────────────────────────────────

describe("S — planScroll under a long scroll", () => {
  test("S-1 2,000 one-pixel frames over a 6-stop plan publish a bounded number of snapshots", () => {
    const store = new PlanScrollStore();
    store.setBodyY(300);
    store.setRouteBottom(400);
    store.setPlanY(900);
    store.setStopCount(6);
    [0, 320, 640, 960, 1280, 1600].forEach((y, i) => store.setStopY(i, y));
    let published = 0;
    const off = store.subscribe(() => {
      published += 1;
    });
    for (let y = 0; y < 2000; y += 1) store.onScroll(y);
    off();
    // 1 show + 5 stop changes + 5 lines x 10 fill steps = 56 at most.
    expect(published).toBeLessThanOrEqual(60);
    expect(store.getSnapshot().visible).toBe(true);
    // Back to the top hides it again.
    store.onScroll(0);
    expect(store.getSnapshot().visible).toBe(false);
  });
});

// ── On the night ────────────────────────────────────────────────────────────

describe("E — On the night", () => {
  const t = (key: string, o: Record<string, unknown> = {}) => `${key}${Object.keys(o).length ? JSON.stringify(o) : ""}`;
  test("E-1 leave-by = start - drive - 5 min, floored to 5 min, in the experience's zone, not the device's", () => {
    const at = new Date(Date.UTC(2026, 10, 14, 1, 0)); // 20:00 New York (UTC-5)
    const viewer = { lat: 40.7128, lng: -74.006 };
    const place = { lat: 40.758, lng: -73.9855 };
    const facts = onTheNightFacts({ at, now: new Date(Date.UTC(2026, 10, 13, 12)), forecast: null, timeZone: "America/New_York", viewer, place, language: "en", t });
    expect(facts).not.toBeNull();
    const m = /leave_by\{"time":"(\d{1,2}):(\d{2})pm"\}/.exec(facts!.footnote ?? "");
    expect(m).not.toBeNull();
    const leaveMin = (Number(m![1]) % 12 + 12) * 60 + Number(m![2]);
    const drive = Number(/"time":"(\d+) min"/.exec(facts!.travel ?? "")![1]);
    const exact = 20 * 60 - drive - LEAVE_BUFFER_MINUTES;
    expect(leaveMin % 5).toBe(0);
    expect(leaveMin).toBeLessThanOrEqual(exact);
    expect(exact - leaveMin).toBeLessThan(5);
  });
});
