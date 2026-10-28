import {
  analyticsGridModules,
  packAnalyticsGrid,
  type AnalyticsGridModule,
} from "../analyticsGridPacking";

const shape = (rows: AnalyticsGridModule[][]) =>
  rows.map((row) => row.map((module) => `${module.id}:${module.width}`));

describe("#4037 Analytics desktop packing", () => {
  test("packs the complete selected-page grid in contract order", () => {
    expect(shape(packAnalyticsGrid(analyticsGridModules({
      showVisits: true,
      showPages: true,
      showSelectedPage: true,
      showButtonTaps: true,
      showRegulars: true,
      showCustomerPatterns: true,
    })))).toEqual([
      ["hero:6", "visits:6"],
      ["funnel:6", "sources:6"],
      ["pages:7", "selectedPage:5"],
      ["buttonTaps:6", "regulars:6"],
      ["customerPatterns:12"],
    ]);
  });

  test("widens an unpaired six-column module after hidden modules", () => {
    expect(shape(packAnalyticsGrid(analyticsGridModules({
      showVisits: true,
      showPages: true,
      showSelectedPage: false,
      showButtonTaps: true,
      showRegulars: false,
      showCustomerPatterns: true,
    })))).toEqual([
      ["hero:6", "visits:6"],
      ["funnel:6", "sources:6"],
      ["pages:12"],
      ["buttonTaps:12"],
      ["customerPatterns:12"],
    ]);
  });

  test("removes collecting visits and pairs the remaining sixes", () => {
    expect(shape(packAnalyticsGrid(analyticsGridModules({
      showVisits: false,
      showPages: false,
      showSelectedPage: false,
      showButtonTaps: false,
      showRegulars: true,
      showCustomerPatterns: false,
    })))).toEqual([
      ["hero:6", "funnel:6"],
      ["regulars:12"],
    ]);
  });
});
