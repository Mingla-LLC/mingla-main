/**
 * A6 is ineffective if the browser route stops invoking the scrub helper.
 * Mount the real route, retaining the real deep-link behavior behind instrumented
 * wrappers, so the proof observes the integration instead of reading its source.
 */

import React from "react";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "a".repeat(43);
const CLAIM_FRAGMENT = new URLSearchParams({
  v: "1",
  kind: "order",
  event: EVENT_ID,
  source: SOURCE_ID,
  token: TOKEN,
}).toString();
const CLEAN_URL = "/attendance/claim?source=acceptance";
const APP_URL = `com.mingla.app.v2://attendance-claim#${CLAIM_FRAGMENT}`;

const mockLifecycleCalls: string[] = [];
const mockOpenUrl = jest.fn<(url: string) => Promise<never>>(
  () => new Promise<never>(() => undefined),
);

jest.mock("react-native", () => ({
  Linking: { openURL: (url: string) => mockOpenUrl(url) },
  Platform: {
    OS: "web",
    select: (options: Record<string, unknown>): unknown =>
      options.web ?? options.default,
  },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: "Text",
  View: "View",
}));

jest.mock("../../components/ui/Button", () => ({ Button: "Button" }));
jest.mock("../../components/ui/Icon", () => ({ Icon: "Icon" }));
jest.mock("../../components/ui/SafeScreen", () => ({ SafeScreen: "SafeScreen" }));

jest.mock("../attendanceClaimDeepLink", () => {
  const actual = jest.requireActual(
    "../attendanceClaimDeepLink",
  ) as typeof import("../attendanceClaimDeepLink");
  return {
    ...actual,
    attendanceAppUrlFromFragment: (raw: string): string | null => {
      mockLifecycleCalls.push("parse");
      return actual.attendanceAppUrlFromFragment(raw);
    },
    consumeAttendanceClaimFragment: (
      ...args: Parameters<typeof actual.consumeAttendanceClaimFragment>
    ): ReturnType<typeof actual.consumeAttendanceClaimFragment> => {
      mockLifecycleCalls.push("consume");
      return actual.consumeAttendanceClaimFragment(...args);
    },
    createAttendanceClaimFragmentScrubber: (
      ...args: Parameters<typeof actual.createAttendanceClaimFragmentScrubber>
    ): ReturnType<typeof actual.createAttendanceClaimFragmentScrubber> => {
      mockLifecycleCalls.push("create-scrubber");
      const scrub = actual.createAttendanceClaimFragmentScrubber(...args);
      return (...scrubArgs) => {
        mockLifecycleCalls.push("scrub");
        return scrub(...scrubArgs);
      };
    },
  };
});

import AttendanceClaimLanding from "../../../app/attendance/claim";
import { ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY } from "../attendanceClaimDeepLink";

interface RenderTree {
  unmount: () => void;
}

const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
  create: (element: React.ReactElement) => RenderTree;
};

class MockHtmlElement {
  focus(): void {
    // The route restores focus on cleanup; the behavior is outside this proof.
  }
}

type ScheduledFrame = (timestamp: number) => void;

let tree: RenderTree | null = null;
let visibleUrl = CLEAN_URL;
let scheduledFrames: ScheduledFrame[] = [];
let replacements: Array<Readonly<{ state: unknown; url: string }>> = [];
const launchState = { key: "pre-router-launch" };

const flushRoute = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    for (let pass = 0; pass < 5; pass += 1) await Promise.resolve();
  });
};

beforeEach(() => {
  mockLifecycleCalls.splice(0);
  mockOpenUrl.mockClear();
  visibleUrl = CLEAN_URL;
  scheduledFrames = [];
  replacements = [];

  const browserWindow = {
    location: {
      hash: "",
      pathname: "/attendance/claim",
      search: "?source=acceptance",
    },
    history: {
      back: jest.fn(),
      replaceState: (state: unknown, _unused: string, url: string): void => {
        visibleUrl = url;
        replacements.push({ state, url });
      },
      state: { key: "router-after-bootstrap" },
    },
    requestAnimationFrame: (callback: ScheduledFrame): number => {
      mockLifecycleCalls.push("schedule-frame");
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    },
  };
  Object.defineProperty(
    browserWindow,
    ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
    {
      configurable: true,
      enumerable: false,
      value: {
        cleanUrl: CLEAN_URL,
        fragment: CLAIM_FRAGMENT,
        historyState: launchState,
      },
    },
  );

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserWindow,
    writable: true,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: MockHtmlElement,
    writable: true,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      activeElement: null,
      addEventListener: jest.fn(),
      querySelector: jest.fn(() => null),
      querySelectorAll: jest.fn(() => []),
      removeEventListener: jest.fn(),
    },
    writable: true,
  });
});

afterEach(() => {
  if (tree !== null) {
    TestRenderer.act(() => tree?.unmount());
    tree = null;
  }
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "HTMLElement");
  Reflect.deleteProperty(globalThis, "window");
});

describe("issue #2979 attendance claim route fragment scrub integration", () => {
  test("consumes, scrubs, parses, and restores through the mounted production route", async () => {
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(React.createElement(AttendanceClaimLanding));
    });
    await flushRoute();

    expect(mockLifecycleCalls.slice(0, 6)).toEqual([
      "consume",
      "create-scrubber",
      "scrub",
      "schedule-frame",
      "parse",
      "schedule-frame",
    ]);
    expect(Object.prototype.hasOwnProperty.call(
      window,
      ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
    )).toBe(false);
    expect(mockOpenUrl).toHaveBeenCalledWith(APP_URL);
    expect(replacements[0]).toEqual({ state: launchState, url: CLEAN_URL });

    visibleUrl = "/attendance/claim";
    await TestRenderer.act(async () => {
      while (scheduledFrames.length > 0) {
        scheduledFrames.shift()?.(16);
      }
    });

    expect(visibleUrl).toBe(CLEAN_URL);
    expect(replacements).toHaveLength(4);
    expect(replacements.every(({ state, url }) =>
      state === launchState && url === CLEAN_URL
    )).toBe(true);
  });
});
