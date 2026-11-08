import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

/**
 * #1022 REWORK — regression guards for the five TEST-phase findings.
 *
 * Every one of these was PROVEN on real hardware and NONE was findable from
 * source review, which is exactly why each now carries a source gate: the
 * runtime proof cannot run in CI, but the shape that caused it can be pinned.
 *
 *   F-1 P0  colour plane inert on physical Android (RNGH gestures do not reach
 *           inside SheetMobile's Modal without an inner GestureHandlerRootView)
 *   F-2 P0  drag band was a 52pt overlay above a 24pt handle -> ~28pt of
 *           consumer content swallowed in all 63 Sheet consumers
 *   F-3 P0  colour plane never rendered on ANY browser (react-native-web's
 *           isScreenReaderEnabled() resolves true unconditionally)
 *   F-4 P1  desktop centred card never rendered (imported SheetMobile directly)
 *   F-5 P1  thumbs opened pinned far-left (position read from a ref)
 *
 * Fails-on-revert is proven per finding in the rework report.
 */

const src = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const SHEET_MOBILE = "src/components/ui/SheetMobile.tsx";
const THEME_SHEET = "src/components/theme/ThemeSheet.tsx";

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("F-1 — RNGH gestures must reach inside the Sheet's Modal on Android", () => {
  test("SheetMobile mounts its OWN GestureHandlerRootView inside the Modal", () => {
    // The app-root GestureHandlerRootView (expo-router) does NOT extend into a
    // Modal's separate window on Android. Without this inner root EVERY gesture
    // in EVERY sheet is silently dead on Android — the colour plane, the hue
    // rail, and IntakeQuestionEditor's DraggableFlatList.
    const s = stripComments(src(SHEET_MOBILE));
    expect(s).toContain("GestureHandlerRootView");
    expect(s).toMatch(/import \{[^}]*GestureHandlerRootView[^}]*\} from "react-native-gesture-handler"/);
  });

  test("the gesture root is INSIDE the Modal, wrapping the sheet content", () => {
    const s = src(SHEET_MOBILE);
    const modalAt = s.indexOf("<Modal");
    const rootAt = s.indexOf("<GestureHandlerRootView");
    const keyboardAt = s.indexOf("<KeyboardRoot");
    expect(modalAt).toBeGreaterThan(-1);
    expect(rootAt).toBeGreaterThan(modalAt);
    // and it must wrap the panel, not sit beside it
    expect(rootAt).toBeLessThan(keyboardAt);
  });

  test("the gesture root is sized — an unsized root collapses and gestures still miss", () => {
    expect(src(SHEET_MOBILE)).toMatch(/gestureRoot:\s*\{\s*flex:\s*1,?\s*\}/);
  });

  test("this mirrors the shipped Toast precedent rather than inventing a pattern", () => {
    // Toast.tsx already documents and ships the identical fix.
    const toast = src("src/components/ui/Toast.tsx");
    expect(toast).toContain("<GestureHandlerRootView");
    expect(toast).toContain("does NOT extend");
  });
});

