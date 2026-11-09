/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 3 REWORK after the tester's retest (FAIL: 1 P1, 2 P2, 6 P3).
 * Implementor happy path; the tester's own pins (L-1, N-1, T-4) are flipped in
 * issue_4347_wave3.tester.adversarial*.
 *
 *   RW-1 (P2-a) "Route all stops" on both platforms; no "Next stop" key left.
 *   RW-2 (P2-b) a "Start at" / rain fix is offered only when it leaves the WHOLE
 *        plan clear; none → Swap only.
 *   RW-3 (P3) the plan body subscribes to the pulse only.
 *   RW-4 (P3) one 15-minute "worth arriving" rule for the sheet and the
 *        schedule check.
 *   RW-5 (P3) the plan's choices reset on card identity, not on a GPS refetch
 *        or a collab mode change.
 *   RW-6 (P3) a plan longer than the route link says so ("Opens 10 of N stops").
 *   RW-7 (P3) i18n: website / close / route_capped / leave_now in every locale.
 *   RW-8 (P3) "On the night": no crowd sentence; a past leave-by reads "Leave now".
 *   RW-9 (P3) the venue experiences price is the 5.18:1 link token.
 *   RW-10 (P4) a count continues from the number on screen.
 *   RW-11 (P1) nothing in the app still names the deleted modules.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs. Each block fails when its
 * fix is deleted (see the issue's rework comment).
 */
import fs from "fs";
import path from "path";
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

jest.mock("../../../utils/openMapsTarget", () => ({ openMapsTarget: jest.fn() }));
jest.mock("react-native-reanimated", () => {
  const R = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  const chain = { duration: () => chain };
  return {
    __esModule: true,
    default: { View: R.forwardRef((p: Record<string, unknown>, _r: unknown) => R.createElement(View, p)) },
    useSharedValue: (v: unknown) => R.useRef({ value: v }).current,
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    withTiming: (v: unknown) => v,
    withDelay: (_d: number, v: unknown) => v,
    withSequence: (...v: unknown[]) => v[0],
    Easing: { bezier: () => (x: number) => x },
    FadeOut: chain,
    FadeIn: chain,
    LinearTransition: chain,
    useReducedMotion: () => false,
  };
});

const { checkAllCuratedStopsOpen, MIN_USEFUL_OPEN_MINUTES } = require("../../../utils/curatedStopsAvailability");
const { MIN_USEFUL_MINUTES, arrivalOpen, planTimeline, planWarning } = require("../curatedPlanModel");
const { PlanScrollStore, usePlanPulse, useResetOnPlanIdentity } = require("../planScroll");
const { ROUTE_MAX_STOPS, planRouteTargets, routeCap } = require("../placeDirections");
const { PlanGettingThere } = require("../PlanSections");
const { useCountTo } = require("../planMotion");
const { onTheNightFacts } = require("../../../screens/Experience/onTheNight");
const { SPINE } = require("../spineTokens");

const SRC = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const week = (hours: string) => DAYS.map((d) => `${d}: ${hours}`);
const OFF = 60; // Lagos
const venue = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, day, h, m) - OFF * 60_000);
const stop = (over: Record<string, unknown>) => ({
  placeId: String(over.placeName),
  placeName: "Stop",
  placeType: "restaurant",
  address: "",
  lat: 6.45,
  lng: 3.4,
  estimatedDurationMinutes: 60,
  travelTimeFromPreviousStopMin: null,
  utcOffsetMinutes: OFF,
  ...over,
});

describe("RW-1 Route all stops is labelled the same on every platform", () => {
  test("no Platform branch on the route label, and no 'Next stop' key in any locale", () => {
    const modal = stripComments(read("components/ExpandedCardModal.tsx"));
    const body = stripComments(read("components/expandedCard/CuratedPlanBody.tsx"));
    expect(modal).not.toMatch(/route_next/);
    expect(body).not.toMatch(/route_next/);
    expect(body).toMatch(/routeLabel=\{t\('cards:plan\.route_all'\)\}/);
    expect(modal).toMatch(/accessibilityLabel=\{t\('cards:plan\.route_all'\)\}/);
    for (const loc of fs.readdirSync(path.join(SRC, "i18n/locales"))) {
      expect(Object.keys(JSON.parse(read(`i18n/locales/${loc}/cards.json`)))).not.toContain("plan.route_next");
    }
  });
});

