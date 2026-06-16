#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — ORCH-1138 [detail-sheet-behind-discover-header].
 *
 * THE BUG: opening a TRIP or EVENT detail from the Discover deck opened the new
 * foundation detail sheet, but its TOP (cover media + the X / Share / Mute
 * OfferingChrome) rendered UNDERNEATH the Discover screen header ("Discover"
 * title + Events/Trips pills + filter row). Root cause: both detail screens mount
 * the shared `BaseBottomSheet` WITHOUT `wrapInRNModal`, so the primitive renders
 * its absolutely-positioned `inlineContainer` host as a SIBLING of the host
 * screen's chrome. `DiscoverScreen.headerPanel` is `zIndex: 50`; the inline host
 * had NO zIndex (→ auto/0). RN scopes zIndex to siblings, so the header painted
 * OVER the top of the sheet.
 *
 * THE FIX: `BaseBottomSheet.styles.inlineContainer` now carries `zIndex: 100` +
 * `elevation: 100` — above ALL in-tree screen chrome (Discover header + floating
 * GlassBottomNav are both 50) and BELOW the global Toast layer (zIndex: 9999),
 * which must keep floating over an open sheet. Layering only — the inline host's
 * height (the ORCH-1016/1043 viewport invariant) is untouched.
 *
 * Structural source-assertion test (the @gorhom host is not mountable in this
 * harness — same approach as BaseBottomSheet.test.mjs / NotificationsSheet).
 *
 * FAILS-ON-REVERT: deleting the `zIndex: 100` / `elevation: 100` lines from
 * `inlineContainer` (true line deletion → back to the unset/auto z value) flips
 * T1/T2 → this suite FAILS. The header-beats-sheet relation (T3) also fails.
 * Verified by line-deletion (see implementation report).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/ui/__tests__ → repo root is 6 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

const baseSheetSrc = read("app-mobile/src/components/ui/BaseBottomSheet.tsx");
const discoverSrc = read("app-mobile/src/components/DiscoverScreen.tsx");
const toastSrc = read("app-mobile/src/components/ui/Toast.tsx");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// Extract a numeric style prop value from a named StyleSheet block.
function styleNum(src, block, prop) {
  const blockMatch = src.match(
    new RegExp(`${block}:\\s*\\{([\\s\\S]*?)\\n\\s{2}\\},`),
  );
  if (blockMatch === null) return null;
  const m = blockMatch[1].match(new RegExp(`${prop}:\\s*(\\d+)`));
  return m === null ? null : Number(m[1]);
}

// ── The inline-host z-layer (the fix). ──────────────────────────────────────
const inlineZ = styleNum(baseSheetSrc, "inlineContainer", "zIndex");
const inlineElev = styleNum(baseSheetSrc, "inlineContainer", "elevation");

ok(
  "T1 BaseBottomSheet.inlineContainer sets an explicit zIndex (iOS sibling order)",
  inlineZ !== null,
  "without zIndex the inline host resolves to auto(0) and loses to the Discover header",
);
ok(
  "T1b BaseBottomSheet.inlineContainer sets an explicit elevation (Android stacking)",
  inlineElev !== null,
);

// ── The Discover header z (the occluder). ───────────────────────────────────
const headerZ = styleNum(discoverSrc, "headerPanel", "zIndex");
ok("T2 DiscoverScreen.headerPanel has a zIndex (sanity)", headerZ !== null);

ok(
  "T3 the detail sheet inline host out-layers the Discover header (zIndex)",
  inlineZ !== null && headerZ !== null && inlineZ > headerZ,
  `inline host zIndex (${inlineZ}) must be > Discover headerPanel zIndex (${headerZ})`,
);
ok(
  "T3b the detail sheet inline host out-layers the Discover header (Android elevation)",
  inlineElev !== null && headerZ !== null && inlineElev > headerZ,
  `inline host elevation (${inlineElev}) must be > Discover headerPanel zIndex (${headerZ})`,
);

// ── The Toast layer must STILL float over an open sheet. ─────────────────────
const toastZ = styleNum(toastSrc, "container", "zIndex");
ok("T4 Toast.container has a zIndex (sanity)", toastZ !== null);
ok(
  "T4b the detail sheet inline host stays BELOW the global Toast layer",
  inlineZ !== null && toastZ !== null && inlineZ < toastZ,
  `inline host zIndex (${inlineZ}) must remain < Toast zIndex (${toastZ}) so toasts float over the sheet`,
);

// ── Swipe-down-dismiss + scroll viewport invariants are untouched. ──────────
ok(
  "T5 enablePanDownToClose still defaults true (swipe-down-dismiss preserved)",
  /enablePanDownToClose\s*=\s*true/.test(baseSheetSrc),
);
ok(
  "T6 the inline host height model is unchanged (ORCH-1016/1043 viewport invariant)",
  /height:\s*inlineContainerHeight/.test(baseSheetSrc) &&
    /inlineContainerHeight\s*=\s*windowHeight\s*\+\s*Math\.max/.test(
      baseSheetSrc,
    ),
  "the layering fix must not touch the inline host height (would re-collapse scroll)",
);

console.log(
  `\n${passed} assertions passed (ORCH-1138 detail-sheet z-layer above Discover header).`,
);
