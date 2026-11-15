// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// MINGLA-INVARIANT: I-4430-6 | issue #4430 | program form layout height does not change while typing or when the keyboard opens
//
// Source-contract checks: render suites cannot drive a keyboard. The real proof is a person typing
// on a phone (Local review and the creator script form).
// FAILS-ON-REVERT: going back to the JS keyboard wrapper, unmounting the footer while typing, or
// dropping the always-present helper row fails here.
import { assert } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const app = new URL("../../../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, app));
const ui = read("app-mobile/src/components/programs/ProgramUi.tsx");

Deno.test("#4430 item 6: ProgramScreen scrolls through the SmartScrollView wrapper, not the JS keyboard wrapper", () => {
  assert(ui.includes("../../wrappers/SmartScrollView"), "imports the wrapper");
  assert(!ui.includes("../ui/KeyboardAwareScrollView"), "the JS wrapper is gone");
  assert(!/from '\.\.\/\.\.\/hooks\/useKeyboard'/.test(ui), "no JS keyboard listener hook");
  const native = read("app-mobile/src/wrappers/SmartScrollView.native.tsx");
  assert(native.includes("react-native-keyboard-controller") && native.includes("KEYBOARD_SCROLL_BOTTOM_OFFSET"), "native variant uses the library with the shared offset");
  assert(!read("app-mobile/src/wrappers/SmartScrollView.tsx").includes("keyboard-controller"), "web variant never loads the library");
});

Deno.test("#4430 item 6: the footer stays mounted and is only hidden while the keyboard is open", () => {
  const screen = ui.slice(ui.indexOf("export function ProgramScreen"), ui.indexOf("// ── Cards, rows, text"));
  assert(!/showFooter/.test(screen), "no showFooter conditional mount");
  assert(!/typing\s*\?\s*null|!typing\s*\?/.test(screen), "footer is not unmounted by typing");
  assert(/footer \? <View/.test(screen), "the footer node renders whenever there is a footer");
  assert(screen.includes("styles.footerHidden") && screen.includes("pointerEvents"), "hidden by opacity and pointerEvents");
  assert(/footerHidden:\s*\{\s*opacity:\s*0\s*\}/.test(ui), "footerHidden is opacity 0");
  assert(!/!showFooter && \{ paddingBottom/.test(screen), "no padding swap when the keyboard opens");
});

Deno.test("#4430 item 6: ProgramField always renders the helper row", () => {
  const field = ui.slice(ui.indexOf("export function ProgramField"), ui.indexOf("/** A dropdown-looking field"));
  assert(field.includes("styles.fieldHelp"), "helper row wrapper");
  assert(/fieldHelp:\s*\{\s*minHeight:\s*1[78]\s*\}/.test(ui), "helper row has a one-line minHeight");
  assert(!/hint \? <Text style=\{styles\.fieldHint\}>\{hint\}<\/Text> : null\}/.test(field), "no null branch for the hint row");
});

Deno.test("#4430 item 6: the shared keyboard-aware scroll view is untouched and the Explorer strict-grep root is unchanged", () => {
  const gate = read(".github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs");
  assert(gate.includes('resolve(REPO_ROOT, "mingla-business")'), "gate still scans mingla-business only");
});
