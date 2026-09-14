/**
 * issue #3284 [bundle budget] — the buyer event route starts the refund ladder's
 * chunk with its data load, never at module import.
 *
 * The ladder (OfferingRefundLadder) loads in its own chunk. Until it arrives the
 * body reserves its height; to make that fallback rare, the three buyer offering
 * routes start the chunk in the same mount that starts the page data fetch.
 *
 *   P-1  importing the route loads nothing; mounting it starts the page data load
 *        and the ladder load together, once; the data landing does not load again,
 *        and nothing waits on the ladder (the page renders with its data).
 *   P-2  the experience and trip routes do the same (in a mount effect beside their
 *        data hook, never at module scope), and no other route or screen module
 *        under app/ loads the ladder, so non-offering routes never fetch it.
 *
 * FAILS-ON-REVERT: delete the effect from app/e/[brandSlug]/[eventSlug].tsx and
 * P-1 goes red; move the call to module scope and P-1 goes red on import.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = { unmount: () => void; update: (node: React.ReactElement) => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const events: string[] = [];
let queryResult: Record<string, unknown> = { isLoading: true, isFetching: true, isError: false, data: undefined };
let pageRendered = 0;

jest.mock("@mingla/offering-rendering/LazyOfferingRefundLadder", () => ({
  loadOfferingRefundLadder: () => {
    events.push("ladder-load");
    return Promise.resolve({});
  },
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ brandSlug: "sunset-collective", eventSlug: "rooftop-sessions" }),
}));
jest.mock("../../../src/hooks/usePublicEvents", () => ({
  usePublicEventBySlug: (brandSlug: string | null, eventSlug: string | null) => {
    events.push(`data-load:${brandSlug}/${eventSlug}`);
    return queryResult;
  },
}));
jest.mock("../../../src/components/event/PublicEventPage", () => ({
  PublicEventPage: () => {
    pageRendered += 1;
    return null;
  },
}));
jest.mock("../../../src/components/event/PublicEventNotFound", () => ({
  PublicEventNotFound: () => null,
}));
jest.mock("../../../src/analytics/webAnalytics", () => ({
  captureAdClickIds: jest.fn(),
  captureWeb: jest.fn(),
  fireAdPageView: jest.fn(),
  fireAdViewContent: jest.fn(),
}));

const APP_DIR = path.join(__dirname, "..", "..");

describe("#3284 P — buyer routes start the refund ladder with their data load", () => {
  test("P-1 the event route loads nothing on import, starts the ladder with its data load on mount, once, and never waits on it", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PublicEventRoute = (require("../[brandSlug]/[eventSlug]") as { default: React.FC }).default;
    expect(events).toEqual([]);

    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(<PublicEventRoute />);
    });
    expect(events).toEqual(["data-load:sunset-collective/rooftop-sessions", "ladder-load"]);

    // The data lands: the page renders at once, and the ladder is not loaded again.
    queryResult = {
      isLoading: false,
      isFetching: false,
      isError: false,
      data: {
        event: {},
        brand: null,
        bookable: true,
        terminalSource: null,
        occurrences: [],
        multiDatePricingMode: "per_day",
        refundPolicyState: { status: "unknown" },
      },
    };
    await act(async () => {
      tree.update(<PublicEventRoute />);
    });
    expect(pageRendered).toBeGreaterThan(0);
    expect(events.filter((e) => e === "ladder-load")).toEqual(["ladder-load"]);
    expect(events.filter((e) => e.startsWith("data-load")).length).toBeGreaterThan(1);
    tree.unmount();
  });

  test("P-2 the experience and trip routes start it the same way, and no other app route loads the ladder", () => {
    const routes = {
      "e/[brandSlug]/[eventSlug].tsx": "usePublicEventBySlug(",
      "exp/[brandSlug]/[experienceSlug].tsx": "usePublicExperienceBySlug(",
      "t/[brandSlug]/[tripSlug].tsx": "usePublicTripBySlug(",
    };
    const effect = /useEffect\(\(\) => \{\s*loadOfferingRefundLadder\(\)\.catch\(\(\) => undefined\);\s*\}, \[\]\);/;
    for (const [route, dataHook] of Object.entries(routes)) {
      const source = fs.readFileSync(path.join(APP_DIR, route), "utf8");
      const call = source.search(effect);
      expect({ route, inMountEffect: call >= 0 }).toEqual({ route, inMountEffect: true });
      // Beside the data hook, inside the component: after the hook call, and the
      // only call in the file.
      expect({ route, afterDataHook: call > source.indexOf(dataHook) }).toEqual({ route, afterDataHook: true });
      expect({ route, calls: source.split("loadOfferingRefundLadder(").length - 1 }).toEqual({ route, calls: 1 });
    }

    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(full, "utf8").includes("loadOfferingRefundLadder")) {
          importers.push(path.relative(APP_DIR, full).split(path.sep).join("/"));
        }
      }
    };
    walk(APP_DIR);
    expect(importers.sort()).toEqual(Object.keys(routes).sort());
  });
});
