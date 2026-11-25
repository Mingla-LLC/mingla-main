/**
 * #4490 spec 08 O3 part B — layout at 600 / 768 / 1024 in both orientations:
 * which width class a floor screen gets, whether the station board shows
 * three columns or Tabs, and the centred phone column every other Host screen
 * gets on a native tablet (web untouched).
 *
 * fails-on-revert: give a portrait tablet three columns again, centre a floor
 * screen, centre on web or on a phone, or change the 600 limit and a row here
 * fails. The rendered column and the web split are in
 * components/ui/__tests__/NativeTabletColumn.issue4490.o3b.implementor.test.tsx.
 */
import { describe, expect, test } from "@jest/globals";
import { suiteFormMaxWidth } from "../../constants/designSystem";
import { isFloorRoute, nativeTabletColumnWidth } from "../deviceOrientation";
import { floorLayoutFor, stationBoardColumns } from "../floorLayout";

const SIZES: [number, number, string, boolean][] = [
  // width, height, floor layout, station board columns
  [390, 844, "phone", false],
  [844, 390, "tablet", true], // a phone held sideways (Android before the lock lands) is wide enough for columns
  [600, 960, "tablet", false],
  [960, 600, "tablet", true],
  [768, 1024, "tablet", false],
  [1024, 768, "desk", true],
  [1024, 1366, "desk", true],
  [1366, 1024, "desk", true],
];

describe("08-O3B floor layout in both orientations", () => {
  test.each(SIZES)("%i x %i: %s, board columns %s", (width, height, layout, columns) => {
    expect(floorLayoutFor(width)).toBe(layout);
    expect(stationBoardColumns(floorLayoutFor(width), width, height)).toBe(columns);
  });
});

describe("08-O3B native tablet column (every Host screen except the floor)", () => {
  const venue = "/venue/44900000-0000-4000-8000-0000000000d1";
  test.each([
    ["ios", 600, 960, null],
    ["ios", 960, 600, suiteFormMaxWidth],
    ["ios", 768, 1024, suiteFormMaxWidth],
    ["ios", 1024, 768, suiteFormMaxWidth],
    ["android", 600, 960, null],
    ["android", 1024, 768, suiteFormMaxWidth],
    ["android", 390, 844, null],
    ["ios", 507, 1024, null], // iPad in a narrow multitasking window: phone layout, full width
  ])("%s %i x %i -> %p", (platform, width, height, expected) => {
    expect(nativeTabletColumnWidth({ platform, window: { width, height }, pathname: "/events" })).toBe(expected);
  });
  test("web never gets the column (its desktop layouts own >= 1024)", () => {
    for (const [width, height] of [[768, 1024], [1024, 768], [1440, 900]]) {
      expect(nativeTabletColumnWidth({ platform: "web", window: { width, height }, pathname: "/events" })).toBeNull();
    }
  });
  test("floor screens use the whole window at 768 and 1024, both orientations", () => {
    for (const pathname of [`${venue}/till`, `${venue}/station/kitchen`, `${venue}/station/bar`]) {
      expect(isFloorRoute(pathname)).toBe(true);
      for (const [width, height] of [[768, 1024], [1024, 768]]) {
        expect(nativeTabletColumnWidth({ platform: "ios", window: { width, height }, pathname })).toBeNull();
      }
    }
    expect(isFloorRoute(venue)).toBe(false);
    expect(isFloorRoute(`${venue}/offer/o1`)).toBe(false);
    expect(isFloorRoute(null)).toBe(false);
  });
});
