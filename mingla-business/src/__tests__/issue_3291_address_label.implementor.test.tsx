/**
 * Issue #3291 — a Host address pick must save the name the host tapped.
 *
 * THE DEFECT (#1407): the shared picker saved a suggestion's grey second line.
 * For a plain street, a city or a venue that line is only the surrounding area
 * ("Lagos 10, Lagos, Nigeria"), so tapping "Ozumba Mbadiwe Avenue" saved an
 * address with no street in it. House-number rows hid the bug because their
 * grey line already repeats the name.
 *
 * FAILS-ON-REVERT: restore `s.fullAddress.trim().length > 0 ? s.fullAddress :
 * s.displayName` as the label (and `s.fullAddress || s.displayName` as the row
 * accessibility label) in packages/location-input/src/MapboxAddressInput.tsx,
 * and the rendered-picker, every-host and event-mapper cases below go red.
 */

import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, jest, test } from "@jest/globals";

import { MapboxAddressInput } from "../../../packages/location-input/src/MapboxAddressInput";
import {
  addressBeginsWithName,
  composeSuggestionLabel,
  resolvePickedLabel,
} from "../../../packages/location-input/src/suggestionLabel";
import type {
  InvokeFn,
  PlaceAutocompleteSuggestion,
  PlaceDetails,
} from "../../../packages/location-input/src/mapboxGeocodeService";
import type { LocationInputTokens } from "../../../packages/location-input/src/types";
import { buildDraftEvent } from "../store/draftEventStore";
import {
  draftToServerInsert,
  draftToServerUpdate,
} from "../utils/serverDraftEventMapper";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type HostNode = { props: Record<string, unknown> };
type Tree = {
  root: { findAll: (p: (n: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => Tree;
  act: (cb: () => Promise<void> | void) => Promise<void>;
};

const ROOT = path.resolve(__dirname, "../../..");

// ── Live-shaped fixtures (captured from the production mapbox-geocode proxy) ──
const STREET: PlaceAutocompleteSuggestion = {
  placeId: "mapbox.street.ozumba",
  displayName: "Ozumba Mbadiwe Avenue",
  fullAddress: "Lagos 10, Lagos, Nigeria",
};
const HOUSE_NUMBER: PlaceAutocompleteSuggestion = {
  placeId: "mapbox.address.ozumba12",
  displayName: "Ozumba Mbadiwe Rd 12",
  fullAddress: "Ozumba Mbadiwe Rd 12, Lagos 10, Lagos, Nigeria",
};
const CITY: PlaceAutocompleteSuggestion = {
  placeId: "mapbox.place.london",
  displayName: "London",
  fullAddress: "Greater London, England, United Kingdom",
};
const VENUE: PlaceAutocompleteSuggestion = {
  placeId: "mapbox.poi.nike",
  displayName: "Nike Art Gallery",
  fullAddress: "2 Elegushi Beach Rd, Lekki, Lagos, Nigeria",
};

const details = (formattedAddress: string, featureType: string): PlaceDetails => ({
  placeId: "retrieved",
  formattedAddress,
  city: "Lagos",
  region: "Lagos",
  regionCode: "LA",
  regionCodeFull: "NG-LA",
  countryCode: "NG",
  location: { lat: 6.439518, lng: 3.428755 },
  featureType,
});

const tokens: LocationInputTokens = {
  field: {
    bg: "#111111",
    bgFocused: "#111111",
    border: "#333333",
    borderFocused: "#eb7825",
    borderError: "#ff0000",
    radius: 12,
    hasBorder: true,
    paddingHorizontal: 12,
    paddingVertical: 8,
    focusBorderWidth: 1,
  },
  text: { input: "#ffffff", placeholder: "#999999" },
  icon: { leading: "#aaaaaa", clear: "#aaaaaa" },
  spinner: "#eb7825",
  dropdown: {
    mode: "card",
    bg: "#111111",
    border: "#333333",
    radius: 12,
    maxHeight: 300,
    hasShadow: false,
  },
  row: {
    pressBg: "#222222",
    textPrimary: "#ffffff",
    textSecondary: "#aaaaaa",
    divider: "#333333",
    style: "flat",
    primaryFontSize: 16,
    primaryLineHeight: 20,
    primaryWeight: "400",
    secondaryFontSize: 12,
    secondaryLineHeight: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  status: { text: "#aaaaaa", fontSize: 12, lineHeight: 16 },
  error: { text: "#ff0000", fontSize: 12, lineHeight: 16 },
};

const copy = {
  minLengthHint: "Type more",
  searching: "Searching",
  noResults: "No matches",
  offline: "Offline",
  pickError: "Pick failed",
};

const Icon = (): null => null;

/**
 * Drive the REAL shared picker: type, let suggest return `suggestion`, tap the
 * row, let retrieve return `retrieved`. Returns the row's accessibility label
 * and the label handed to `onPick`.
 */
async function pickThroughPicker(
  suggestion: PlaceAutocompleteSuggestion,
  retrieved: PlaceDetails,
): Promise<{ rowA11yLabel: string; pickedLabel: string | undefined }> {
  jest.useFakeTimers();
  const invoke: InvokeFn = async (_fn, options) => {
    if (options.body.action === "suggest") {
      return { data: { suggestions: [suggestion] }, error: null };
    }
    return { data: { details: retrieved }, error: null };
  };
  const onPick = jest.fn<(d: PlaceDetails, label?: string) => void>();
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <MapboxAddressInput
        value=""
        onChangeText={() => undefined}
        onPick={onPick}
        onClear={() => undefined}
        tokens={tokens}
        IconComponent={Icon}
        invoke={invoke}
        copy={copy}
      />,
    );
  });
  const input = (tree as Tree).root.findAll(
    (node) => node.props.accessibilityRole === "combobox",
  )[0];
  await TestRenderer.act(async () => {
    (input.props.onChangeText as (v: string) => void)(suggestion.displayName);
    jest.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
  const rows = (tree as Tree).root.findAll(
    (node) =>
      node.props.accessibilityRole === "button" &&
      typeof node.props.onPress === "function" &&
      typeof node.props.accessibilityLabel === "string" &&
      (node.props.accessibilityLabel as string).includes(suggestion.fullAddress),
  );
  expect(rows.length).toBeGreaterThan(0);
  const row = rows[0];
  const rowA11yLabel = row.props.accessibilityLabel as string;
  await TestRenderer.act(async () => {
    await (row.props.onPress as () => Promise<void>)();
    await Promise.resolve();
    await Promise.resolve();
  });
  await TestRenderer.act(() => {
    (tree as Tree).unmount();
  });
  jest.useRealTimers();
  expect(onPick).toHaveBeenCalledTimes(1);
  return {
    rowA11yLabel,
    pickedLabel: onPick.mock.calls[0]?.[1],
  };
}

describe("Issue #3291 — the label rule", () => {
  test("street, city and venue rows carry their name; house-number rows are not doubled", () => {
    expect(composeSuggestionLabel(STREET)).toBe(
      "Ozumba Mbadiwe Avenue, Lagos 10, Lagos, Nigeria",
    );
    expect(composeSuggestionLabel(CITY)).toBe(
      "London, Greater London, England, United Kingdom",
    );
    expect(composeSuggestionLabel(VENUE)).toBe(
      "Nike Art Gallery, 2 Elegushi Beach Rd, Lekki, Lagos, Nigeria",
    );
    expect(composeSuggestionLabel(HOUSE_NUMBER)).toBe(HOUSE_NUMBER.fullAddress);
    expect(
      composeSuggestionLabel({ displayName: "Lagos", fullAddress: "Lagos, Nigeria" }),
    ).toBe("Lagos, Nigeria");
  });

  test("empty parts, case and spacing never fabricate or double", () => {
    expect(composeSuggestionLabel({ displayName: "Taco", fullAddress: "" })).toBe("Taco");
    expect(composeSuggestionLabel({ displayName: "Taco", fullAddress: "Taco" })).toBe("Taco");
    expect(composeSuggestionLabel({ displayName: "", fullAddress: "Lagos" })).toBe("Lagos");
    expect(addressBeginsWithName("ozumba  mbadiwe rd 12 ,Lagos", "Ozumba Mbadiwe Rd 12")).toBe(true);
    // A substring is not a lead: "Greater London" is not London.
    expect(addressBeginsWithName("Greater London, England", "London")).toBe(false);
    // "London Road" is not "London" either.
    expect(addressBeginsWithName("London Road, Croydon", "London")).toBe(false);
  });

  test("after retrieve, the full address wins only when it still begins with the tapped name", () => {
    expect(
      resolvePickedLabel(STREET, "Ozumba Mbadiwe Avenue, Lagos 10, Lagos, Nigeria"),
    ).toBe("Ozumba Mbadiwe Avenue, Lagos 10, Lagos, Nigeria");
    // A server that has not been redeployed still returns the area alone.
    expect(resolvePickedLabel(STREET, "Lagos 10, Lagos, Nigeria")).toBe(
      "Ozumba Mbadiwe Avenue, Lagos 10, Lagos, Nigeria",
    );
    expect(resolvePickedLabel(VENUE, "2 Elegushi Beach Rd, Lekki, Lagos, Nigeria")).toBe(
      "Nike Art Gallery, 2 Elegushi Beach Rd, Lekki, Lagos, Nigeria",
    );
    expect(resolvePickedLabel(HOUSE_NUMBER, HOUSE_NUMBER.fullAddress)).toBe(
      HOUSE_NUMBER.fullAddress,
    );
    expect(resolvePickedLabel(STREET, null)).toBe(
      "Ozumba Mbadiwe Avenue, Lagos 10, Lagos, Nigeria",
    );
  });
});

describe("Issue #3291 — the real shared picker", () => {
  test("tapping a street saves the street, and the row reads the street to a screen reader", async () => {
    const result = await pickThroughPicker(
      STREET,
      details("Ozumba Mbadiwe Avenue, Lagos 10, Lagos, Nigeria", "street"),
    );
    expect(result.pickedLabel).toBe("Ozumba Mbadiwe Avenue, Lagos 10, Lagos, Nigeria");
    expect(result.rowA11yLabel).toContain("Ozumba Mbadiwe Avenue");
  });

  test("the street survives even when retrieve returns only the area (server not yet redeployed)", async () => {
    const result = await pickThroughPicker(
      STREET,
      details("Lagos 10, Lagos, Nigeria", "street"),
    );
    expect(result.pickedLabel).toContain("Ozumba Mbadiwe Avenue");
  });

  test("tapping a city saves the city name", async () => {
    const result = await pickThroughPicker(
      CITY,
      details("Greater London, England, United Kingdom", "place"),
    );
    expect(result.pickedLabel).toBe("London, Greater London, England, United Kingdom");
    expect(result.rowA11yLabel.startsWith("London,")).toBe(true);
  });

  test("a house-number row saves exactly as before, without repeating itself", async () => {
    const result = await pickThroughPicker(
      HOUSE_NUMBER,
      details(HOUSE_NUMBER.fullAddress, "address"),
    );
    expect(result.pickedLabel).toBe(HOUSE_NUMBER.fullAddress);
    expect(result.rowA11yLabel).toBe(HOUSE_NUMBER.fullAddress);
    expect(
      (result.pickedLabel ?? "").split("Ozumba Mbadiwe Rd 12").length - 1,
    ).toBe(1);
  });
});

// ── Every Host address field ────────────────────────────────────────────────
// Each host's own mapping is proven from its source (the saved field is the
// picker's label, `selectedLabel ?? <details>.formattedAddress`), and the VALUE
// that mapping receives is produced by the real picker above. Breaking the
// label rule turns every row red.
const HOST_FIELDS: ReadonlyArray<{
  file: string;
  field: string;
  savedAs: RegExp;
}> = [
  { file: "src/components/event/CreatorStep3Where.tsx", field: "event Where address", savedAs: /address: label,/ },
  { file: "src/components/experience/ExperienceStopCard.tsx", field: "experience stop address", savedAs: /address: label,/ },
  { file: "src/components/trip/TripCreatorStep1Basics.tsx", field: "trip departure", savedAs: /departureLocationText: label,/ },
  { file: "src/components/trip/TripCreatorStep1Basics.tsx", field: "trip destination", savedAs: /destinationLocationText: label,/ },
  { file: "src/components/trip/EditPublishedTripScreen.tsx", field: "published trip departure", savedAs: /departureLocationText: label,/ },
  { file: "src/components/trip/EditPublishedTripScreen.tsx", field: "published trip destination", savedAs: /destinationLocationText: label,/ },
  { file: "src/components/venue/VenueStep1Address.tsx", field: "venue address", savedAs: /formattedAddress: label,/ },
  { file: "src/components/brand/BrandCreationFlow.tsx", field: "brand address", savedAs: /setAddress\(label\);/ },
];

/**
 * Every `<MapboxAddressInput … />` JSX element in a host, as source text. Only a
 * tag that opens its own line counts, so a comment naming the component (e.g.
 * ExperienceStopCard's header) is never mistaken for a mount.
 */
function addressInputBlocks(source: string): string[] {
  const blocks: string[] = [];
  const opener = /^([ \t]*)<MapboxAddressInput[ \t]*$/gm;
  let match: RegExpExecArray | null = opener.exec(source);
  while (match !== null) {
    const close = source.indexOf(`\n${match[1]}/>`, match.index);
    expect(close).toBeGreaterThan(match.index);
    blocks.push(source.slice(match.index, close));
    opener.lastIndex = close;
    match = opener.exec(source);
  }
  return blocks;
}

describe("Issue #3291 — every Host address field saves the tapped name", () => {
  test("the host list covers every business mount of the picker", () => {
    const mounts = HOST_FIELDS.reduce<Record<string, number>>((acc, h) => {
      acc[h.file] = (acc[h.file] ?? 0) + 1;
      return acc;
    }, {});
    for (const [file, count] of Object.entries(mounts)) {
      const source = fs.readFileSync(path.resolve(ROOT, "mingla-business", file), "utf8");
      expect(addressInputBlocks(source)).toHaveLength(count);
    }
    expect(Object.keys(mounts)).toHaveLength(6);

    // Discovery, not a hand-kept list: a NEW Host mount of the picker must be
    // added to HOST_FIELDS (and proven) or this goes red.
    const discovered: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(full);
        } else if (/\.tsx$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          if (addressInputBlocks(source).length > 0) {
            discovered.push(path.relative(path.resolve(ROOT, "mingla-business"), full));
          }
        }
      }
    };
    walk(path.resolve(ROOT, "mingla-business/src"));
    walk(path.resolve(ROOT, "mingla-business/app"));
    expect(discovered.sort()).toEqual(Object.keys(mounts).sort());
  });

  test.each(HOST_FIELDS)("$field saves a label containing the tapped street", async (host) => {
    const source = fs.readFileSync(path.resolve(ROOT, "mingla-business", host.file), "utf8");
    const block = addressInputBlocks(source).find((b) => host.savedAs.test(b));
    expect(block).toBeDefined();
    // The host saves the picker's label first, the retrieved address second.
    expect(block).toMatch(
      /const label = selectedLabel \?\? [A-Za-z]+\.formattedAddress;/,
    );
    // …and ranks results near the host (rank-only proximity).
    expect(block).toMatch(/proximity=\{[A-Za-z]+\}/);

    const { pickedLabel } = await pickThroughPicker(
      STREET,
      details("Lagos 10, Lagos, Nigeria", "street"),
    );
    // Exactly what the host evaluates: selectedLabel ?? formattedAddress.
    const saved = pickedLabel ?? "Lagos 10, Lagos, Nigeria";
    expect(saved).toContain("Ozumba Mbadiwe Avenue");
  });

  test("every event entry point hands the Where step the brand's location", () => {
    for (const file of [
      "src/components/event/EventCreatorWizard.tsx",
      "src/components/rsvp/RsvpCreatorWizard.tsx",
      "src/components/event/EditPublishedScreen.tsx",
    ]) {
      const source = fs.readFileSync(path.resolve(ROOT, "mingla-business", file), "utf8");
      expect(source).toMatch(/brandLocation(: geoPointFrom\(|,)/);
    }
  });
});

describe("Issue #3291 — the event's saved location text", () => {
  test("location_text keeps the tapped street after the venue name", async () => {
    const { pickedLabel } = await pickThroughPicker(
      STREET,
      details("Ozumba Mbadiwe Avenue, Lagos 10, Lagos, Nigeria", "street"),
    );
    const draft = {
      ...buildDraftEvent("brand-3291", "d_3291", "2026-09-12T00:00:00.000Z"),
      venueName: "Harmattan Club",
      address: pickedLabel ?? null,
    };
    const update = draftToServerUpdate(draft, {});
    expect(update.location_text).toBe(
      "Harmattan Club · Ozumba Mbadiwe Avenue, Lagos 10, Lagos, Nigeria",
    );
    expect(draftToServerInsert(draft, "user-3291", "slug-3291").location_text).toContain(
      "Ozumba Mbadiwe Avenue",
    );
  });
});