describe("RW-2 a fix is offered only when it leaves the whole plan clear", () => {
  const gallery = stop({ placeName: "Gallery", openingHours: { weekdayDescriptions: week("6:00 PM – 11:00 PM") }, estimatedDurationMinutes: 120 });
  const bakery = stop({ placeName: "Bakery", openingHours: { weekdayDescriptions: week("8:00 AM – 8:00 PM") } });

  test("no start clears both stops: no 'Start at' fix, Swap only", () => {
    const input = { stops: [gallery, bakery], start: venue(14, 18), now: venue(14, 12), forecasts: [null, null] };
    expect(planWarning(input)).toMatchObject({ kind: "closed", index: 1, fixStart: null, canSwap: true });
  });

  test("a start that clears every stop is still offered, and applying it clears the plan", () => {
    const lunch = stop({ placeName: "Lunch", openingHours: { weekdayDescriptions: week("11:00 AM – 11:00 PM") } });
    const shop = stop({ placeName: "Shop", openingHours: { weekdayDescriptions: week("9:00 AM – 6:00 PM") } });
    const input = { stops: [lunch, shop], start: venue(14, 17, 30), now: venue(14, 9), forecasts: [null, null] };
    const w = planWarning(input);
    expect(w).toMatchObject({ kind: "closed", index: 1 });
    expect(w.fixStart).not.toBeNull();
    expect(planWarning({ ...input, start: w.fixStart })).toBeNull();
  });

  test("the rain fix is refused when the drier start closes another stop", () => {
    const park = stop({ placeName: "Park", placeType: "park", estimatedDurationMinutes: 60 });
    const late = stop({ placeName: "Late", openingHours: { weekdayDescriptions: week("4:00 PM – 6:00 PM") } });
    // Rain at the park at 15:00 and 15:30; dry at 14:00 — but 14:00 puts "Late" at 15:00, before it opens.
    const hourly = Array.from({ length: 48 }, (_, i) => ({
      time: `2026-11-${14 + Math.floor(i / 24)}T${String(i % 24).padStart(2, "0")}:00`,
      temperature: 80,
      condition: "Rain",
      icon: [15].includes(i) ? "10d" : "04d",
      precipitation: 0,
      precipitationProbability: i === 15 ? 90 : 5,
    }));
    const input = { stops: [park, late], start: venue(14, 15), now: venue(14, 9), forecasts: [{ hourly, utcOffsetSeconds: OFF * 60 }, null] };
    const w = planWarning(input);
    expect(w).toMatchObject({ kind: "rain", index: 0 });
    if (w.fixStart) expect(planWarning({ ...input, start: w.fixStart })).toBeNull();
    // 14:30 would be dry at the park (14:00 hour) but "Late" at 15:30 is closed: never offered.
    expect(w.fixStart?.getTime()).not.toBe(venue(14, 14, 30).getTime());
  });
});

