/**
 * #4347 wave 3 — the expanded curated plan's decisions, run against the REAL
 * producers (implementor happy path + the spec's curated state table):
 *
 *   one arrival model (curatedArrivalTimes) for the sheet, the schedule check
 *   and the deck chip; start time changed; stop closed at arrival; rain on an
 *   outdoor stop (and none on an indoor one); forecast unavailable; optional /
 *   shop numbering; no location; Route all stops; the outdoor map; the route
 *   draw budget; the sticky navigator store; the experience's On the night.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT (each verified by removing the fix): the arrival model
 * losing the dwell (M-1), the closed warning losing its priority (W-2), the
 * outdoor map ignoring the slot's comboCategory (W-4), the rain fix accepting a
 * start the forecast does not reach (W-5), iPhone given the waypoints link
 * (R-2), the route stagger not shrinking for long plans (X-1), the navigator
 * pinning before the route has scrolled away (N-1), the leave-by note (E-1).
 */
jest.mock("../../../utils/openMapsTarget", () => ({ openMapsTarget: jest.fn() }));
import {
  arrivalOpen,
  countedStops,
  defaultPlanStart,
  isOutdoorStop,
  legFromViewer,
  nextSensibleSlot,
  nextStopIndex,
  planGalleryMedia,
  planTimeline,
  planWarning,
  rainLikely,
  startTimeOptions,
  stopCrowdAt,
  stopOrdinals,
  stopSunset,
  totalTravelMinutes,
  type PlanStop,
  type StopForecast,
} from "../curatedPlanModel";
import { checkAllCuratedStopsOpen, curatedArrivalTimes } from "../../../utils/curatedStopsAvailability";
import { curatedSmartChip } from "../../deckCard/deckCardModel";
import { GOOGLE_MAPS_MAX_WAYPOINTS, routeAllStopsAction, routeAllStopsUrl } from "../placeDirections";
import { PLAN_MOTION, routeDrawTotalMs, routeStaggerMs } from "../motionTokens";
import { PlanScrollStore, NAVIGATOR_HEIGHT } from "../planScroll";
import { onTheNightFacts } from "../../../screens/Experience/onTheNight";

const OFFSET = 60; // Lagos, UTC+1
const week = (line: string): string[] =>
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => `${d}: ${line}`);
const OPEN_ALL_DAY = week("8:00 AM – 11:00 PM");

function stop(over: Partial<PlanStop> & { placeName: string }): PlanStop {
  return {
    placeId: over.placeName.toLowerCase().replace(/\s+/g, "-"),
    placeType: "casual_eats",
    address: `${over.placeName} street`,
    imageUrl: `https://cdn/${over.placeName}.jpg`,
    lat: 6.45,
    lng: 3.43,
    openingHours: { weekdayDescriptions: OPEN_ALL_DAY },
    estimatedDurationMinutes: 45,
    travelTimeFromPreviousStopMin: null,
    travelModeFromPreviousStop: "driving",
    utcOffsetMinutes: OFFSET,
    ...over,
  } as PlanStop;
}

// Sat 15 Nov 2026, 14:00 Lagos = 13:00Z.
const START = new Date("2026-11-14T13:00:00Z");
const NOW = new Date("2026-11-14T12:00:00Z");
const PLAN: PlanStop[] = [
  stop({ placeName: "Cafe Neo", estimatedDurationMinutes: 45 }),
  stop({ placeName: "Nike Art", estimatedDurationMinutes: 90, travelTimeFromPreviousStopMin: 6 }),
  stop({ placeName: "Freedom Park", placeType: "park", comboCategory: "nature", estimatedDurationMinutes: 60, travelTimeFromPreviousStopMin: 15 }),
];

/** An hourly forecast for 14 Nov (Lagos local), rain from 16:00 to 17:59. */
function forecast(rainHours: number[] = [16, 17]): StopForecast {
  const hourly = Array.from({ length: 48 }, (_, i) => {
    const day = 14 + Math.floor(i / 24);
    const h = i % 24;
    const rain = day === 14 && rainHours.includes(h);
    return {
      time: `2026-11-${day}T${String(h).padStart(2, "0")}:00`,
      temperature: 86,
      condition: rain ? "Rain" : "Clouds",
      icon: rain ? "10d" : "04d",
      precipitation: rain ? 0.1 : 0,
      precipitationProbability: rain ? 80 : 10,
    };
  });
  return { hourly, utcOffsetSeconds: OFFSET * 60 };
}

