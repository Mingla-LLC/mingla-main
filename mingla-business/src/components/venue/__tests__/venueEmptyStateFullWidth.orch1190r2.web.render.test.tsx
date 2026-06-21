/**
 * ORCH-1190 R2 BUG-2 — venue empty-state FULL-WIDTH web render-proof
 * (implementor happy-path).
 *
 * THE BUG (Seth, business.usemingla.com): the Reservations, Waitlist and Menu
 * venue-suite modules rendered a NARROW, CENTERED card on the wide web shell
 * while Tables and Settings spanned the full workspace width. Root cause: those
 * three modules were showing their EMPTY STATE (no reservations / nobody waiting
 * / build-your-menu), and the empty-state GlassCard wrapper carried no explicit
 * width. On the WEB target a column flex child with no width + alignItems:"center"
 * shrinks to its centered content's min width, so the card collapsed to ~half
 * width — unlike the content cards in VenueTablesModule/VenueSettingsModule which
 * set width:"100%". The fix adds width:"100%" + alignSelf:"stretch" to each
 * module's empty-state card style.
 *
 * WHY A WEB RENDER (not source-grep, not the native render configs): on the
 * `ios` jest platform a width-less column child does NOT visibly collapse the
 * same way, and react-native-web is the deployed business web build. This test
 * renders the REAL module empty states through react-native-web's actual style
 * compiler (via ReactDOMServer) — the exact DOM Vercel emits — and asserts the
 * empty-state card wrapper carries the compiled `width:100%` atomic class.
 *
 * react-native-web compiles `width:"100%"` to the deterministic atomic class
 * `r-width-13qz1uu` (verified by direct probe). The class is present ⇔ the card
 * style carries width:"100%".
 *
 * FAILS-ON-REVERT (verified by TRUE LINE-DELETION of the fix, NOT a comment-out):
 *   delete `width:"100%"` from the `emptyCard` style in VenueReservationsModule /
 *   VenueWaitlistModule and from `emptyCard` in VenueMenuModule → the
 *   `r-width-13qz1uu` class disappears from each empty-state render and the
 *   matching assertion FAILS.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest \
 *     --config jest.orch1190r2.venuewidth.web.render.cjs --runInBand
 */

import React from "react";
import ReactDOMServer from "react-dom/server";

// ---- Force each module into its EMPTY state via mocked data hooks. ----

// Manager-plus so the empty-state CTAs render (the card content path is the
// fuller one — the fix must hold with the CTA present).
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ defaultCurrency: "USD" }),
}));

// jest.mock factories are hoisted above imports and may not close over outer
// vars — inline the empty-query / idle-mutation shapes in each factory.

// Reservations module deps.
jest.mock("../../../hooks/useVenueReservations", () => ({
  useVenueReservations: () => ({ data: [], isLoading: false, isError: false }),
  useCreateReservation: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useTransitionReservation: () => ({ mutate: () => undefined, isPending: false, isError: false }),
}));
jest.mock("../../../hooks/useVenueTables", () => ({
  useVenueTables: () => ({ data: [], isLoading: false, isError: false }),
}));

// Waitlist module deps.
jest.mock("../../../hooks/useVenueWaitlist", () => ({
  useVenueWaitlist: () => ({ data: [], isLoading: false, isError: false }),
  useAddToWaitlist: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useNotifyWaitlist: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useConvertWaitlist: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useMarkWaitlistLost: () => ({ mutate: () => undefined, isPending: false, isError: false }),
}));

// Menu module deps.
jest.mock("../../../hooks/useMenus", () => ({
  useBrandMenus: () => ({ data: [], isLoading: false, isError: false }),
  useUpsertMenu: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useDeleteMenu: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useReorderMenus: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useUpsertMenuItem: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useDeleteMenuItem: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useReorderMenuItems: () => ({ mutate: () => undefined, isPending: false, isError: false }),
}));

// Button pulls in react-native-reanimated (native worklets — absent under jest)
// and is NOT the element under assertion (the empty CARD wrapper is). Stub it to
// a plain Text so the empty-state tree renders. Note: this means the only
// width:100% element left in each empty render is the CARD itself.
jest.mock("../../ui/Button", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const Button = ({ label }: { label?: string }) =>
    React.createElement(Text, null, label ?? "");
  return { Button, default: Button };
});

// Icon pulls in react-native-svg (native codegen + __DEV__ — absent under jest)
// and is decorative content inside the card, not the card wrapper. Stub it.
jest.mock("../../ui/Icon", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const Icon = () => React.createElement(Text, null, "");
  return { Icon, default: Icon };
});

// The sheets pull in heavy children; stub them to no-ops (they are closed in the
// empty state anyway). We only assert on the empty CARD.
jest.mock("../ReservationCreateSheet", () => ({ ReservationCreateSheet: () => null }));
jest.mock("../ReservationDetailSheet", () => ({ ReservationDetailSheet: () => null }));
jest.mock("../WaitlistAddSheet", () => ({ WaitlistAddSheet: () => null }));
jest.mock("../WaitlistConvertSheet", () => ({ WaitlistConvertSheet: () => null }));
jest.mock("../MenuCategorySheet", () => ({ MenuCategorySheet: () => null }));
jest.mock("../MenuItemSheet", () => ({ MenuItemSheet: () => null }));

import { VenueReservationsModule } from "../VenueReservationsModule";
import { VenueWaitlistModule } from "../VenueWaitlistModule";
import { VenueMenuModule } from "../VenueMenuModule";

// react-native-web compiles `width:"100%"` to this deterministic atomic class.
const WIDTH_100 = "r-width-13qz1uu";

function renderHtml(node: React.ReactElement): string {
  return ReactDOMServer.renderToStaticMarkup(node);
}

describe("ORCH-1190 R2 BUG-2 — venue empty-state cards span full width on WEB", () => {
  it("Reservations empty state renders + its card carries width:100%", () => {
    const html = renderHtml(<VenueReservationsModule brandId="b1" />);
    // The empty state actually rendered (not the populated/loading branch).
    expect(html).toContain("No reservations today yet.");
    // The empty card wrapper carries the compiled width:100% class. (Reservations'
    // empty state has no other full-width element — the CTA is a non-fullWidth
    // secondary Button — so the class proves the CARD itself stretches.)
    expect(html).toContain(WIDTH_100);
  });

  it("Waitlist empty state renders + its card carries width:100%", () => {
    const html = renderHtml(<VenueWaitlistModule brandId="b1" />);
    expect(html).toContain("Nobody&#x27;s waiting");
    expect(html).toContain(WIDTH_100);
  });

  it("Menu empty state renders + its card carries width:100%", () => {
    const html = renderHtml(<VenueMenuModule brandId="b1" />);
    expect(html).toContain("Build your menu");
    expect(html).toContain(WIDTH_100);
  });
});
