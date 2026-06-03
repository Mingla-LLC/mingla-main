#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ADVERSARIAL regression suite — ORCH-1040 [android-settings-modal-scroll].
 *
 * Authored by mingla-tester (Step-0.5(b)). DIFFERENT ANGLE than the implementor's
 * happy-path suite (orch_1040_account_settings_bare_scroll.test.mjs).
 *
 * ── Why a second suite? ────────────────────────────────────────────────────
 * The implementor's T-2 guards exactly ONE freeze trigger: a literal `header={`
 * on the root sheet. But the Android-freeze root cause is broader than that one
 * token. In BaseBottomSheet's `scrollMode="scroll"` branch the BottomSheetScrollView
 * is ONLY the bare direct child (`return scroll;`, the path that scrolls on
 * Android) when NONE of the wrapper-routing props are present. Several DIFFERENT
 * props re-introduce the SAME `flex:1 BottomSheetView` wrapper that collapses the
 * Android scroll viewport to content height (maxScrollY = 0 → frozen body):
 *
 *   • `header=`       → scroll branch wraps in flex:1 BottomSheetView (the original bug)
 *   • `stickyFooter=` → routes to the sticky branch (flex:1 stickyContainer wrapper)
 *   • `stickyHeader=` → same sticky branch
 *
 * A reviewer "restoring a pinned title" via `stickyHeader`/`stickyFooter`, or a
 * future merge re-adding a pinned footer CTA, would NOT trip the implementor's
 * `header={`-only guard yet would re-freeze the body on Android exactly as before.
 * This suite asserts the broader INVARIANT (no wrapper-routing prop on the root
 * sheet) so ANY re-freeze path is caught, not just the one token.
 *
 * It also asserts the POSITIONAL invariant the happy-path suite does not: the
 * relocated header must be the FIRST node inside the sheet (bare direct child of
 * the scroll), rendered BEFORE the first AccordionCard — proving the title/close-X
 * actually moved into the scroll body at offset 0 rather than merely existing
 * somewhere in the file.
 *
 * SCOPE: ROOT settings sheet ONLY. The 3 nested pickers keep their `header=` prop
 * (short, fixed-snap, out of scope for ORCH-1040). This suite deliberately scopes
 * its assertions to the FIRST <BaseBottomSheet> opening tag so it never trips on
 * the pickers' legitimate header props.
 *
 * Structural/contract test (the @gorhom/bottom-sheet host is not mountable in this
 * harness; the load-bearing proof is the live Pixel 8 Pro + emulator bounds-delta
 * in the QA report). This gate prevents the structural anti-pattern from silently
 * re-shipping through a path the happy-path suite misses.
 *
 * Asserts:
 *   A-1  Root sheet passes NO `header=` prop (defense-in-depth w/ implementor T-2).
 *   A-2  Root sheet passes NO `stickyFooter=` prop (alternate Android-freeze route).
 *   A-3  Root sheet passes NO `stickyHeader=` prop (alternate Android-freeze route).
 *   A-4  Root sheet still uses scrollMode="scroll" (a "view"/flatlist swap would
 *        change the freeze analysis silently; pin the mode this suite reasons about).
 *   A-5  POSITIONAL: the relocated header row (styles.header) appears BEFORE the
 *        first <AccordionCard in the sheet body — i.e. it is the first scroll child.
 *
 * FAILS-ON-REVERT: reverting the fix re-adds `header={...}` on the root sheet
 * (flips A-1) and removes the in-body header before the first AccordionCard
 * (flips A-5).
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

/** The ROOT settings sheet opening tag (props block) — first <BaseBottomSheet. */
function rootSheetOpeningTag(c) {
  const start = c.indexOf("<BaseBottomSheet");
  assert.ok(start >= 0, "expected a <BaseBottomSheet in AccountSettings");
  let depth = 0;
  for (let i = start; i < c.length; i++) {
    const ch = c[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return c.slice(start, i + 1);
  }
  throw new Error("could not find end of root <BaseBottomSheet> opening tag");
}

function run() {
  const src = fs.readFileSync(path.join(REPO_ROOT, ACCOUNT_SETTINGS), "utf8");
  const c = code(src);
  const rootTag = rootSheetOpeningTag(c);

  // ── A-1: no `header=` prop on the root sheet (the original freeze trigger) ──
  assert.ok(
    !/\bheader=/.test(rootTag),
    "A-1: root settings sheet must NOT pass a `header=` prop — it re-wraps the " +
      "scroll in a flex:1 BottomSheetView and freezes the body on Android.",
  );

  // ── A-2: no `stickyFooter=` — ALTERNATE freeze route the happy-path test misses ─
  assert.ok(
    !/\bstickyFooter=/.test(rootTag),
    "A-2: root settings sheet must NOT pass a `stickyFooter=` prop — it routes " +
      "BaseBottomSheet through the sticky branch (flex:1 stickyContainer wrapper), " +
      "re-collapsing the Android scroll viewport the same way `header=` did.",
  );

  // ── A-3: no `stickyHeader=` — ALTERNATE freeze route ───────────────────────
  assert.ok(
    !/\bstickyHeader=/.test(rootTag),
    "A-3: root settings sheet must NOT pass a `stickyHeader=` prop — same sticky " +
      "branch flex:1 wrapper, re-freezes the body on Android.",
  );

  // ── A-4: scrollMode pinned to "scroll" (the mode this freeze analysis covers) ─
  assert.match(
    rootTag,
    /scrollMode="scroll"/,
    'A-4: root settings sheet must keep scrollMode="scroll"; a silent swap to ' +
      '"view"/"flatlist" changes the bare-direct-child analysis this guard relies on.',
  );

  // ── A-5: POSITIONAL — relocated header is the FIRST scroll child ────────────
  // Inside the sheet body, the header row (styles.header) must appear BEFORE the
  // first <AccordionCard. Proves the title/close-X actually moved to scroll
  // offset 0 (the resting open position), not merely that they exist in the file.
  const bodyStart = c.indexOf(rootTag) + rootTag.length;
  const body = c.slice(bodyStart);
  const headerIdx = body.indexOf("styles.header");
  const firstAccordionIdx = body.indexOf("<AccordionCard");
  assert.ok(
    headerIdx >= 0,
    "A-5: the relocated header row (styles.header) must render inside the sheet body",
  );
  assert.ok(
    firstAccordionIdx >= 0,
    "A-5: expected at least one <AccordionCard in the sheet body",
  );
  assert.ok(
    headerIdx < firstAccordionIdx,
    "A-5: the header row (title + close-X) must be the FIRST scroll child — it " +
      "must appear BEFORE the first <AccordionCard so it sits at scroll offset 0.",
  );

  console.log(
    "PASS ORCH-1040 AccountSettings no-freeze-wrapper ADVERSARIAL suite (A-1..A-5)",
  );
}

try {
  run();
} catch (err) {
  console.error("FAIL ORCH-1040 AccountSettings no-freeze-wrapper ADVERSARIAL suite");
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}