describe("M — one arrival model", () => {
  test("M-1 the sheet, the schedule check and the deck chip read the same arrivals", () => {
    const tl = planTimeline(PLAN, START);
    const raw = curatedArrivalTimes(PLAN, START);
    expect(tl.map((s) => s.arrival.toISOString())).toEqual(raw.map((s) => s.arrival.toISOString()));
    // 14:00, 14:45 + 6 = 14:51, 14:51 + 90 + 15 = 16:36 (Lagos)
    expect(tl.map((s) => s.arrival.toISOString())).toEqual([
      "2026-11-14T13:00:00.000Z",
      "2026-11-14T13:51:00.000Z",
      "2026-11-14T15:36:00.000Z",
    ]);
    // The schedule check flags exactly the stop the sheet calls closed.
    const late = PLAN.map((s, i) => (i === 1 ? { ...s, openingHours: { weekdayDescriptions: week("10:00 AM – 2:30 PM") } } : s));
    expect(checkAllCuratedStopsOpen(late, START).results.map((r) => r.status)).toEqual(["open", "closed", "open"]);
    expect(arrivalOpen(planTimeline(late, START)[1].open)?.kind).toBe("closed");
    // The deck chip, started "now" at the same instant, names the same stop.
    expect(curatedSmartChip(late, START)).toEqual({ kind: "stopClosedAtArrival", stopNumber: 2, tone: "warn" });
  });

  test("M-2 start time changed: every arrival moves by the same amount, the plan end too", () => {
    const a = planTimeline(PLAN, START);
    const b = planTimeline(PLAN, new Date(START.getTime() + 60 * 60_000));
    a.forEach((s, i) => expect(b[i].arrival.getTime() - s.arrival.getTime()).toBe(3_600_000));
  });

  test("M-3 the default start: the schedule time when scheduled, else the next half hour 15+ min ahead", () => {
    const scheduled = new Date("2026-11-20T18:00:00Z");
    expect(defaultPlanStart(NOW, scheduled)).toBe(scheduled);
    expect(nextSensibleSlot(new Date("2026-11-14T12:20:00Z")).toISOString()).toBe("2026-11-14T13:00:00.000Z");
    expect(nextSensibleSlot(new Date("2026-11-14T12:10:00Z")).toISOString()).toBe("2026-11-14T12:30:00.000Z");
    const opts = startTimeOptions(NOW, scheduled);
    expect(opts.some((d) => d.getTime() === scheduled.getTime())).toBe(true);
    expect(opts.every((d, i) => i === 0 || d.getTime() > opts[i - 1].getTime())).toBe(true);
  });
});

