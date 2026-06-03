#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — ORCH-1040 [android-settings-modal-scroll].
 *
 * THE BUG (root-caused + measured on Pixel 8 Pro, ORCH-1040): the root Account
 * Settings sheet rendered in BaseBottomSheet with `scrollMode="scroll"` AND a
 * `header=` prop. The `header` prop routes the primitive through its
 * header-bearing branch (BaseBottomSheet.tsx:550-556), which wraps the
 * BottomSheetScrollView inside a `flex:1` BottomSheetView. On Android (gorhom
 * 5.2.8) that wrapper collapses the inner scroll viewport to content height →
 * maxScrollY = 0 → the body FREEZES. Once 2+ accordion sections are expanded the
 * content overflows the 92% sheet and the lower sections (Quiet Hours, App
 * Information, Red Zone / "Delete My Account") become permanently unreachable.
 * Proven live: 0px uiautomator bounds-delta after aggressive flings.
 *
 * THE FIX (precedent-matched — ORCH-1016 + the verified-scrolling
 * ExpandedBusinessEventSheet): make the BottomSheetScrollView the BARE DIRECT
 * CHILD of the sheet content by removing the `header=` prop from the ROOT
 * settings sheet and moving the title + close-X INTO the scroll body (the first
 * scroll child). The path then falls into the bare `case 'scroll'` branch
 * (BaseBottomSheet.tsx:558 `return scroll;`) → bounded viewport → scrolls on
 * Android. Dismissibility is preserved by gorhom's swipe-down handle
 * (enablePanDownToClose defaults true) + the close-X at scroll offset 0 (the
 * resting open position).
 *
 * SCOPE: ROOT settings sheet only. The 3 nested pickers (gender/language/
 * birthday) keep their `header=` prop — they are short, fixed-snap, and not the
 * reported bug; touching them is out of scope for ORCH-1040.
 *
 * Structural/contract test (the @gorhom/bottom-sheet host is NOT mountable in
 * this harness — same approach as the locked Wave-C Batch-2 suite). The
 * LOAD-BEARING proof is the Pixel 8 Pro bounds-delta in the implementation
 * report; this gate prevents the structural anti-pattern from silently
 * re-shipping.
 *
 * Asserts:
 *   T-1  The ROOT settings sheet uses scrollMode="scroll".
 *   T-2  The ROOT settings sheet does NOT pass a `header=` prop (the bug).
 *   T-3  The Settings title + close-X live INSIDE the scroll body (header moved in).
 *   T-4  Dismissibility preserved: the close-X onPress fires the parent onClose.
 *
 * FAILS-ON-REVERT: reverting the fix re-adds `header={...}` on the root sheet
 * (flips T-2) and removes the in-body header (flips T-3). Anchor commit recorded
 * in the implementation report.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/profile/__tests__ → repo root is 6 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

const ACCOUNT_SETTINGS = "app-mobile/src/components/profile/AccountSettings.tsx";

/** Strip comments so prose mentions of a banned token don't trip a guard. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Slice out the ROOT settings <BaseBottomSheet> opening tag (props block only),
 * i.e. from the first `<BaseBottomSheet` up to the first `>` that closes the
 * opening tag. The root sheet is the FIRST BaseBottomSheet in the file (the
 * pickers + delete dialog follow it).
 */
function rootSheetOpeningTag(c) {
  const start = c.indexOf("<BaseBottomSheet");
  assert.ok(start >= 0, "expected a <BaseBottomSheet in AccountSettings");
  // Find the end of the opening tag: the first `>` not inside a `{...}` prop.
  let depth = 0;
  for (let i = start; i < c.length; i++) {
    const ch = c[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) {
      return c.slice(start, i + 1);
    }
  }
  throw new Error("could not find end of root <BaseBottomSheet> opening tag");
}

function run() {
  const src = fs.readFileSync(path.join(REPO_ROOT, ACCOUNT_SETTINGS), "utf8");
  const c = code(src);
  const rootTag = rootSheetOpeningTag(c);

  // ── T-1: ROOT sheet uses scrollMode="scroll" ──────────────────────────────
  assert.match(
    rootTag,
    /scrollMode="scroll"/,
    'T-1: root settings sheet must use scrollMode="scroll"',
  );

  // ── T-2: ROOT sheet must NOT pass a `header=` prop (the frozen-scroll bug) ─
  assert.ok(
    !/\bheader=\{/.test(rootTag),
    "T-2: root settings sheet must NOT pass a `header=` prop — that wraps the " +
      "scroll in a flex:1 BottomSheetView and freezes the body on Android. The " +
      "scroll must be the bare direct child.",
  );

  // ── T-3: the Settings title + close-X moved INTO the scroll body ───────────
  // The header markup (settings:header title + close icon) must appear AFTER the
  // root opening tag (i.e. as scroll content), not as a `header=` prop.
  const afterRootTag = c.slice(c.indexOf(rootTag) + rootTag.length);
  assert.match(
    afterRootTag,
    /styles\.header/,
    "T-3: the header row (styles.header) must render INSIDE the scroll body " +
      "(as the first scroll child), not via the header prop",
  );
  assert.match(
    afterRootTag,
    /<Icon\s+name="close"/,
    "T-3: the close-X must render inside the scroll body",
  );

  // ── T-4: dismissibility preserved — close-X fires the parent onClose ───────
  // The close TouchableOpacity inside the body must call onClose (the parent
  // dismiss), so the sheet is still closable even though the X now scrolls.
  assert.match(
    afterRootTag,
    /onPress=\{onClose\}[\s\S]{0,400}?name="close"/,
    "T-4: the in-body close-X must call onClose (dismissibility preserved)",
  );

  console.log(
    "PASS ORCH-1040 AccountSettings bare-scroll regression suite (T-1..T-4)",
  );
}

try {
  run();
} catch (err) {
  console.error("FAIL ORCH-1040 AccountSettings bare-scroll regression suite");
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}
