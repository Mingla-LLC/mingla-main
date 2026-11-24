// MINGLA-INVARIANT: I-4572-ARI-COMPOSER-FLUSH | issue #4572 item 16 | The Ari composer rides the keyboard in the keyboard-controller KeyboardAvoidingView (behavior="padding") and sits flush on it: no Done bar and no clearance while it is focused, and every other field keeps the Done bar.
/**
 * #4572 item 16 — regression test for the no-brand Host home's keyboard.
 *
 * What broke on device (suspected from code, proven by the tester): the Ari
 * composer was lifted by `paddingBottom = keyboardHeight + DoneBar + 12`, a
 * React-state value set once from the keyboard's FINAL height in `onStart`, so
 * it leapt in one step while the keyboard was still sliding and rested ~65pt
 * above the keyboard. Seth approved: the composer rides the keyboard frame by
 * frame (the #4173 messages pattern) and sits flush, with no Done bar while it
 * is focused.
 *
 * Default (node / ts-jest) config: source assertions plus the pure
 * suppression store. The MOUNTED-tree proof (wrapper, resting spacer, focus
 * flag, per-branch padding) is `issue_1890_ari_composer_clearance.happy.test.ts`,
 * which runs under jest.issue1890.render.cjs.
 *
 * fails-on-revert: delete the `<KeyboardAvoidingView behavior="padding">`
 * wrapper from AriChatScreen (or restore `composerOccupiedPxFor`, or drop the
 * `setDoneBarSuppressed` wiring) and the matching assertion goes red.
 */
import fs from "node:fs";
import path from "node:path";

import {
  composerGapAboveKeyboard,
  composerKeyboardOffsetFor,
} from "../ariComposerKeyboardFrame";
import {
  doneBarShown,
  getDoneBarSuppressed,
  setDoneBarSuppressed,
  subscribeDoneBarSuppressed,
} from "../../../wrappers/doneBarSuppression";

const read = (rel: string): string => fs.readFileSync(path.resolve(__dirname, rel), "utf8");
/** Comments never satisfy and never violate a source assertion. */
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const screen = code(read("../AriChatScreen.tsx"));
const inputBar = code(read("../../../components/ari/InputBar.tsx"));
const toolbarNative = code(read("../../../wrappers/KeyboardToolbarRoot.native.tsx"));