describe("RW-3 the plan body subscribes to the pulse only", () => {
  test("a scroll that changes the navigator never re-renders a pulse reader; a jump does", () => {
    const store = new PlanScrollStore();
    let renders = 0;
    const Probe = () => {
      renders += 1;
      usePlanPulse(store);
      return null;
    };
    TestRenderer.act(() => {
      TestRenderer.create(<Probe />);
    });
    TestRenderer.act(() => {
      store.setBodyY(0);
      store.setRouteBottom(500);
      store.setPlanY(700);
      store.setStopCount(3);
      [0, 400, 800].forEach((y: number, i: number) => store.setStopY(i, y));
    });
    const before = renders;
    for (let y = 0; y < 1600; y += 8) TestRenderer.act(() => store.onScroll(y));
    expect(renders).toBe(before);
    TestRenderer.act(() => store.pulse(2));
    expect(renders).toBe(before + 1);
    expect(stripComments(read("components/expandedCard/CuratedPlanBody.tsx"))).not.toMatch(/usePlanScroll\(/);
  });
});

describe("RW-4 one 15-minute rule", () => {
  const bakery = [stop({ placeName: "Bakery", openingHours: { weekdayDescriptions: week("8:00 AM – 8:00 PM") } })];

  test("the sheet and the schedule check share the constant and agree around the window", () => {
    expect(MIN_USEFUL_MINUTES).toBe(MIN_USEFUL_OPEN_MINUTES);
    for (const [h, m, open] of [[19, 50, false], [19, 46, false], [19, 45, true], [19, 0, true]] as const) {
      const at = venue(13, h, m);
      const sheetClosed = arrivalOpen(planTimeline(bakery, at, null)[0].open)?.kind === "closed";
      const check = checkAllCuratedStopsOpen(bakery, at, "en-US");
      expect({ at: `${h}:${m}`, sheetClosed, allOpen: check.allOpen }).toEqual({ at: `${h}:${m}`, sheetClosed: !open, allOpen: open });
    }
    expect(checkAllCuratedStopsOpen(bakery, venue(13, 19, 50), "en-US").results[0].reason).toMatch(/Closes within 15 min/);
  });
});

describe("RW-5 the plan's choices reset on card identity only", () => {
  test("same card with a new location / mode: no reset; another card, or closing: reset", () => {
    const reset = jest.fn();
    const Harness = ({ visible, id, lat, mode }: { visible: boolean; id: string; lat: number; mode: string }) => {
      useResetOnPlanIdentity(visible, id, () => reset(lat, mode));
      return null;
    };
    let root: { update: (el: React.ReactElement) => void } | undefined;
    TestRenderer.act(() => {
      root = TestRenderer.create(<Harness visible id="a" lat={1} mode="driving" />);
    });
    expect(reset).toHaveBeenCalledTimes(1);
    TestRenderer.act(() => root!.update(<Harness visible id="a" lat={2} mode="driving" />)); // GPS refetch
    TestRenderer.act(() => root!.update(<Harness visible id="a" lat={2} mode="walking" />)); // collab mode
    expect(reset).toHaveBeenCalledTimes(1);
    TestRenderer.act(() => root!.update(<Harness visible id="b" lat={2} mode="walking" />));
    expect(reset).toHaveBeenCalledTimes(2);
    TestRenderer.act(() => root!.update(<Harness visible={false} id="b" lat={2} mode="walking" />));
    expect(reset).toHaveBeenCalledTimes(3);
  });

  test("the modal resets through the identity hook, not inside the location/mode effect", () => {
    const modal = stripComments(read("components/ExpandedCardModal.tsx"));
    expect(modal).toMatch(/useResetOnPlanIdentity\(visible, card\?\.id \?\? null, \(\) => \{[\s\S]*?setPlanStartOverride\(null\);/);
    const effectEnd = modal.indexOf("}, [visible, card, viewerLoc?.lat, viewerLoc?.lng, effectiveTravelMode]);");
    const effectStart = modal.lastIndexOf("useEffect(() => {", effectEnd);
    expect(effectStart).toBeGreaterThan(-1);
    expect(modal.slice(effectStart, effectEnd)).not.toMatch(/setPlanStartOverride|clearAlternatives|planScroll\.reset/);
  });
});

describe("RW-6 a long plan says the route link is capped", () => {
  const stops = (n: number) => Array.from({ length: n }, (_, i) => ({ placeName: `Stop ${i + 1}`, lat: 6 + i / 100, lng: 3 }));

  test("routeCap counts every listed stop (optional and shop included) and is null when they fit", () => {
    expect(ROUTE_MAX_STOPS).toBe(10);
    expect(routeCap(planRouteTargets(stops(10)))).toBeNull();
    expect(routeCap(planRouteTargets(stops(12)))).toEqual({ opened: 10, total: 12 });
    const withOptional = [...stops(10), { placeName: "Optional shop", lat: 7, lng: 3, optional: true }];
    expect(routeCap(planRouteTargets(withOptional))).toEqual({ opened: 10, total: 11 });
  });

  test("Getting there shows the note only when the cap applies", () => {
    const render = (note: string | null) => {
      let root: { root: { findAll: (p: (n: { props: Record<string, unknown> }) => boolean) => Array<{ props: Record<string, unknown> }> } } | undefined;
      TestRenderer.act(() => {
        root = TestRenderer.create(<PlanGettingThere title="Getting there" rows={[]} routeLabel="Route all stops" routeNote={note} onRoute={() => undefined} />);
      });
      return root!.root.findAll((n) => n.props.testID === "plan-route-note");
    };
    expect(render(null)).toHaveLength(0);
    const shown = render("Opens 10 of 12 stops");
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[0].props.children).toBe("Opens 10 of 12 stops");
    const en = JSON.parse(read("i18n/locales/en/cards.json"));
    expect(en["plan.route_capped"].replace("{{count}}", "12")).toBe("Opens 10 of 12 stops");
  });
});

describe("RW-7 every locale carries the keys the sheets read", () => {
  test("website, close, route_capped and leave_now in all 29; no start_crowd", () => {
    const locales = fs.readdirSync(path.join(SRC, "i18n/locales"));
    expect(locales).toHaveLength(29);
    for (const loc of locales) {
      const details = JSON.parse(read(`i18n/locales/${loc}/expanded_details.json`));
      const common = JSON.parse(read(`i18n/locales/${loc}/common.json`));
      const cards = JSON.parse(read(`i18n/locales/${loc}/cards.json`));
      expect({ loc, website: typeof details.action_buttons?.website }).toEqual({ loc, website: "string" });
      expect({ loc, close: typeof common.close }).toEqual({ loc, close: "string" });
      expect({ loc, capped: cards["plan.route_capped"]?.includes("{{count}}") }).toEqual({ loc, capped: true });
      expect({ loc, leaveNow: typeof cards["exp.leave_now"] }).toEqual({ loc, leaveNow: "string" });
      expect(Object.keys(cards)).not.toContain("exp.start_crowd");
    }
  });
});

describe("RW-8 On the night", () => {
  const t = (key: string, o: Record<string, unknown> = {}) => `${key}${Object.keys(o).length ? JSON.stringify(o) : ""}`;
  const viewer = { lat: 6.6, lng: 3.35 };
  const place = { lat: 6.45, lng: 3.43 };
  const at = new Date("2026-11-14T17:00:00Z"); // 6pm Lagos

  test("a leave-by still ahead names the time; one already past says Leave now", () => {
    const early = onTheNightFacts({ at, now: new Date("2026-11-14T12:00:00Z"), forecast: null, timeZone: "Africa/Lagos", viewer, place, language: "en", t });
    expect(early.footnote).toMatch(/cards:exp\.leave_by\{"time":"5:\d\dpm"\}/);
    const late = onTheNightFacts({ at, now: new Date("2026-11-14T16:55:00Z"), forecast: null, timeZone: "Africa/Lagos", viewer, place, language: "en", t });
    expect(late.footnote).toMatch(/^cards:exp\.leave_now /);
    expect(late.footnote).not.toMatch(/leave_by/);
  });

  test("the note is about the drive only, and absent without a drive", () => {
    expect(JSON.parse(read("i18n/locales/en/cards.json"))["exp.note"]).toBe("Drive time is an estimate.");
    const src = stripComments(read("screens/Experience/onTheNight.ts"));
    expect(src).not.toMatch(/start_crowd|[Cc]rowd/);
  });
});

describe("RW-9 the venue experiences price is legible", () => {
  test("price text and its icon use the link accent (5.18:1), not #ea580c (3.56:1)", () => {
    const src = stripComments(read("components/expandedCard/VenueExperiencesSection.tsx"));
    expect(src).not.toMatch(/#ea580c/i);
    expect(src).toMatch(/rowPrice: \{[\s\S]*?color: SPINE\.link/);
    expect(SPINE.link).toBe("#C2410C");
  });
});

describe("RW-10 a count continues from the number on screen", () => {
  test("a second change mid-count starts from the shown value, not the old target", () => {
    const frames: Array<() => void> = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const savedRaf = g.requestAnimationFrame;
    const savedCaf = g.cancelAnimationFrame;
    const savedNow = Date.now;
    let clock = 0;
    Date.now = () => clock;
    g.requestAnimationFrame = (cb: () => void) => frames.push(cb);
    g.cancelAnimationFrame = () => undefined;
    try {
      const seen: number[] = [];
      const Probe = ({ value }: { value: number }) => {
        seen.push(useCountTo(value, false, 100));
        return null;
      };
      let root: { update: (el: React.ReactElement) => void } | undefined;
      TestRenderer.act(() => {
        root = TestRenderer.create(<Probe value={0} />);
      });
      TestRenderer.act(() => root!.update(<Probe value={100} />));
      clock = 50;
      TestRenderer.act(() => frames.shift()!());
      const mid = seen[seen.length - 1];
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(100);
      // Re-target while mid-count: the first frame of the new count is at its start.
      frames.length = 0;
      TestRenderer.act(() => root!.update(<Probe value={200} />));
      clock = 50; // no time has passed for the new count
      TestRenderer.act(() => frames.shift()!());
      expect(seen[seen.length - 1]).toBe(mid);
    } finally {
      g.requestAnimationFrame = savedRaf;
      g.cancelAnimationFrame = savedCaf;
      Date.now = savedNow;
    }
  });
});

describe("RW-11 nothing still names the deleted modules", () => {
  test("the app tree has no reference to the old hero, timeline, conditions section or busyness service", () => {
    // Built from parts so this guard does not itself name them (a repo-wide
    // grep for the four names must come back empty).
    const DELETED = new RegExp(
      [["Expanded", "CardHero"], ["Plan", "Timeline"], ["Conditions", "Section"], ["busyness", "Service"]]
        .map((p) => p.join(""))
        .join("|"),
    );
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(tsx?|jsx?|mjs|cjs|json)$/.test(e.name)) {
          if (DELETED.test(fs.readFileSync(full, "utf8"))) hits.push(path.relative(SRC, full));
        }
      }
    };
    walk(SRC);
    expect(hits).toEqual([]);
  });
});