describe("W — the ONE warning", () => {
  test("W-1 no warning when nothing needs action", () => {
    expect(planWarning({ stops: PLAN, start: START, now: NOW, forecasts: PLAN.map(() => forecast([])) })).toBeNull();
  });

  test("W-2 closed at arrival outranks rain, and carries both fixes", () => {
    const late = PLAN.map((s, i) => (i === 1 ? { ...s, openingHours: { weekdayDescriptions: week("10:00 AM – 2:30 PM") } } : s));
    const early = new Date("2026-11-14T11:00:00Z"); // noon Lagos: an earlier start is still ahead
    const w = planWarning({ stops: late, start: START, now: early, forecasts: late.map(() => forecast()) });
    expect(w?.kind).toBe("closed");
    expect(w?.index).toBe(1);
    expect(w?.canSwap).toBe(true);
    // Start earlier so stop 2 is reached before 2:30pm — never before "now".
    expect(w?.fixStart).not.toBeNull();
    const fixed = planTimeline(late, w!.fixStart!);
    expect(arrivalOpen(fixed[1].open)?.kind).not.toBe("closed");
    expect(w!.fixStart!.getTime()).toBeLessThan(START.getTime());
    expect(w!.fixStart!.getTime()).toBeGreaterThanOrEqual(nextSensibleSlot(early).getTime());
    // From NOW (1pm Lagos) no earlier start is still ahead: the swap alone remains.
    const tooLate = planWarning({ stops: late, start: START, now: NOW, forecasts: late.map(() => forecast()) });
    expect(tooLate?.kind).toBe("closed");
    expect(tooLate?.fixStart === null || tooLate!.fixStart!.getTime() > START.getTime()).toBe(true);
  });

  test("W-3 rain on an OUTDOOR stop warns with a later start; rain on an indoor stop does not", () => {
    const w = planWarning({ stops: PLAN, start: START, now: NOW, forecasts: PLAN.map(() => forecast()) });
    expect(w?.kind).toBe("rain");
    expect(w?.index).toBe(2);
    const at = planTimeline(PLAN, w!.fixStart!)[2].arrival;
    expect(rainLikely(forecast().hourly.find((h) => h.time.startsWith(`2026-11-14T${String((at.getUTCHours() + 1) % 24).padStart(2, "0")}`)) ?? null)).toBe(false);
    const indoor = PLAN.map((s, i) => (i === 2 ? { ...s, placeType: "drink", comboCategory: "drink" } : s));
    expect(planWarning({ stops: indoor, start: START, now: NOW, forecasts: indoor.map(() => forecast()) })).toBeNull();
  });

  test("W-4 outdoor-ness is an explicit category map, never the name", () => {
    expect(isOutdoorStop({ placeType: "park" })).toBe(true);
    expect(isOutdoorStop({ placeType: "casual_eats", comboCategory: "picnic_park" })).toBe(true);
    expect(isOutdoorStop({ placeType: "drink" })).toBe(false);
    // A rooftop bar is NOT guessed from its name.
    expect(isOutdoorStop({ placeType: "bar", comboCategory: "drink", placeName: "Sky Rooftop" } as never)).toBe(false);
  });

  test("W-5 forecast unavailable: no rain warning, and the rain fix never lands beyond the forecast", () => {
    expect(planWarning({ stops: PLAN, start: START, now: NOW, forecasts: [null, null, null] })).toBeNull();
    // Rain every forecast hour: there is no dry start to offer, so the warning
    // keeps only the swap.
    const allRain = forecast(Array.from({ length: 24 }, (_, h) => h));
    const w = planWarning({ stops: PLAN, start: START, now: NOW, forecasts: PLAN.map(() => allRain) });
    expect(w?.kind).toBe("rain");
    expect(w?.fixStart).toBeNull();
    expect(w?.canSwap).toBe(true);
    // A forecast that ENDS at the rain: a later start would land past it, and
    // "no forecast" is not "dry" — no Start-at fix is offered.
    const short = { ...allRain, hourly: allRain.hourly.filter((h) => h.time < "2026-11-14T18") };
    const w2 = planWarning({ stops: PLAN, start: START, now: NOW, forecasts: PLAN.map(() => short) });
    expect(w2?.kind).toBe("rain");
    expect(w2?.fixStart).toBeNull();
  });

  test("W-6 a host experience (no swap) with no possible fix shows no warning", () => {
    const allRain = forecast(Array.from({ length: 24 }, (_, h) => h));
    expect(planWarning({ stops: PLAN, start: START, now: NOW, forecasts: PLAN.map(() => allRain), canSwap: false })).toBeNull();
  });
});

