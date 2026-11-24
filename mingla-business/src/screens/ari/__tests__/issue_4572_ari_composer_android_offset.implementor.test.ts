/**
 * #4572 retest (Android) — the Ari composer ends flush on the keyboard on
 * Android too.
 *
 * Device (API 34 emulator, 1080x2400 @ 420dpi = 2.625, gesture nav, edge-to-
 * edge, built from 1b0a69b2d9): status bar 63px (24dp), IME top 1517px, the
 * composer container ended at 1580px: 63px (24dp, one status bar) UNDER the
 * keyboard. React Native's measureInWindow subtracts the visible frame's top
 * (the status bar); the keyboard-controller KeyboardAvoidingView compares the
 * frame with a keyboard top measured from the top of the screen.
 *
 * fails-on-revert: drop the Android status-bar term from
 * `composerKeyboardOffsetFor` (or stop passing it from AriChatScreen) and the
 * Android cases go red; the iOS cases pin today's flush result unchanged.
 */
import fs from "node:fs";
import path from "node:path";

import { composerGapAboveKeyboard, composerKeyboardOffsetFor } from "../ariComposerKeyboardFrame";

const DENSITY = 2.625;
const dp = (px: number): number => px / DENSITY;

describe("#4572 retest — Android: the composer offset adds the status bar back", () => {
  // Tester's numbers, in dp.
  const statusBar = dp(63); // 24
  const screenHeight = dp(2400);
  const keyboardTop = dp(1517);
  const keyboardHeight = screenHeight - keyboardTop;
  // Host measured at 117dp below the status bar (Ari top bar etc.); the KAV
  // frame ends 70dp lower inside it, above the resting spacer.
  const g = {
    parentWindowY: 117,
    measureOriginOnScreen: statusBar,
    frameY: 640,
    frameHeight: 70,
    composerHeight: 62,
    screenHeight,
    keyboardHeight,
  };

  it("without the status bar term the composer ends one status bar (24dp = 63px) under the keyboard (the device failure)", () => {
    const gap = composerGapAboveKeyboard({ ...g, keyboardVerticalOffset: composerKeyboardOffsetFor(117) });
    expect(gap * DENSITY).toBeCloseTo(-63, 5);
  });

  it("with the status bar added on Android the gap is 0", () => {
    const offset = composerKeyboardOffsetFor(117, "android", statusBar);
    expect(offset).toBe(141);
    expect(composerGapAboveKeyboard({ ...g, keyboardVerticalOffset: offset })).toBeCloseTo(0, 0);
  });

  it("holds at other host positions and status-bar heights", () => {
    for (const [y, bar] of [[96, 24], [140, 28], [60, 32]] as const) {
      const offset = composerKeyboardOffsetFor(y, "android", bar);
      expect(
        composerGapAboveKeyboard({ ...g, parentWindowY: y, measureOriginOnScreen: bar, keyboardVerticalOffset: offset }),
      ).toBeCloseTo(0, 5);
    }
  });

  it("iOS (and web) never add a status bar: today's flush result is unchanged", () => {
    expect(composerKeyboardOffsetFor(117, "ios", 47)).toBe(117);
    expect(composerKeyboardOffsetFor(117, "web", 24)).toBe(117);
    expect(composerKeyboardOffsetFor(117)).toBe(117);
    const ios = { ...g, measureOriginOnScreen: 0, screenHeight: 874, keyboardHeight: 334, frameY: 581 };
    expect(composerGapAboveKeyboard({ ...ios, keyboardVerticalOffset: composerKeyboardOffsetFor(117, "ios", 0) })).toBe(0);
  });

  it("a missing or hostile status-bar height adds nothing", () => {
    for (const bar of [null, undefined, Number.NaN, -10, 0]) {
      expect(composerKeyboardOffsetFor(117, "android", bar)).toBe(117);
    }
  });

  it("AriChatScreen passes the platform and the status-bar height", () => {
    const screen = fs.readFileSync(path.resolve(__dirname, "../AriChatScreen.tsx"), "utf8");
    expect(screen).toMatch(/composerKeyboardOffsetFor\(y, Platform\.OS, StatusBar\.currentHeight\)/);
  });
});
