/**
 * META-ORCH-1059 fold-in — hub tab-bar nav-lock regression.
 *
 * Root cause (proven on physical Android R58R54YV7JT 2026-06-02): the Hub tab
 * `_layout.tsx` stays MOUNTED while a hub list row pushes a route OUTSIDE the
 * hub group (e.g. /experience/{id} or, downstream, /checkout-experience/{id}).
 * Its visible-tab redirect effect read `pathname` unconditionally; when the
 * pathname was no longer `/hub/...` it fell through to `active="events"`, found
 * that an experiences-only brand's visibleTabs do NOT include "events", and
 * fired `router.replace('/(tabs)/hub/...')` — yanking the user off the pushed
 * screen mid-transition and leaving the tab navigator unresponsive (operator's
 * "swipe animates in, bounces back, nav locks").
 *
 * Fix: the redirect effect must early-return when the pathname is not a
 * `/hub/` sub-route. This source-pin fails on revert (removing the guard line
 * makes the assertion fail).
 *
 * Companion source-pins for the experiences-hub bottom-padding fix (the
 * card no longer sits under the floating absolute tab bar).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const HUB = join(__dirname, "..");

function read(rel: string): string {
  return readFileSync(join(HUB, rel), "utf8");
}

describe("META-ORCH-1059 fold-in — hub tab-bar nav-lock", () => {
  const LAYOUT = read("_layout.tsx");

  test("the visible-tab redirect effect early-returns when NOT on a /hub/ sub-route", () => {
    // The guard that prevents the layout from hijacking navigation to another
    // stack (e.g. /experience/{id}). Reverting this line re-introduces the
    // bounce-back + nav-lock.
    expect(LAYOUT).toMatch(/if\s*\(\s*!activePath\.includes\(["']\/hub\/["']\)\s*\)\s*return/);
  });

  test("the redirect only fires AFTER the /hub/ guard (guard precedes router.replace)", () => {
    const guardIdx = LAYOUT.indexOf('!activePath.includes("/hub/")');
    const replaceIdx = LAYOUT.indexOf("router.replace(`/(tabs)/hub/${initialTab}`");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(replaceIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(replaceIdx);
  });
});

describe("META-ORCH-1059 fold-in — experiences hub clears the floating tab bar", () => {
  const EXPERIENCES = read("experiences.tsx");

  test("the experiences list ScrollView pads by insets.bottom + 120 (mirror events hub)", () => {
    // Flat `paddingBottom: 120` left the only/last experience card under the
    // absolute floating BottomNav so its Pressable could not be tapped.
    expect(EXPERIENCES).toMatch(/useSafeAreaInsets/);
    expect(EXPERIENCES).toMatch(/insets\.bottom\s*\+\s*120/);
  });
});
