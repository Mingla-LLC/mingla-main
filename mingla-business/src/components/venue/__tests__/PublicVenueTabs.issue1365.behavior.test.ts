import { reconcileInitialVenueTab } from "@mingla/brand-rendering/publicVenueTabState";

describe("issue #1365 PublicVenueTabs initial analytics behavior", () => {
  test("emits once for the initial route tab and once when that route state changes", () => {
    const first = reconcileInitialVenueTab(
      "reservations",
      null,
      "reservations",
    );
    expect(first).toEqual({
      activeTab: "reservations",
      lastInitialTab: "reservations",
      shouldEmit: true,
    });

    const unchanged = reconcileInitialVenueTab(
      first.activeTab,
      first.lastInitialTab,
      "reservations",
    );
    expect(unchanged.shouldEmit).toBe(false);

    const changed = reconcileInitialVenueTab(
      unchanged.activeTab,
      unchanged.lastInitialTab,
      "overview",
    );
    expect(changed).toEqual({
      activeTab: "overview",
      lastInitialTab: "overview",
      shouldEmit: true,
    });
  });

  test("a parent callback rerender cannot reset a user-selected tab", () => {
    const afterUserSelectedMenu = reconcileInitialVenueTab(
      "menu",
      "overview",
      "overview",
    );
    expect(afterUserSelectedMenu).toEqual({
      activeTab: "menu",
      lastInitialTab: "overview",
      shouldEmit: false,
    });
  });
});
