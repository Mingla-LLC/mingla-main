/**
 * ORCH-1193 [venue/event sheet bottom-cutoff fix] — body-ScrollView bounded
 * WEB render-proof (implementor happy-path).
 *
 * THE BUG (Seth, business app native + business web on mobile): the venue/event
 * action sheets opened with their bottom content / primary CTA clipped off-screen
 * and unreachable. Root cause (forensics): the body <ScrollView> had NO `flex:1`
 * on its own `style` (only a contentContainerStyle) inside the fixed-height,
 * overflow:hidden SheetMobile panel, so the scroll box grew past the panel bottom
 * and there was nothing to scroll — the CTA stayed permanently off-screen. The fix
 * adds `style={styles.scrollFlex}` (flex:1) to bound the scroll viewport to the
 * panel (and switches the import to wrappers/SmartScrollView for keyboard
 * clearance — covered separately by the orch-1193 strict-grep gate).
 *
 * WHY A WEB RENDER (not a native render config): react-native-web is the deployed
 * business web target AND compiles a `StyleSheet.create` `flex:1` rule to the
 * deterministic atomic class `r-flex-13awgt0` on the ScrollView's outer div — the
 * exact DOM Vercel emits. The unfixed component (no `style` on the body
 * ScrollView) emits NO flex class on the scroll container, which is precisely the
 * unbounded box that overflows the panel. Asserting the flex class is present on
 * the ScrollView container proves the body scroll viewport is bounded to the
 * panel and the CTA is reachable/scrollable.
 *
 * We stub the heavy children (Sheet primitive's reanimated/gesture-handler panel,
 * Button/Input/ConfirmDialog/BrandSwitch — which render their own native-only
 * trees, and Input even nests its own ScrollView) down to plain elements. After
 * stubbing, the ONLY element in the rendered tree that carries a `flex:1` inline
 * style is the body ScrollView under test — so the assertion is unambiguous.
 *
 * FAILS-ON-REVERT (verified by TRUE LINE-DELETION of the fix, NOT a comment-out):
 *   delete `style={styles.scrollFlex}` from the body ScrollView in
 *   VenueTableSheet.tsx → the `flex:1` inline style disappears from the render →
 *   the assertion FAILS.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest \
 *     --config jest.orch1193.sheetscroll.web.render.cjs --runInBand
 */

import React from "react";
import ReactDOMServer from "react-dom/server";

// Sheet primitive's panel uses reanimated + gesture-handler (native worklets,
// absent under jest) and is NOT the element under assertion. Render it as a
// passthrough so its child body View + body ScrollView render through
// react-native-web's real style compiler.
jest.mock("../../ui/Sheet", () => {
  const React = require("react");
  const Sheet = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return { Sheet, default: Sheet };
});

// Button pulls in reanimated/expo-haptics; stub to plain Text (it is the CTA but
// the element under assertion is the SCROLL CONTAINER's flex:1, not the button).
jest.mock("../../ui/Button", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const Button = ({ label }: { label?: string }) =>
    React.createElement(Text, null, label ?? "");
  return { Button, default: Button };
});

// Input nests its OWN ScrollView (suggestion list) — stub to plain Text so the
// only flex:1 inline style left in the tree is the body ScrollView under test.
jest.mock("../../ui/Input", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const Input = () => React.createElement(Text, null, "");
  return { Input, default: Input };
});

jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../ui/BrandSwitch", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const BrandSwitch = () => React.createElement(Text, null, "");
  return { BrandSwitch, default: BrandSwitch };
});

import { VenueTableSheet } from "../VenueTableSheet";

function renderHtml(node: React.ReactElement): string {
  return ReactDOMServer.renderToStaticMarkup(node);
}

// react-native-web compiles a `StyleSheet.create` `flex:1` rule to this
// deterministic atomic class. A ScrollView outer div is identifiable by the
// react-native-web scroll signature class `r-WebkitOverflowScrolling-150rngu`.
const FLEX_1 = "r-flex-13awgt0";
const SCROLLVIEW_SIG = "r-WebkitOverflowScrolling-150rngu";

describe("ORCH-1193 — venue/event sheet body ScrollView is flex-bounded on WEB", () => {
  it("VenueTableSheet body ScrollView renders flex-bounded (so the CTA is reachable, not clipped)", () => {
    const html = renderHtml(
      <VenueTableSheet
        visible
        onClose={() => undefined}
        table={null}
        onSave={() => undefined}
        saving={false}
      />,
    );
    // The sheet actually rendered its body (the "Add table" heading + the CTA).
    expect(html).toContain("Add table");

    // Isolate the ScrollView container's class attribute and assert it carries the
    // flex:1 atomic class. Unfixed (no `style={styles.scrollFlex}` on the body
    // ScrollView) → the scroll container div carries NO flex class and the box
    // overflows the fixed-height overflow:hidden panel, clipping the CTA. The flex
    // class on the SCROLL CONTAINER ⇔ the fix is in place and the viewport is
    // bounded to the panel.
    const sigIdx = html.indexOf(SCROLLVIEW_SIG);
    expect(sigIdx).toBeGreaterThan(-1);
    // The class list is the attribute value containing the signature; grab it.
    const before = html.lastIndexOf('class="', sigIdx);
    const after = html.indexOf('"', sigIdx);
    const scrollClassList = html.slice(before + 'class="'.length, after);
    expect(scrollClassList).toContain(SCROLLVIEW_SIG);
    expect(scrollClassList).toContain(FLEX_1);
  });
});