describe("S — stops, conditions, getting there", () => {
  test("S-1 optional and shop stops: optional carries no number, the count is the main stops", () => {
    const stops = [{}, { optional: true }, {}];
    expect(stopOrdinals(stops)).toEqual([1, null, 2]);
    expect(countedStops(stops)).toBe(2);
  });

  test("S-2 the gallery runs in stop order and every photo knows its stop", () => {
    const stops = [
      stop({ placeName: "A", imageUrls: ["https://cdn/A2.jpg", "https://cdn/A.jpg"] }),
      stop({ placeName: "B", imageUrls: ["https://cdn/v.mp4"] }),
    ];
    expect(planGalleryMedia(stops).map((m) => [m.uri, m.stopIndex])).toEqual([
      ["https://cdn/A.jpg", 0],
      ["https://cdn/A2.jpg", 0],
      ["https://cdn/B.jpg", 1],
    ]);
  });

  test("S-3 no location: no 'You -> stop 1' leg, and the total is the legs between stops", () => {
    const tl = planTimeline(PLAN, START);
    expect(legFromViewer(null, PLAN[0], "driving")).toBeNull();
    expect(totalTravelMinutes(tl, null)).toBe(21);
    const you = legFromViewer({ lat: 6.5, lng: 3.4 }, PLAN[0], "driving");
    expect(typeof you).toBe("number");
    expect(totalTravelMinutes(tl, you)).toBe(21 + (you as number));
  });

  test("S-4 crowd is the typical curve at the arrival hour; sunset only near it at an outdoor stop", () => {
    expect(["quiet", "steady", "busy", "packed"]).toContain(stopCrowdAt(PLAN[0], START));
    const park = PLAN[2];
    // Lagos sunset in mid-November is ~18:30 local (17:30Z).
    expect(stopSunset(park, new Date("2026-11-14T16:30:00Z"))).not.toBeNull();
    expect(stopSunset(park, new Date("2026-11-14T10:00:00Z"))).toBeNull();
    expect(stopSunset(PLAN[0], new Date("2026-11-14T16:30:00Z"))).toBeNull();
  });

  test("S-5 the next stop is the first one you have not left yet", () => {
    const tl = planTimeline(PLAN, START);
    expect(nextStopIndex(tl, NOW)).toBe(0);
    expect(nextStopIndex(tl, new Date("2026-11-14T14:00:00Z"))).toBe(1);
  });
});

