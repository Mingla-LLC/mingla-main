/**
 * ORCH-1190 R3 — venue empty-state FULL-WIDTH web render-proof (implementor
 * happy-path), the ROBUST contract.
 *
 * BACKGROUND. R2 added `width:"100%"` + `alignSelf:"stretch"` to the empty-state
 * cards and proved it with a jsdom class-presence test that PASSED — yet the live
 * business web still rendered the Reservations / Waitlist / Menu empty card NARROW
 * and centered (Seth, fresh Chrome, not a cache issue).
 *
 * ROOT CAUSE (proven empirically with Playwright + real react-native-web — see
 * Mingla_Artifacts/reports/IMPLEMENT_ORCH-1190-FULLWIDTH-WEB.md): an explicit
 * `width:"100%"` resolves against the parent's content-box width and, when a flex
 * ancestor leaves that width indefinite, an explicit main-size can DEFEAT
 * `alignSelf:"stretch"` (CSS flexbox: a definite cross/main size overrides
 * stretch). `width:"100%"` is therefore the FRAGILE property, not the fix.
 *
 * THE R3 FIX. Each empty/skeleton card is wrapped in a stretching WRAPPER
 * (`alignSelf:"stretch"`) and the card stretches via `alignSelf:"stretch"` with
 * NO `width:"100%"`. Verified full-width in real Chromium RNW across definite-
 * width parents, indefinite-width (align-items:flex-start) ancestors, and wide-
 * sibling columns (the report's measurement matrix).
 *
 * WHAT THIS TEST ASSERTS. Rendering the REAL module empty states through
 * react-native-web's actual style compiler (ReactDOMServer = the exact atomic
 * classes Vercel emits), the empty-state output:
 *   (a) carries the compiled `alignSelf:"stretch"` class (`r-alignSelf-1pz39u2`)
 *       — the stretching wrapper + card; AND
 *   (b) the empty state actually rendered (the empty branch, not loading/populated).
 * Class atoms are deterministic in RNW and are a reliable static contract (the
 * jsdom UNRELIABILITY was about computed LAYOUT geometry, which this test does NOT
 * rely on — the geometry proof lives in the Playwright report).
 *
 * FAILS-ON-REVERT (verified by TRUE LINE-DELETION, NOT a comment-out): delete the
 * `emptyWrap: { alignSelf: "stretch" }` style + its wrapper <View> from a module
 * → the wrapper's `r-alignSelf-1pz39u2` count drops and the assertion FAILS.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest \
 *     --config jest.orch1190r3.venuewidth.web.render.cjs --runInBand
 */

import React from "react";
import ReactDOMServer from "react-dom/server";

jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ defaultCurrency: "USD" }),
}));

jest.mock("../../../hooks/useVenueReservations", () => ({
  useVenueReservations: () => ({ data: [], isLoading: false, isError: false }),
  useCreateReservation: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useTransitionReservation: () => ({ mutate: () => undefined, isPending: false, isError: false }),
}));
jest.mock("../../../hooks/useVenueTables", () => ({
  useVenueTables: () => ({ data: [], isLoading: false, isError: false }),
}));
jest.mock("../../../hooks/useVenueWaitlist", () => ({
  useVenueWaitlist: () => ({ data: [], isLoading: false, isError: false }),
  useAddToWaitlist: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useNotifyWaitlist: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useConvertWaitlist: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useMarkWaitlistLost: () => ({ mutate: () => undefined, isPending: false, isError: false }),
}));
jest.mock("../../../hooks/useMenus", () => ({
  useBrandMenus: () => ({ data: [], isLoading: false, isError: false }),
  useUpsertMenu: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useDeleteMenu: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useReorderMenus: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useUpsertMenuItem: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useDeleteMenuItem: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useReorderMenuItems: () => ({ mutate: () => undefined, isPending: false, isError: false }),
}));

jest.mock("../../ui/Button", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const Button = ({ label }: { label?: string }) =>
    React.createElement(Text, null, label ?? "");
  return { Button, default: Button };
});
jest.mock("../../ui/Icon", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const Icon = () => React.createElement(Text, null, "");
  return { Icon, default: Icon };
});
jest.mock("../ReservationCreateSheet", () => ({ ReservationCreateSheet: () => null }));
jest.mock("../ReservationDetailSheet", () => ({ ReservationDetailSheet: () => null }));
jest.mock("../WaitlistAddSheet", () => ({ WaitlistAddSheet: () => null }));
jest.mock("../WaitlistConvertSheet", () => ({ WaitlistConvertSheet: () => null }));
jest.mock("../MenuCategorySheet", () => ({ MenuCategorySheet: () => null }));
jest.mock("../MenuItemSheet", () => ({ MenuItemSheet: () => null }));

import { VenueReservationsModule } from "../VenueReservationsModule";
import { VenueWaitlistModule } from "../VenueWaitlistModule";
import { VenueMenuModule } from "../VenueMenuModule";

// react-native-web compiles `alignSelf:"stretch"` to this deterministic atomic
// class (verified by direct probe) and `width:"100%"` to `r-width-13qz1uu`.
const ALIGN_SELF_STRETCH = "r-alignSelf-1pz39u2";
const WIDTH_100 = "r-width-13qz1uu";

function renderHtml(node: React.ReactElement): string {
  return ReactDOMServer.renderToStaticMarkup(node);
}

// Count occurrences of an atomic class in the rendered HTML.
function countClass(html: string, cls: string): number {
  return html.split(cls).length - 1;
}

describe("ORCH-1190 R3 — venue empty-state cards stretch full-width on WEB (robust)", () => {
  it("Reservations empty state: stretching wrapper present, no fragile width:100%", () => {
    const html = renderHtml(<VenueReservationsModule brandId="b1" />);
    expect(html).toContain("No reservations today yet.");
    // The empty wrapper + card both carry alignSelf:"stretch" — at least 2.
    expect(countClass(html, ALIGN_SELF_STRETCH)).toBeGreaterThanOrEqual(2);
    // The fragile width:100% that defeated stretch is gone from the empty state.
    expect(html).not.toContain(WIDTH_100);
  });

  it("Waitlist empty state: stretching wrapper present, no fragile width:100%", () => {
    const html = renderHtml(<VenueWaitlistModule brandId="b1" />);
    expect(html).toContain("Nobody&#x27;s waiting");
    expect(countClass(html, ALIGN_SELF_STRETCH)).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain(WIDTH_100);
  });

  it("Menu empty state: stretching wrapper present, no fragile width:100%", () => {
    const html = renderHtml(<VenueMenuModule brandId="b1" />);
    expect(html).toContain("Build your menu");
    // emptyWrap + emptyCard both stretch; the fullWidth Button also stretches —
    // so >= 2 (wrapper + card) is the floor that the wrapper guarantees.
    expect(countClass(html, ALIGN_SELF_STRETCH)).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain(WIDTH_100);
  });
});
