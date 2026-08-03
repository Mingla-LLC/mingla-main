import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createPublicVenueReservationUiState,
  publicVenueReservationUiReducer,
  type PublicVenueReservationUiState,
} from "../publicVenueReservationUiState";

describe("issue #1380 tester adversarial controlled-tab contract", () => {
  test("manual and route-initial Reservations stay inline through repeated rerenders", () => {
    const ready = { hasMenu: true, canOpenReservationSheet: true };
    const initial = createPublicVenueReservationUiState("reservations", ready);
    const manual = publicVenueReservationUiReducer(
      createPublicVenueReservationUiState("overview", ready),
      { type: "TAB_SELECTED", tab: "reservations", context: ready },
    );

    expect(initial).toEqual({
      activeTab: "reservations",
      reservationSheetOpen: false,
    });
    expect(manual).toEqual({
      activeTab: "reservations",
      reservationSheetOpen: false,
    });

    const afterControlledRerenders = Array.from({ length: 4 }).reduce<
      PublicVenueReservationUiState
    >(
      (state) =>
        publicVenueReservationUiReducer(state, {
          type: "ENVIRONMENT_CHANGED",
          context: ready,
        }),
      manual,
    );
    expect(afterControlledRerenders).toEqual({
      activeTab: "reservations",
      reservationSheetOpen: false,
    });

    const routeReplay = publicVenueReservationUiReducer(
      afterControlledRerenders,
      { type: "INITIAL_TAB_CHANGED", tab: "reservations", context: ready },
    );
    expect(routeReplay).toEqual({
      activeTab: "reservations",
      reservationSheetOpen: false,
    });
  });

  test("one physical controlled-tab activation has one state callback owner", () => {
    const tabs = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "..",
        "packages",
        "brand-rendering",
        "PublicVenueTabs.tsx",
      ),
      "utf8",
    );

    expect(tabs.match(/onTabChange\?\.\(tab\);/g)).toHaveLength(1);
    expect(tabs.match(/onTabViewed\?\.\(tab\);/g)).toHaveLength(1);
    expect(tabs).toContain("if (!isControlled)");
    expect(tabs).toContain("controlledActiveTab !== undefined");
  });
});
