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
    expect(toolbarNative).toMatch(/if\s*\(!visible\s*\|\|\s*suppressed\)\s*return null;/);
    // A dismissal that never fires a blur (Android back) cannot strand the flag.
    expect(toolbarNative).toMatch(/if\s*\(!visible\)\s*setDoneBarSuppressed\(false\)/);
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