describe("#4572 — the Ari composer rides the keyboard and sits flush", () => {
  it("the composer is inside the keyboard-controller KeyboardAvoidingView (padding), via the platform wrapper", () => {
    expect(screen).toMatch(
      /import\s*\{\s*KeyboardAvoidingView\s*\}\s*from\s*["'][^"']*wrappers\/SmartKeyboardAvoidingView["']/,
    );
    const open = screen.search(/<KeyboardAvoidingView\b[^>]*behavior="padding"/);
    const wrap = screen.indexOf("styles.inputWrap");
    const close = screen.indexOf("</KeyboardAvoidingView>");
    expect(open).toBeGreaterThan(-1);
    expect(wrap).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(wrap);
    // The wrapper comes from the web-safe platform module, never the library
    // directly (the native library must stay out of the web graph).
    expect(screen).not.toMatch(/from\s*["']react-native-keyboard-controller["']/);
  });

  it("0 clearance and no Done bar: no Done-bar or clearance term and no keyboard-state lift remain", () => {
    expect(screen).not.toMatch(/\bDONE_BAR_OCCUPIED\b/);
    expect(screen).not.toMatch(/\bMIN_VISIBLE_CLEARANCE\b/);
    expect(screen).not.toMatch(/\bcomposerOccupiedPxFor\b/);
    // No keyboard height reaches the composer wrapper's own style, and there is
    // no keyboard-open ternary anywhere in the screen.
    expect(screen).not.toMatch(/keyboardHeight\s*>\s*0\s*\?/);
    expect(screen).not.toMatch(/styles\.inputWrap[\s\S]{0,1500}?\bkeyboardHeight\b/);
  });

  it("the Done bar is suppressed exactly while the Ari composer is focused", () => {
    expect(screen).toMatch(/onFocus=\{\(\)\s*=>\s*setDoneBarSuppressed\(true\)\}/);
    expect(screen).toMatch(/onBlur=\{\(\)\s*=>\s*setDoneBarSuppressed\(false\)\}/);
    // …and a screen that goes away focused never strands the flag.
    expect(screen).toMatch(/setDoneBarSuppressed\(false\),\s*\[\]\)/);
    // InputBar forwards focus and blur to the real TextInput.
    expect(inputBar).toMatch(/onFocus=\{onFocus\}/);
    expect(inputBar).toMatch(/onBlur=\{onBlur\}/);
  });

  it("every other field keeps the Done bar: the toolbar hides only while the flag is up", () => {
    expect(toolbarNative).toMatch(/if\s*\(!doneBarShown\(visible,\s*suppressed\)\)\s*return null;/);
    // #4572 P2-2: the toolbar only READS the flag. Clearing it when the keyboard
    // hid brought the Done bar back after an Android back-button dismissal.
    expect(toolbarNative).not.toMatch(/setDoneBarSuppressed/);
    // The flag lives in one library-free module; nothing else raises it.
    const raisers = ["../AriChatScreen.tsx"].filter((rel) => /setDoneBarSuppressed\(true\)/.test(code(read(rel))));
    expect(raisers).toEqual(["../AriChatScreen.tsx"]);
  });
});

describe("#4572 — the Done-bar suppression flag", () => {
  afterEach(() => setDoneBarSuppressed(false));

  it("starts down, goes up on focus and comes down on blur", () => {
    expect(getDoneBarSuppressed()).toBe(false);
    setDoneBarSuppressed(true);
    expect(getDoneBarSuppressed()).toBe(true);
    setDoneBarSuppressed(false);
    expect(getDoneBarSuppressed()).toBe(false);
  });

  it("notifies subscribers only on a real change and stops after unsubscribe", () => {
    const listener = jest.fn();
    const off = subscribeDoneBarSuppressed(listener);
    setDoneBarSuppressed(true);
    setDoneBarSuppressed(true); // same value: no notification
    expect(listener).toHaveBeenCalledTimes(1);
    setDoneBarSuppressed(false);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    setDoneBarSuppressed(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("#4572 P2-2 — Android back hides the keyboard but keeps the composer focused", () => {
  afterEach(() => setDoneBarSuppressed(false));

  it("re-tapping the still-focused composer reopens the keyboard with no Done bar", () => {
    // Focus: the composer raises the flag; the keyboard shows.
    setDoneBarSuppressed(true);
    expect(doneBarShown(true, getDoneBarSuppressed())).toBe(false);
    // Back button: the keyboard hides, no blur fires. Nothing draws.
    expect(doneBarShown(false, getDoneBarSuppressed())).toBe(false);
    // Re-tap: no new focus event, the keyboard shows again. Still no Done bar.
    expect(doneBarShown(true, getDoneBarSuppressed())).toBe(false);
  });

  it("another field keeps its Done bar once the composer blurs", () => {
    setDoneBarSuppressed(true);
    setDoneBarSuppressed(false); // focusing another field blurs the composer first
    expect(doneBarShown(true, getDoneBarSuppressed())).toBe(true);
    expect(doneBarShown(false, getDoneBarSuppressed())).toBe(false);
  });
});

/**
 * #4572 retest P1-1 — WHY THE TESTS ABOVE PASSED WHILE THE DEVICE FAILED.
 *
 * They proved the composer was INSIDE a KeyboardAvoidingView and that the
 * Done bar was off, but jest mocks the library, so nothing ever evaluated
 * where the library puts the composer. The library reads its own onLayout
 * frame, which is relative to its PARENT, and compares it with the keyboard
 * top in SCREEN space. The Ari composer's view sits under the status bar and
 * the Ari top bar, so with no offset it stopped short by that much and ended
 * under the keyboard (iOS 26.5: keyboard top 540pt, composer 57-101pt below
 * it). These tests evaluate the library's own formula on device-shaped
 * numbers, so a missing or wrong offset goes red.
 */
describe("#4572 retest P1-1 — the composer ends FLUSH on the keyboard (library geometry)", () => {
  // iPhone 17 Pro: 874pt screen, ~334pt keyboard (top at 540pt). The composer
  // host starts under the status bar + Ari top bar; the view's frame is
  // relative to that host and ends above the 106pt resting spacer.
  const base = {
    frameY: 560,
    frameHeight: 70,
    composerHeight: 62,
    screenHeight: 874,
    keyboardHeight: 334,
  };

  it("fails without the offset: the composer ends under the keyboard by the host's screen Y", () => {
    const gap = composerGapAboveKeyboard({ ...base, parentWindowY: 118, keyboardVerticalOffset: 0 });
    expect(gap).toBe(-118);
  });

  it.each([0, 47, 101, 118, 160])("with the host's measured window Y (%ipt) as the offset, the gap is 0", (y) => {
    const offset = composerKeyboardOffsetFor(y);
    expect(composerGapAboveKeyboard({ ...base, parentWindowY: y, keyboardVerticalOffset: offset })).toBe(0);
  });

  it("holds for Android and a small iPhone too (keyboard and screen sizes vary)", () => {
    for (const [screenHeight, keyboardHeight, y] of [
      [915, 320, 96],
      [667, 260, 64],
    ] as const) {
      const g = { ...base, frameY: screenHeight - 300, screenHeight, keyboardHeight, parentWindowY: y };
      expect(composerGapAboveKeyboard({ ...g, keyboardVerticalOffset: composerKeyboardOffsetFor(y) })).toBe(0);
    }
  });

  it("the offset is a clean non-negative number for hostile measurements", () => {
    expect(composerKeyboardOffsetFor(Number.NaN)).toBe(0);
    expect(composerKeyboardOffsetFor(-12)).toBe(0);
    expect(composerKeyboardOffsetFor(117.6)).toBe(118);
  });

  it("the screen measures the composer host in the window and hands it to the view", () => {
    expect(screen).toMatch(/<View ref=\{composerHostRef\} style=\{styles\.kav\} onLayout=\{measureComposerHost\}/);
    expect(screen).toMatch(/composerHostRef\.current\?\.measureInWindow\(/);
    expect(screen).toMatch(
      /<KeyboardAvoidingView behavior="padding" keyboardVerticalOffset=\{composerHostWindowY\}>/,
    );
  });
});
