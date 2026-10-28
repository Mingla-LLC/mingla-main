import {
  analyticsGridModules,
  packAnalyticsGrid,
  type AnalyticsGridModule,
} from "../analyticsGridPacking";

const shape = (rows: AnalyticsGridModule[][]) =>
  rows.map((row) => row.map((module) => `${module.id}:${module.width}`));

describe("#4037 Analytics desktop packing", () => {
  test("packs the complete selected-page grid in contract order", () => {
    expect(
      shape(
        packAnalyticsGrid(
          analyticsGridModules({
            showVisits: true,
            showActivity: true,
            showSources: true,
            showCompleted: false,
            showPages: true,
            showSelectedPage: true,
            showButtonTaps: true,
            showRegulars: true,
            showCustomerPatterns: true,
          }),
        ),
      ),
    ).toEqual([
      ["visits:6", "activity:6"],
      ["sources:12"],
      ["pages:7", "selectedPage:5"],
      ["buttonTaps:6", "regulars:6"],
      ["customerPatterns:12"],
    ]);
  });

  test("widens an unpaired six-column module after hidden modules", () => {
    expect(
      shape(
        packAnalyticsGrid(
          analyticsGridModules({
            showVisits: true,
            showActivity: true,
            showSources: true,
            showCompleted: false,
            showPages: true,
            showSelectedPage: false,
            showButtonTaps: true,
            showRegulars: false,
            showCustomerPatterns: true,
          }),
        ),
      ),
    ).toEqual([
      ["visits:6", "activity:6"],
      ["sources:12"],
      ["pages:12"],
      ["buttonTaps:12"],
      ["customerPatterns:12"],
    ]);
  });

  test("uses only a full-width completed fact while traffic is collecting", () => {
    expect(
      shape(
        packAnalyticsGrid(
          analyticsGridModules({
            showVisits: false,
            showActivity: false,
            showSources: false,
            showCompleted: true,
            showPages: false,
            showSelectedPage: false,
            showButtonTaps: false,
            showRegulars: false,
            showCustomerPatterns: false,
          }),
        ),
      ),
    ).toEqual([["completed:12"]]);
  });

  test("makes partial-window visits and sources full width without a path", () => {
    expect(
      shape(
        packAnalyticsGrid(
          analyticsGridModules({
            showVisits: true,
            showActivity: false,
            showSources: true,
            showCompleted: false,
            showPages: false,
            showSelectedPage: false,
            showButtonTaps: false,
            showRegulars: false,
            showCustomerPatterns: false,
          }),
        ),
      ),
    ).toEqual([["visits:12"], ["sources:12"]]);
  });
});
