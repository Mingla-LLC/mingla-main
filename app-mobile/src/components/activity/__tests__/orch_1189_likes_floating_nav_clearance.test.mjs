#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1189 — consumer-app floating-nav "black bar" (LikesPage / Saved + Calendar).
 *
 * Source-structural contract test (the screens are not mountable in this harness;
 * mirrors the BaseBottomSheet.test.mjs approach). Asserts the load-bearing FIX-1
 * contract:
 *
 *   ROOT CAUSE: LikesPage's `content` View carried `paddingBottom:
 *   bottomNavTotalHeight + 16`, which SHRANK the ScrollView frame upward and
 *   exposed the black app-root background (#000/#0c0e12) below it as a "black
 *   bar" under the floating GlassBottomNav.
 *
 *   FIX (mirrors ConnectionsPage): the `content` View keeps paddingTop ONLY (no
 *   frame-shrinking paddingBottom) so it paints full-bleed to the screen bottom;
 *   the floating-nav clearance is threaded down as `bottomNavTotalHeight` and
 *   applied on EACH tab's INNER scroll `contentContainerStyle.paddingBottom`
 *   (= bottomNavTotalHeight + 24).
 *
 *   T-1  LikesPage's `content` View has paddingTop but NO `paddingBottom:` driven
 *        by bottomNavTotalHeight (no frame-shrinking pad on the content frame).
 *   T-2  LikesPage threads `bottomNavTotalHeight` into BOTH SavedTab + CalendarTab.
 *   T-3  SavedTab declares the `bottomNavTotalHeight` prop and applies
 *        `bottomNavTotalHeight + 24` to its mainScrollContent paddingBottom.
 *   T-4  CalendarTab declares the `bottomNavTotalHeight` prop and applies
 *        `bottomNavTotalHeight + 24` to its mainScrollContent paddingBottom.
 *
 * FAILS-ON-REVERT: restoring `paddingBottom: bottomNavTotalHeight + 16` on the
 * LikesPage `content` View flips T-1; dropping the prop threading flips T-2;
 * reverting either tab's scroll padding to the old static `paddingBottom: 100`
 * flips T-3 / T-4.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/activity/__tests__ → repo root is 6 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

function run() {
  const likes = read("app-mobile/src/components/LikesPage.tsx");
  const saved = read("app-mobile/src/components/activity/SavedTab.tsx");
  const calendar = read("app-mobile/src/components/activity/CalendarTab.tsx");

  // ── T-1: LikesPage `content` View carries NO frame-shrinking paddingBottom ──
  // The whole point of the fix: the content frame must reach the physical screen
  // bottom (covering the black root). A `paddingBottom: bottomNavTotalHeight ...`
  // on the content style would lift the frame and re-expose the black bar.
  assert.doesNotMatch(
    likes,
    /paddingBottom:\s*bottomNavTotalHeight/,
    "T-1 LikesPage must NOT shrink the content frame with a bottomNavTotalHeight paddingBottom",
  );
  // It must still apply the header clearance (paddingTop) on that content View.
  assert.match(
    likes,
    /paddingTop:\s*HEADER_PANEL_HEIGHT/,
    "T-1 LikesPage content keeps the header paddingTop",
  );

  // ── T-2: LikesPage threads bottomNavTotalHeight into BOTH tabs ──────────────
  const savedProps = likes.slice(
    likes.indexOf("<SavedTab"),
    likes.indexOf("/>", likes.indexOf("<SavedTab")),
  );
  assert.match(
    savedProps,
    /bottomNavTotalHeight=\{bottomNavTotalHeight\}/,
    "T-2 LikesPage passes bottomNavTotalHeight to SavedTab",
  );
  const calProps = likes.slice(
    likes.indexOf("<CalendarTab"),
    likes.indexOf("/>", likes.indexOf("<CalendarTab")),
  );
  assert.match(
    calProps,
    /bottomNavTotalHeight=\{bottomNavTotalHeight\}/,
    "T-2 LikesPage passes bottomNavTotalHeight to CalendarTab",
  );

  // ── T-3: SavedTab declares the prop + applies the inner clearance ───────────
  assert.match(
    saved,
    /bottomNavTotalHeight\?:\s*number/,
    "T-3 SavedTab declares the bottomNavTotalHeight prop",
  );
  assert.match(
    saved,
    /mainScrollContent:\s*\{[\s\S]*?paddingBottom:\s*bottomNavTotalHeight\s*\+\s*24/,
    "T-3 SavedTab applies bottomNavTotalHeight + 24 to mainScrollContent",
  );

  // ── T-4: CalendarTab declares the prop + applies the inner clearance ────────
  assert.match(
    calendar,
    /bottomNavTotalHeight\?:\s*number/,
    "T-4 CalendarTab declares the bottomNavTotalHeight prop",
  );
  assert.match(
    calendar,
    /mainScrollContent:\s*\{[\s\S]*?paddingBottom:\s*bottomNavTotalHeight\s*\+\s*24/,
    "T-4 CalendarTab applies bottomNavTotalHeight + 24 to mainScrollContent",
  );

  console.log("ORCH-1189 LikesPage floating-nav clearance contract: PASS (T-1..T-4)");
}

run();
