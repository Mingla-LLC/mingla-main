/**
 * #4389 addendum 2 — an offering clip plays only while its own row is on
 * screen. FAILS-ON-REVERT: passing `active={appActive}` (app-wide) instead of
 * `appActive && onScreen` fails "a row below the fold stays paused".
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { Dimensions, Platform } from "react-native";

const mockActive: boolean[] = [];
jest.mock("../OfferingClip", () => ({
  OfferingClip: (p: { active: boolean }) => {
    mockActive.push(p.active);
    return null;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(
    element: React.ReactElement,
    options?: { createNodeMock?: () => unknown },
  ): { unmount(): void };
  act(callback: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* eslint-disable import/first */
import { OfferingRowClip, ROW_VISIBILITY_POLL_MS, rowOnScreen } from "../offeringRowVisibility";
/* eslint-enable import/first */

const windowHeight = Dimensions.get("window").height;
const os = Platform.OS;
afterEach(() => {
  (Platform as { OS: string }).OS = os;
  jest.useRealTimers();
  mockActive.length = 0;
});

function mountAt(rowTop: () => number, appActive = true): { unmount(): void } {
  let r!: { unmount(): void };
  TestRenderer.act(() => {
    r = TestRenderer.create(<OfferingRowClip video={1} poster={2} appActive={appActive} />, {
      createNodeMock: () => ({
        measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, rowTop(), 340, 76),
      }),
    });
  });
  return r;
}

describe("#4389 offering row visibility", () => {
  test("rule: at least a third of the row inside the window", () => {
    expect(rowOnScreen(100, 76, 800)).toBe(true);
    expect(rowOnScreen(780, 76, 800)).toBe(false);
    expect(rowOnScreen(770, 76, 800)).toBe(true);
    expect(rowOnScreen(-60, 76, 800)).toBe(false);
    expect(rowOnScreen(900, 76, 800)).toBe(false);
    expect(rowOnScreen(0, 0, 800)).toBe(false);
  });
  test("a row below the fold stays paused, then plays once scrolled into view", () => {
    jest.useFakeTimers();
    (Platform as { OS: string }).OS = "ios";
    let top = windowHeight + 200;
    const r = mountAt(() => top);
    expect(mockActive[mockActive.length - 1]).toBe(false);
    top = 120;
    TestRenderer.act(() => {
      jest.advanceTimersByTime(ROW_VISIBILITY_POLL_MS);
    });
    expect(mockActive[mockActive.length - 1]).toBe(true);
    top = -400;
    TestRenderer.act(() => {
      jest.advanceTimersByTime(ROW_VISIBILITY_POLL_MS);
    });
    expect(mockActive[mockActive.length - 1]).toBe(false);
    r.unmount();
  });
  test("an on-screen row is paused while the app is in the background", () => {
    (Platform as { OS: string }).OS = "ios";
    const r = mountAt(() => 120, false);
    expect(mockActive.every((a) => a === false)).toBe(true);
    r.unmount();
  });
  test("web never measures (poster only)", () => {
    (Platform as { OS: string }).OS = "web";
    const r = mountAt(() => 120);
    expect(mockActive.every((a) => a === false)).toBe(true);
    r.unmount();
  });
});