describe("R — Route all stops", () => {
  test("R-1 one Google Maps link: every stop in order, by coordinates, the last as the destination", () => {
    const url = routeAllStopsUrl(
      [
        { lat: 6.1, lng: 3.1, label: "A" },
        { lat: 6.2, lng: 3.2, label: "B" },
        { lat: null, lng: null, label: "C street" },
      ],
      "walking",
    );
    expect(url).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=C%20street&waypoints=6.1%2C3.1%7C6.2%2C3.2&travelmode=walking",
    );
    expect(routeAllStopsUrl([])).toBeNull();
  });

  test("R-2 every platform, iPhone included, gets the full route as one https universal link", () => {
    // #4347 wave 3 follow-up: no platform branch any more. The https link opens
    // the Google Maps app on iPhone when installed, else the browser.
    const stops = [{ lat: 6.1, lng: 3.1 }, { lat: 6.2, lng: 3.2 }, { lat: 6.3, lng: 3.3, label: "Café & Bar" }];
    expect(routeAllStopsAction(stops, "transit")).toEqual({
      kind: "route",
      url: "https://www.google.com/maps/dir/?api=1&destination=6.3%2C3.3&waypoints=6.1%2C3.1%7C6.2%2C3.2&travelmode=transit",
    });
    expect(routeAllStopsAction([])).toBeNull();
  });

  test("R-3 openRouteAllStops opens the route link on iOS (not the next stop)", () => {
    const RN = require("react-native");
    const original = RN.Platform.OS;
    const openURL = jest.spyOn(RN.Linking, "openURL").mockResolvedValue(true);
    try {
      RN.Platform.OS = "ios";
      const { openRouteAllStops } = require("../placeDirections");
      openRouteAllStops([{ lat: 6.1, lng: 3.1 }, { lat: 6.2, lng: 3.2 }], { mode: "walking" });
      expect(openURL).toHaveBeenCalledTimes(1);
      expect(openURL).toHaveBeenCalledWith(
        "https://www.google.com/maps/dir/?api=1&destination=6.2%2C3.2&waypoints=6.1%2C3.1&travelmode=walking",
      );
    } finally {
      RN.Platform.OS = original;
      openURL.mockRestore();
    }
  });

  test("R-4 a long plan is cut to Google's 9 waypoints, keeping the order and the last stop", () => {
    const stops = Array.from({ length: 12 }, (_, i) => ({ label: `Stop ${i + 1}` }));
    const query = new URLSearchParams((routeAllStopsUrl(stops, "driving") as string).split("?")[1]);
    expect(GOOGLE_MAPS_MAX_WAYPOINTS).toBe(9);
    expect(query.get("destination")).toBe("Stop 12");
    expect(query.get("waypoints")?.split("|")).toEqual(Array.from({ length: 9 }, (_, i) => `Stop ${i + 1}`));
  });

  test("R-5 names with reserved characters are URL-encoded and cannot split the link", () => {
    const url = routeAllStopsUrl([{ label: "Tom & Jerry's | Bar" }, { label: "Café #2?" }]) as string;
    expect(url.split("?")).toHaveLength(2);
    expect(url).not.toMatch(/[ #|]/);
    const query = new URLSearchParams(url.split("?")[1]);
    expect(query.get("waypoints")).toBe("Tom & Jerry's | Bar");
    expect(query.get("destination")).toBe("Café #2?");
    expect([...query.keys()]).toEqual(["api", "destination", "waypoints", "travelmode"]);
  });
});

describe("X — motion budget and the navigator", () => {
  test("X-1 the route draw finishes under 1.2s for any plan length", () => {
    expect(routeStaggerMs(4)).toBe(PLAN_MOTION.routeStaggerMs);
    for (let n = 1; n <= 10; n += 1) expect(routeDrawTotalMs(n)).toBeLessThanOrEqual(PLAN_MOTION.routeBudgetMs);
  });

  test("N-1 the navigator pins only once the route has scrolled away, highlights the stop in view and fills the line", () => {
    const store = new PlanScrollStore();
    store.setBodyY(0);
    store.setRouteBottom(500);
    store.setPlanY(700);
    store.setStopCount(3);
    [0, 400, 800].forEach((y, i) => store.setStopY(i, y));
    store.onScroll(400);
    expect(store.getSnapshot().visible).toBe(false);
    store.onScroll(495);
    expect(store.getSnapshot().visible).toBe(true);
    store.onScroll(700 + 400 - NAVIGATOR_HEIGHT - 90);
    expect(store.getSnapshot().active).toBe(1);
    expect(store.getSnapshot().fills[0]).toBe(1);
    expect(store.jumpTarget(2)).toBe(700 + 800 - NAVIGATOR_HEIGHT - 8);
    store.pulse(2);
    expect(store.getSnapshot().pulse).toEqual({ index: 2, seq: 1 });
  });
});

describe("E — the experience page's On the night", () => {
  const t = (key: string, o: Record<string, unknown> = {}) => `${key}${Object.keys(o).length ? JSON.stringify(o) : ""}`;
  const weather = {
    temperature: 80, condition: "Clouds", icon: "04d", description: "", feelsLike: 80, humidity: 0, windSpeed: 0, recommendation: "",
    hourlyForecast: forecast().hourly, utcOffsetSeconds: OFFSET * 60,
  };

  test("E-1 at the experience time: the forecast at that hour, the drive, and a leave-by time", () => {
    const at = new Date("2026-11-14T17:00:00Z"); // 6pm Lagos
    const facts = onTheNightFacts({ at, now: NOW, forecast: weather, timeZone: "Africa/Lagos", viewer: { lat: 6.6, lng: 3.35 }, place: { lat: 6.45, lng: 3.43 }, language: "en", t });
    expect(facts?.title).toBe("cards:exp.on_the_night");
    expect(facts?.weatherLabel).toContain('"time":"6pm"');
    expect(facts?.weather).toMatch(/86°/);
    expect(facts?.footnote).toMatch(/cards:exp\.leave_by\{"time":"5:\d\dpm"\}/);
    expect(facts?.estimated).toBe(true);
  });

  test("E-2 forecast not reaching the time hides weather; no viewer hides travel; nothing at all is null", () => {
    const far = new Date("2026-11-30T17:00:00Z");
    const facts = onTheNightFacts({ at: far, now: NOW, forecast: weather, timeZone: "Africa/Lagos", viewer: null, place: { lat: 6.45, lng: 3.43 }, language: "en", t });
    expect(facts).toBeNull();
    const noViewer = onTheNightFacts({ at: new Date("2026-11-14T17:00:00Z"), now: NOW, forecast: weather, timeZone: "Africa/Lagos", viewer: null, place: null, language: "en", t });
    expect(noViewer?.travel).toBeNull();
    expect(noViewer?.weather).toMatch(/°/);
  });
});
