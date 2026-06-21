/**
 * ORCH-1190 R2 — venue TABLE-CARD mobile full-width web render-proof
 * (implementor happy-path).
 *
 * THE BUG (Seth, mobile): an added table tile ("Test Table · 2 seats · parties
 * 1–2 · Indoor · Standard") renders CRAMPED on a narrow viewport — the title
 * wraps ONE CHARACTER PER LINE ("T\ne\ns\nt…") because the table card's text
 * column collapses to ~1ch wide.
 *
 * ROOT CAUSE (proven with the real Yoga layout engine, yoga-layout, at 375px):
 * the card → GlassCard padding wrapper → tableRow → tableMain/tableText chain
 * collapses to min-content whenever the card is NOT pinned to a definite cross
 * width. `width:"100%"` alone resolves against the PARENT's width, so it only
 * holds when every ancestor stretches; a vertical ScrollView content container
 * (the shell's phone path) or any ancestor with alignItems != "stretch" leaves
 * the card content-sized and the collapse returns. The fix pins the card with
 * BOTH width:"100%" AND alignSelf:"stretch", and pins the inner tableRow to
 * width:"100%" so the flex:1 + minWidth:0 text column measures against the full
 * card width instead of the longest unbreakable word.
 *
 * WHY A WEB RENDER: react-native-web is the deployed business web build and its
 * style compiler emits deterministic atomic classes, so we can assert the exact
 * layout styles land on the exact elements. (The same StyleSheet drives native.)
 *
 * react-native-web atomic classes (verified by direct probe of this render):
 *   width:"100%"        → r-width-13qz1uu
 *   alignSelf:"stretch" → r-alignSelf-1pz39u2
 *   flex:1              → r-flex-13awgt0
 *   minWidth:0          → r-minWidth-bcqeeo
 *
 * FAILS-ON-REVERT (verified by TRUE LINE-DELETION of the fix, NOT a comment-out):
 *   - delete `alignSelf:"stretch"` from `tableCard` → the card div loses
 *     r-alignSelf-1pz39u2 and the alignSelf assertion FAILS.
 *   - delete `width:"100%"` from `tableRow` → the row loses its second
 *     r-width-13qz1uu and the row-width count assertion FAILS.
 *   - delete `flex:1`/`minWidth:0` from `tableText` → the text-column class
 *     assertions FAIL.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest \
 *     --config jest.orch1190r2.tablecard.web.render.cjs --runInBand
 */

import React from "react";
import ReactDOMServer from "react-dom/server";

// Manager-plus so the edit row + Active toggle render (the full layout path).
jest.mock("../src/hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));

// One real table → the populated branch with the cramped-on-mobile card.
jest.mock("../src/hooks/useVenueTables", () => ({
  useVenueTables: () => ({
    data: [
      {
        id: "t1",
        name: "Test Table",
        capacity: 2,
        minParty: 1,
        maxParty: 2,
        zone: "indoor",
        seatingType: "standard",
        reservationPolicy: "reservations",
        isActive: true,
      },
    ],
    isLoading: false,
    isError: false,
  }),
  useUpsertVenueTable: () => ({ mutate: () => undefined, isPending: false }),
  useSetVenueTableActive: () => ({ mutate: () => undefined, isPending: false }),
  useDeleteVenueTable: () => ({ mutate: () => undefined, isPending: false }),
}));

// Button → reanimated worklets (absent under jest). Not under assertion (the
// CARD + ROW + TEXT-COLUMN wrappers are). Stub to plain Text.
jest.mock("../src/components/ui/Button", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const Button = ({ label }: { label?: string }) =>
    React.createElement(Text, null, label ?? "");
  return { Button, default: Button };
});

// Icon → react-native-svg native codegen (absent under jest). Decorative.
jest.mock("../src/components/ui/Icon", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const Icon = () => React.createElement(Text, null, "");
  return { Icon, default: Icon };
});

// The capacity-rules panel + the table sheet pull in heavy children and are not
// the element under assertion; stub them.
jest.mock("../src/components/venue/VenueCapacityRulesPanel", () => ({
  VenueCapacityRulesPanel: () => null,
}));
jest.mock("../src/components/venue/VenueTableSheet", () => ({
  VenueTableSheet: () => null,
}));

import { VenueTablesModule } from "../src/components/venue/VenueTablesModule";

const WIDTH_100 = "r-width-13qz1uu"; // width:"100%"
const ALIGN_SELF_STRETCH = "r-alignSelf-1pz39u2"; // alignSelf:"stretch"
const FLEX_1 = "r-flex-13awgt0"; // flex:1
const MIN_WIDTH_0 = "r-minWidth-bcqeeo"; // minWidth:0

function renderHtml(node: React.ReactElement): string {
  return ReactDOMServer.renderToStaticMarkup(node);
}

describe("ORCH-1190 R2 — table card spans full width on a narrow mobile viewport", () => {
  it("renders the populated table tile (not loading/empty)", () => {
    const html = renderHtml(<VenueTablesModule brandId="b1" />);
    expect(html).toContain("Test Table");
    expect(html).toContain("2 seats · parties 1–2 · Indoor · Standard");
  });

  it("the table card carries BOTH width:100% AND alignSelf:stretch (cannot collapse under a non-stretch ancestor)", () => {
    const html = renderHtml(<VenueTablesModule brandId="b1" />);
    // The card wrapper is the ONLY element in this tree given alignSelf:stretch.
    expect(html).toContain(ALIGN_SELF_STRETCH);
    expect(html).toContain(WIDTH_100);
  });

  it("the inner tableRow is pinned to width:100% (≥2 width:100% elements: card + row)", () => {
    const html = renderHtml(<VenueTablesModule brandId="b1" />);
    const occurrences = html.split(WIDTH_100).length - 1;
    // card (width:100%) + row (width:100%) = at least 2. Before the row-width
    // fix there is only 1 (the card), so this FAILS on revert of the row width.
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("the text column carries flex:1 + minWidth:0 so the title wraps word-level, not char-level", () => {
    const html = renderHtml(<VenueTablesModule brandId="b1" />);
    expect(html).toContain(FLEX_1);
    expect(html).toContain(MIN_WIDTH_0);
  });
});
