/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4490 Explorer W6b — "Places on Mingla" deck chips (#2774 lane).
 *
 *   P-*  resolvePills keeps `venue_type:*` as a category pill, untouched, never a
 *        curated filter; unknown venue types still go to the filter list;
 *   N-*  saved categories keep venue-type chips (normalizeCategoryArray);
 *   H-*  the hook's parse: known chip types with supply only, deduped, in order;
 *        the key factory; never persisted;
 *   R-*  the mounted row: the taxonomy words, checkbox state, a tap toggles
 *        `venue_type:<key>`;
 *   G-*  sheet wiring: the row only when the server lists a type (hidden while
 *        loading, on error, when empty), inside the categories toggle, the §6
 *        title, counted by the "Pick a category" rule.
 *
 * FAILS-ON-REVERT: drop the venue_type branch in resolvePills -> P-1; drop it in
 * normalizeCategoryArray -> N-1; render the row without the length check -> G-1.
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";

const { act, create } = require("react-test-renderer") as typeof import("react-test-renderer");

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../services/supabase", () => ({ supabase: { functions: { invoke: async () => ({ data: null, error: null }) } } }));

const { deckService, VENUE_TYPE_PILL_RE } = require("../../../services/deckService") as typeof import("../../../services/deckService");
const { normalizeCategoryArray, getCategoryIcon, VENUE_TYPE_ICONS } = require("../../../utils/categoryUtils") as typeof import("../../../utils/categoryUtils");
const { parseHostedVenueTypes, hostedVenueTypeKeys, HOSTED_VENUE_TYPES_STALE_MS, placesOnMinglaKeys } =
  require("../../../hooks/useHostedVenueTypes") as typeof import("../../../hooks/useHostedVenueTypes");
const { PlacesOnMinglaSection } = require("../PreferencesSections") as typeof import("../PreferencesSections");
const { VENUE_TYPE_CHIP_KEYS, VENUE_TYPE_LABELS } = require("@mingla/brand-rendering/venueTypeLabels") as typeof import("@mingla/brand-rendering/venueTypeLabels");

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf8");
const resolvePills = (cats: string[]) => (deckService as unknown as {
  resolvePills(c: string[], i?: string[]): { pills: Array<{ id: string; type: string }>; categoryFilters: string[] };
}).resolvePills(cats, []);

describe("#4490 W6b Places on Mingla", () => {
  it("P-1 a venue-type chip is a category pill, unchanged, never a curated filter", () => {
    const { pills, categoryFilters } = resolvePills(["drinks_and_music", "venue_type:bar_lounge", "venue_type:bar_lounge"]);
    expect(pills).toEqual([{ id: "drinks_and_music", type: "category" }, { id: "venue_type:bar_lounge", type: "category" }]);
    expect(categoryFilters).toEqual([]);
  });
  it("P-2 an unknown venue type is not a pill (it goes to the curated filter list, as any unknown id)", () => {
    const { pills, categoryFilters } = resolvePills(["venue_type:stay", "venue_type:spa"]);
    expect(pills).toEqual([]);
    expect(categoryFilters).toEqual(["venue_type:stay", "venue_type:spa"]);
    expect(VENUE_TYPE_CHIP_KEYS.every((k) => VENUE_TYPE_PILL_RE.test(`venue_type:${k}`))).toBe(true);
  });

  it("N-1 saved categories keep venue-type chips (deduped) beside canonical slugs", () => {
    expect(normalizeCategoryArray(["Drinks & Music", "venue_type:club", "venue_type:club", "venue_type:nope"]))
      .toEqual(["drinks_and_music", "venue_type:club"]);
  });
  it("N-2 one existing icon per venue type", () => {
    for (const k of VENUE_TYPE_CHIP_KEYS) expect(typeof VENUE_TYPE_ICONS[k]).toBe("string");
    expect(getCategoryIcon("venue_type:cafe")).toBe("coffee");
    const iconSource = read("../../ui/Icon.tsx");
    for (const name of Object.values(VENUE_TYPE_ICONS)) expect(iconSource).toContain(`'${name}'`);
  });

  it("H-1 parse: known chip types with supply only, deduped, server order", () => {
    expect(parseHostedVenueTypes({ types: [
      { key: "bar_lounge", count: 2 }, { key: "stay", count: 3 }, { key: "cafe", count: 0 },
      { key: "bar_lounge", count: 9 }, { key: "club", count: "1" }, { key: 7, count: 1 },
    ] })).toEqual([{ key: "bar_lounge", count: 2 }, { key: "club", count: 1 }]);
    expect(parseHostedVenueTypes(null)).toEqual([]);
    expect(parseHostedVenueTypes({ types: "x" })).toEqual([]);
  });
  it("H-2 one key factory, 10-minute stale, never persisted", () => {
    expect(hostedVenueTypeKeys.near(6.45012, 3.40019, "driving", 60)).toEqual(["hostedVenueTypes", 6.45, 3.4, "driving", 60]);
    expect(HOSTED_VENUE_TYPES_STALE_MS).toBe(600000);
    expect(read("../../../utils/queryPersistence.ts")).toContain('"hostedVenueTypes",');
    expect(read("../../../hooks/useHostedVenueTypes.ts")).toContain('body: { action: "venue_types", location, travelMode, travelConstraintValue: travelLimit }');
  });

  it("R-1 the mounted row: taxonomy words, checked state, a tap toggles venue_type:<key>", () => {
    const taps: string[] = [];
    let tree: ReturnType<typeof create> | null = null;
    act(() => {
      tree = create(
        <PlacesOnMinglaSection
          title="Places on Mingla"
          types={[{ key: "bar_lounge", label: VENUE_TYPE_LABELS.bar_lounge, icon: "wine-outline" }, { key: "club", label: VENUE_TYPE_LABELS.club, icon: "musical-notes-outline" }]}
          selectedCategories={["venue_type:club"]}
          onCategoryToggle={(id) => taps.push(id)}
        />,
      );
    });
    const all = tree!.root.findAll((n) => n.props?.accessibilityRole === "checkbox" && typeof n.props?.onPress === "function");
    // The host element and its wrapper both carry the props: one per label.
    const chips = all.filter((c, i) => all.findIndex((x) => x.props.accessibilityLabel === c.props.accessibilityLabel) === i);
    expect(chips.map((c) => c.props.accessibilityLabel)).toEqual(["Bar and lounge, Places on Mingla", "Club, Places on Mingla"]);
    expect(chips.map((c) => c.props.accessibilityState.checked)).toEqual([false, true]);
    act(() => chips[0].props.onPress());
    expect(taps).toEqual(["venue_type:bar_lounge"]);
    const json = JSON.stringify(tree!.toJSON());
    expect(json).toContain("Places on Mingla");
    expect(json).toContain("Bar and lounge");
  });

  it("S-1 a saved type not offered here stays in the row, selected, so it can be removed (fix 1, W6-N5)", () => {
    const here = [{ key: "club" as const, count: 1 }];
    expect(placesOnMinglaKeys(here, ["drinks_and_music", "venue_type:bar_lounge"])).toEqual(["club", "bar_lounge"]);
    expect(placesOnMinglaKeys([], ["venue_type:bar_lounge"])).toEqual(["bar_lounge"]);
    expect(placesOnMinglaKeys(here, ["venue_type:club"])).toEqual(["club"]);
    expect(placesOnMinglaKeys(here, ["venue_type:spa", "venue_type:stay"])).toEqual(["club"]);
    expect(placesOnMinglaKeys([], ["drinks_and_music"])).toEqual([]);
    // Still hidden while loading or after an error.
    expect(placesOnMinglaKeys(undefined, ["venue_type:bar_lounge"])).toEqual([]);
  });

  it("G-1 the sheet shows the row only when the server lists a type, inside the categories toggle", () => {
    const sheet = read("../../PreferencesSheet.tsx");
    expect(sheet).toContain("{placesOnMinglaTypes.length > 0 ? (");
    // TEST-MOD-APPROVED #4490 (06-W6 fix 1): the row reads placesOnMinglaKeys (W6-N5).
    expect(sheet).toContain("() => placesOnMinglaKeys(hostedVenueTypes.isError ? undefined : hostedVenueTypes.data, selectedCategories).map((key) => ({");
    expect(sheet).toContain("title={t('preferences:places_on_mingla_title', 'Places on Mingla')}");
    expect(sheet).toContain("onCategoryToggle={handleCategoryToggle}\n              />\n            ) : null}");
    // The chip lives in selectedCategories, so the "Pick a category" rule counts it.
    expect(sheet).toContain('categories: (categoryToggle && selectedCategories.length === 0) ? "Pick a category" : null,');
    const en = JSON.parse(read("../../../i18n/locales/en/preferences.json")) as Record<string, string>;
    expect(en.places_on_mingla_title).toBe("Places on Mingla");
  });
});
