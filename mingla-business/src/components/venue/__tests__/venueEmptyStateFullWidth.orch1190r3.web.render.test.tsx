/**
 * ORCH-1190 R4 — venue empty-state FULL-WIDTH web render-proof (implementor
 * happy-path), matched to the PROVEN-WORKING sibling pattern.
 *
 * HISTORY. R2 added BOTH `width:"100%"` + `alignSelf:"stretch"` to the empty-state
 * cards. R3 then THEORIZED that `width:"100%"` could DEFEAT `alignSelf:"stretch"`
 * under an indefinite-width ancestor, DROPPED `width:"100%"`, and asserted its
 * ABSENCE. That R3 build was never actually deployed/verified on live web, and the
 * narrow/centered empty card PERSISTED on business desktop web (Seth-confirmed).
 *
 * GROUND TRUTH (R4). In the SAME shell, the VenueTablesModule `tableCard` style
 * renders FULL-WIDTH on desktop (Seth-confirmed) and uses BOTH `width:"100%"` AND
 * `alignSelf:"stretch"` TOGETHER (VenueTablesModule.tsx ~L322-323). The empty
 * cards must match that proven pattern EXACTLY. R3's "drop width:100%" was the
 * regression; R4 restores `width:"100%"` alongside `alignSelf:"stretch"` on the
 * empty/skeleton cards AND their wrappers.
 *
 * WHAT THIS TEST ASSERTS. Rendering the REAL module empty states through
 * react-native-web's actual style compiler (ReactDOMServer = the exact atomic
 * classes Vercel emits), each empty-state output:
 *   (a) carries the compiled `width:"100%"` class (`r-width-13qz1uu`) — the R4
 *       restoration that R3 had removed; AND
 *   (b) carries the compiled `alignSelf:"stretch"` class (`r-alignSelf-1pz39u2`);
 *       AND
 *   (c) actually rendered the empty branch (not loading/populated).
 * Together (a)+(b) prove the empty card now matches VenueTablesModule.tableCard's
 * width-relevant properties. Class atoms are deterministic in RNW and are a
 * reliable static contract.
 *
 * FAILS-ON-REVERT (verified by TRUE LINE-DELETION, NOT a comment-out): delete the
 * `width: "100%"` line from a module's emptyCard/emptyWrap style → the
 * `r-width-13qz1uu` count drops below the floor and the assertion FAILS (this is
 * exactly the R3 state that regressed live).
 *
 * [TEST-MOD-APPROVED ORCH-1190] — this file replaces the R3 contract (which
 * asserted width:100% ABSENT) with the R4 contract (width:100% PRESENT). The R3
 * theory was disproven on live web; the prior assertions cannot coexist with the
 * proven-working fix.
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

// react-native-web compiles these styles to deterministic atomic classes
// (verified by direct probe; same atoms VenueTablesModule.tableCard emits).
const ALIGN_SELF_STRETCH = "r-alignSelf-1pz39u2"; // alignSelf:"stretch"
const WIDTH_100 = "r-width-13qz1uu"; // width:"100%"

function renderHtml(node: React.ReactElement): string {
  return ReactDOMServer.renderToStaticMarkup(node);
}

// Count occurrences of an atomic class in the rendered HTML.
function countClass(html: string, cls: string): number {
  return html.split(cls).length - 1;
}

describe("ORCH-1190 R4 — venue empty-state cards full-width on WEB (width:100% + alignSelf:stretch, matching tableCard)", () => {
  it("Reservations empty state: card+wrapper carry BOTH width:100% and alignSelf:stretch", () => {
    const html = renderHtml(<VenueReservationsModule brandId="b1" />);
    expect(html).toContain("No reservations today yet.");
    // emptyWrap + emptyCard both carry alignSelf:"stretch" — at least 2.
    expect(countClass(html, ALIGN_SELF_STRETCH)).toBeGreaterThanOrEqual(2);
    // R4: width:"100%" RESTORED on emptyWrap + emptyCard — at least 2 (the R3
    // regression dropped this, defeating full-width on live desktop).
    expect(countClass(html, WIDTH_100)).toBeGreaterThanOrEqual(2);
  });

  it("Waitlist empty state: card+wrapper carry BOTH width:100% and alignSelf:stretch", () => {
    const html = renderHtml(<VenueWaitlistModule brandId="b1" />);
    expect(html).toContain("Nobody&#x27;s waiting");
    expect(countClass(html, ALIGN_SELF_STRETCH)).toBeGreaterThanOrEqual(2);
    expect(countClass(html, WIDTH_100)).toBeGreaterThanOrEqual(2);
  });

  it("Menu empty state: card+wrapper carry BOTH width:100% and alignSelf:stretch", () => {
    const html = renderHtml(<VenueMenuModule brandId="b1" />);
    expect(html).toContain("Build your menu");
    // emptyWrap + emptyCard both stretch and are width:100%.
    expect(countClass(html, ALIGN_SELF_STRETCH)).toBeGreaterThanOrEqual(2);
    expect(countClass(html, WIDTH_100)).toBeGreaterThanOrEqual(2);
  });
});
