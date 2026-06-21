/**
 * ORCH-1190 R2 — BrandSwitch WEB render-proof (implementor happy-path).
 *
 * THE R1 BLIND SPOT this closes:
 *   The shipped ORCH-1190 #3 test (venueSuitePolish.orch1190.test.ts) is pure
 *   SOURCE-TEXT assertion (it greps BrandSwitch.tsx for `accent.warm` and proves
 *   no bare `<Switch>` survives) AND every other venue render test runs on the
 *   `ios` jest platform. NONE of them render BrandSwitch on the WEB target. So
 *   the prod web bug went undetected: react-native-web's `Switch` paints the
 *   ON-state THUMB from `activeThumbColor` (default `#009688`, teal-green) and
 *   the ON-state TRACK from `activeTrackColor` (default `#A3D3CF`) — props the R1
 *   BrandSwitch never set. On business.usemingla.com the handle rendered
 *   teal-green when ON (the off-brand toggle Seth flagged) while every native
 *   render test stayed green (native uses one `thumbColor` for both states).
 *
 * This test renders the REAL `<BrandSwitch>` through `react-native-web`'s actual
 * `Switch` (via ReactDOMServer) — the exact DOM the deployed Vercel build emits —
 * and asserts the rendered INLINE colors:
 *   - ON  state: track = brand orange #eb7825, thumb = WHITE (never teal #009688)
 *   - OFF state: thumb = WHITE
 *
 * FAILS-ON-REVERT (verified by TRUE LINE-DELETION of the fix, NOT a comment-out):
 *   delete the `activeThumbColor: THUMB` / `activeTrackColor: ON_TRACK` web-extra
 *   lines from BrandSwitch.tsx → the ON-state thumb reverts to teal `#009688`
 *   and this test's "thumb is white when ON" assertion FAILS.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest \
 *     --config jest.orch1190r2.web.render.cjs --runInBand
 */

import React from "react";
import ReactDOMServer from "react-dom/server";

import { BrandSwitch } from "../BrandSwitch";

// react-native is aliased to react-native-web by the dedicated jest config, so
// `BrandSwitch` (which imports `Switch` from "react-native") renders the WEB
// Switch — the same component the deployed business web build ships.

const TEAL_GREEN = /rgba\(0,\s*150,\s*136/; // react-native-web default #009688
const WHITE = /rgba\(255,\s*255,\s*255,\s*1/;
const BRAND_ORANGE = /rgba\(235,\s*120,\s*37/; // #eb7825

/**
 * react-native-web's Switch emits two leading in-flow color divs: [0] = track,
 * [1] = thumb. Pull their inline `background-color` values in order.
 */
function trackAndThumb(value: boolean): { track: string; thumb: string } {
  const html = ReactDOMServer.renderToStaticMarkup(
    <BrandSwitch value={value} onValueChange={() => undefined} />,
  );
  const colors = [...html.matchAll(/background-color:(rgba\([^)]+\))/g)].map(
    (m) => m[1],
  );
  return { track: colors[0] ?? "", thumb: colors[1] ?? "" };
}

describe("ORCH-1190 R2 — BrandSwitch renders brand colors on WEB (no teal handle)", () => {
  it("ON-state: track is brand orange, handle is WHITE (never the native teal)", () => {
    const { track, thumb } = trackAndThumb(true);
    expect(track).toMatch(BRAND_ORANGE);
    // The bug: this thumb was rgba(0,150,136) teal-green on web.
    expect(thumb).not.toMatch(TEAL_GREEN);
    expect(thumb).toMatch(WHITE);
  });

  it("OFF-state: handle is WHITE", () => {
    const { thumb } = trackAndThumb(false);
    expect(thumb).toMatch(WHITE);
    expect(thumb).not.toMatch(TEAL_GREEN);
  });
});