describe("F-2 — the drag band must never overlay consumer content", () => {
  test("the band is EXACTLY the handle region, never larger", () => {
    const s = src(SHEET_MOBILE);
    const band = /SHEET_DRAG_BAND_HEIGHT\s*=\s*(\d+)/.exec(s);
    expect(band).not.toBeNull();
    // handleWrap paddingVertical (spacing.sm + 2 = 10) x2 + 4pt handle = 24
    expect(Number(band?.[1])).toBeLessThanOrEqual(24);
  });

  test("the derivation is guarded so the band cannot silently creep back", () => {
    const s = src(SHEET_MOBILE);
    expect(s).toMatch(/HANDLE_REGION_HEIGHT\s*=\s*2 \* \(spacing\.sm \+ 2\) \+ 4/);
    expect(s).toContain("SHEET_DRAG_BAND_HEIGHT !== HANDLE_REGION_HEIGHT");
  });

  test("the band declares pass-through-safe pointer semantics", () => {
    const s = src(SHEET_MOBILE);
    const block = s.slice(s.indexOf("nativeDragCatch: {"), s.indexOf("nativeDragCatch: {") + 400);
    expect(block).toMatch(/pointerEvents/);
  });

  test("the pan is STILL scoped to the band — deleting it was tested and rejected", () => {
    // Device evidence (SM-A725F): with the band removed and the Pan back on the
    // whole panel, the plane dragged fine AND handle-drag dismissed — but
    // scrolling the font list DISMISSED THE SHEET. That is the original
    // ORCH-1173 defect and it is worse than the overlay. Scoping stays.
    const s = src(SHEET_MOBILE);
    expect(s).toMatch(
      /<WebSafeGestureDetector\s+gesture=\{panGesture\}>\s*<View\s+style=\{styles\.nativeDragCatch\}/,
    );
    expect(s).not.toMatch(/<WebSafeGestureDetector\s+gesture=\{panGesture\}>\s*<Animated\.View/);
  });

  test("gesture coordination remains forbidden (ORCH-1173 R1 failed on device)", () => {
    const s = stripComments(src(SHEET_MOBILE));
    for (const api of [
      "Gesture.Simultaneous",
      "Gesture.Native",
      "simultaneousWithExternalGesture",
      "blocksExternalGesture",
    ]) {
      expect(s).not.toContain(api);
    }
  });
});

// issue #1023 wave 2 — F-3 (the colour plane on web, numeric mode) is
// retired with the plane itself: the design's swatches and hue sliders
// replaced it and have no screen-reader mode switch to gate.

describe("F-4 — the sheet must route through the platform-resolving entry point", () => {
  test("ThemeSheet imports ../ui/Sheet, never ../ui/SheetMobile", () => {
    const s = src(THEME_SHEET);
    expect(s).toContain('from "../ui/Sheet"');
    expect(s).not.toMatch(/from "\.\.\/ui\/SheetMobile"/);
  });

  test("no component outside ui/ imports SheetMobile directly", () => {
    // ThemeSheet was the ONLY consumer repo-wide doing this; a gate here stops
    // the next one. Sheet.tsx/Sheet.web.tsx legitimately re-export it.
    const { execSync } = require("child_process") as typeof import("child_process");
    const out = execSync(
      `grep -rln 'from "\\.\\./ui/SheetMobile"' src/components || true`,
      { cwd: process.cwd(), encoding: "utf8" },
    ).trim();
    expect(out).toBe("");
  });
});

// issue #1023 wave 2 — F-5 (plane/rail thumbs from state) is retired with
// the plane; the Custom hue slider keeps its measured width in state
// (ThemeColourTab HueSlider `useState(0)` + onLayout), asserted below.
describe("F-5 (#1023) — the hue slider thumb is placed from measured state", () => {
  test("the slider width is state set by onLayout, and the thumb waits for it", () => {
    const s = readFileSync(path.join(process.cwd(), "src/components/theme/ThemeColourTab.tsx"), "utf8");
    expect(s).toContain("const [width, setWidth] = useState(0);");
    expect(s).toContain("onLayout={(e) => setWidth(e.nativeEvent.layout.width)}");
    expect(s).toContain("{width > 0 ? (");
  });
});

describe("F-6 — two motion tiles must fit the narrowest phone we ship to", () => {
  test("tile width x2 + gap fits inside a 375pt phone's sheet body", () => {
    const s = src(THEME_SHEET);
    const tile = /motionTile:\s*\{[^}]*width:\s*(\d+)/.exec(s);
    expect(tile).not.toBeNull();
    // sheet body = screen - 32 -> 343 on iPhone SE/8
    expect(Number(tile?.[1]) * 2 + 8).toBeLessThanOrEqual(343);
  });
});
