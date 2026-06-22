/**
 * ORCH-1190 (attempt #5, the one that actually fixed it) — GlassChrome inner
 * surface MUST stretch to its outer View's width.
 *
 * THE BUG (4 prior fixes failed). On business.usemingla.com desktop, the venue
 * suite empty-state cards (Reservations / Waitlist / Menu) rendered NARROW +
 * CENTERED while the module header + Tables card rendered full workspace width.
 * R1–R4 all put `width:"100%"` / `alignSelf:"stretch"` on the empty CARD's outer
 * View — but the outer View was ALREADY full-width. The collapse happened ONE
 * layer deeper, inside the shared GlassChrome primitive.
 *
 * DETERMINISTIC PROOF (real Chromium, real react-native-web 0.21.2 layout — NOT
 * jsdom, which has no flexbox engine and false-greened the prior 4 fixes). A
 * Playwright harness mounted the REAL `VenueSuiteShell` desktop path inside the
 * REAL ancestor chain (DesktopCanvas → hub host → Slot → module) at 1440×900 and
 * walked the DOM. Measured widths of the empty card's GlassChrome `clip` layer
 * (the visible glass surface):
 *
 *   module        outer card   clip surface (BEFORE)   clip surface (AFTER)
 *   reservations  1132px       496px  (narrow!)        1132px (full)
 *   waitlist      1132px       553px  (narrow!)        1132px (full)
 *   menu          1132px       528px  (narrow!)        1132px (full)
 *
 * ROOT CAUSE. `GlassChrome`'s `clip` and `content` Views had NO width/alignSelf.
 * On RNW a width-less child View shrinks to its content's min-content width. The
 * venue empty cards set `alignItems:"center"` on the OUTER View, which then ALSO
 * centered that shrunken glass surface → a full-width invisible box wrapping a
 * narrow centered visible card. Exactly Seth's symptom.
 *
 * THE FIX. `clip` + `content` get `alignSelf:"stretch"` so the visible glass
 * surface always fills its outer View's resolved width — full-width for the venue
 * cards, and still content-width for intrinsically-sized chrome pills (their
 * outer View is content-sized, so stretch matches that small width). Universally
 * correct, fixes all three modules at the shared primitive.
 *
 * WHAT THIS TEST ASSERTS (deterministic, fails-on-revert). Rendering GlassChrome
 * through react-native-web's REAL atomic-class compiler (ReactDOMServer = the
 * exact classes Vercel ships), the compiled output carries the RNW
 * `alignSelf:"stretch"` atom (`r-alignSelf-1pz39u2`) on the inner glass layers.
 * The atom appears AT LEAST TWICE (clip + content). Delete the `alignSelf` line
 * from EITHER `clip` or `content` in GlassChrome → the atom count drops below the
 * floor → this test FAILS (the regression returns). NEW FILE — no prior contract
 * modified.
 *
 * Run:
 *   cd mingla-business && npx jest \
 *     glassChromeFullWidthSurface.orch1190.web.render --runInBand
 */

import React from "react";
import { Text } from "react-native";
import ReactDOMServer from "react-dom/server";

import { GlassChrome } from "../GlassChrome";

// react-native-web's deterministic atomic class for `alignSelf: "stretch"`.
// (Same atom the venue R-tests already key off; stable across an RNW version.)
const ALIGN_SELF_STRETCH_ATOM = "r-alignSelf-1pz39u2";

function renderHtml(): string {
  return ReactDOMServer.renderToStaticMarkup(
    <GlassChrome testID="probe">
      <Text>x</Text>
    </GlassChrome>,
  );
}

describe("ORCH-1190 — GlassChrome inner glass surface stretches full-width", () => {
  test("clip + content layers both carry alignSelf:stretch (fails-on-revert)", () => {
    const html = renderHtml();
    const occurrences = html.split(ALIGN_SELF_STRETCH_ATOM).length - 1;
    // clip View + content View = 2 inner layers that must stretch. The outer
    // View does not carry it (it is sized by its parent / its own style prop),
    // so the floor is exactly the two inner layers.
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  test("the rendered tree actually mounted (guards against an empty render)", () => {
    const html = renderHtml();
    expect(html).toContain("probe");
    expect(html.length).toBeGreaterThan(50);
  });
});
