/**
 * #4389 P9 (cause B) — the brand switcher closed before a row was picked.
 * TopSheetWeb's drag band closed on an upward flick velocity with no minimum
 * travel, so the 1–2px jitter of a click on the band could close the sheet.
 * A velocity close now needs TOPSHEET_DRAG_MIN_PX (12) of upward travel; the
 * 25%-of-height drag close is unchanged.
 *
 * FAILS-ON-REVERT: delete `&& -dragged >= TOPSHEET_DRAG_MIN_PX` from
 * handleDragEnd and D1 fails (a 2px fast move calls onClose).
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/components/ui/__tests__/issue_4389_topsheet_drag_min.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform = { OS: "web", select: (o: Record<string, unknown>) => o.web ?? o.default };
jest.mock("react-native", () => {
  const base = jest.requireActual("react-native") as Record<string, unknown>;
  return { ...base, Platform: mockPlatform };
});
// The web variant calls no reanimated / gesture-handler hooks; these stubs
// only satisfy TopSheet.tsx's module imports (native variant).
jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native");
  const identity = <T,>(value: T): T => value;
  return {
    __esModule: true,
    default: { View },
    Easing: { ease: identity, cubic: identity, inOut: identity, out: identity, in: identity },
    cancelAnimation: jest.fn(),
    runOnJS: identity,
    useAnimatedStyle: (factory: () => object): object => factory(),
    useReducedMotion: (): boolean => true,
    useSharedValue: <T,>(value: T): { value: T } => ({ value }),
    withTiming: identity,
  };
});
jest.mock("react-native-gesture-handler", () => ({ Gesture: {} }));
jest.mock("../WebSafeGestureDetector", () => ({ WebSafeGestureDetector: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../Material", () => ({ Material: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { Text } from "react-native";
import { TopSheet } from "../TopSheet";

/** Mirrors TopSheet.tsx TOPSHEET_DRAG_MIN_PX (kept module-private: eager chunk). */
const TOPSHEET_DRAG_MIN_PX = 12;

interface Node { type: unknown; props: Record<string, unknown> }
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement) => Tree;
};

let now = 1_000;
beforeEach(() => {
  now = 1_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => {
  jest.restoreAllMocks();
});

function mount(onClose: () => void): { tree: Tree; band: () => Node } {
  let tree: Tree | null = null;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TopSheet visible onClose={onClose} testID="ts">
        <Text>rows</Text>
      </TopSheet>,
    );
  });
  const t = tree as unknown as Tree;
  const band = (): Node =>
    t.root.findAll((n) => n.props.testID === "ts-drag-handle" && typeof n.props.onPointerDown === "function")[0]!;
  return { tree: t, band };
}

/** Pointer down at y=200, one move `dy` px after `ms`, then up. */
function drag(band: () => Node, dy: number, ms: number): void {
  TestRenderer.act(() => {
    (band().props.onPointerDown as (e: unknown) => void)({ nativeEvent: { clientY: 200, pointerId: 1 } });
  });
  now += ms;
  TestRenderer.act(() => {
    (band().props.onPointerMove as (e: unknown) => void)({ nativeEvent: { clientY: 200 + dy } });
  });
  TestRenderer.act(() => {
    (band().props.onPointerUp as () => void)();
  });
}

const src4389 = (): string =>
  (require("fs") as typeof import("fs")).readFileSync((require("path") as typeof import("path")).join(__dirname, "../TopSheet.tsx"), "utf8");

describe("#4389 P9 — TopSheetWeb drag band minimum travel", () => {
  test("D1: a 2px upward move at high velocity (a click's jitter) never closes", () => {
    const onClose = jest.fn();
    const { tree, band } = mount(onClose);
    drag(band, -2, 1); // 2 px/ms, far above the 0.5 px/ms flick threshold
    expect(onClose).not.toHaveBeenCalled();
    drag(band, -(TOPSHEET_DRAG_MIN_PX - 1), 2);
    expect(onClose).not.toHaveBeenCalled();
    TestRenderer.act(() => tree.unmount());
  });

  test("D2: an upward flick of 12px or more still closes", () => {
    expect(src4389()).toMatch(/const TOPSHEET_DRAG_MIN_PX = 12;/);
    const onClose = jest.fn();
    const { tree, band } = mount(onClose);
    drag(band, -TOPSHEET_DRAG_MIN_PX, 4); // 3 px/ms
    expect(onClose).toHaveBeenCalledTimes(1);
    TestRenderer.act(() => tree.unmount());
  });

  test("D4: the switcher list keeps its last row clear of the 28px drag band", () => {
    const src = (require("fs") as typeof import("fs")).readFileSync(
      (require("path") as typeof import("path")).join(__dirname, "../../brand/BrandSwitcherSheet.tsx"),
      "utf8",
    );
    expect(src).toMatch(/scrollContent: \{[^}]*paddingBottom: 28 \+ space\[2\]/);
    const sheet = (require("path") as typeof import("path")).join(__dirname, "../TopSheet.tsx");
    expect((require("fs") as typeof import("fs")).readFileSync(sheet, "utf8")).toContain("{ height: handleAreaHeight + 28 }");
  });

  test("D3: a slow short drag springs back (unchanged)", () => {
    const onClose = jest.fn();
    const { tree, band } = mount(onClose);
    drag(band, -20, 1000); // 0.02 px/ms, well under 25% of the panel
    expect(onClose).not.toHaveBeenCalled();
    TestRenderer.act(() => tree.unmount());
  });
});
