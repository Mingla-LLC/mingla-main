/**
 * #3355 P5 (C3) — Brand Edit's address field, rendered.
 *
 * The field is the brand-creation search (`AddressInput`) with the
 * brand's saved point for ranking. A legacy free-text address loads as the
 * selected address (no forced re-search); a pick writes address, city,
 * country and point together; "use what you typed" is placed through the
 * shared `resolveFreeTextLocation`, and its point is approximate.
 */
import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
  create: (node: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    unmount: () => void;
  };
};

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement(name, props, children);
  return {
    StyleSheet: { create: (styles: unknown) => styles },
    Text: host("text"),
    View: host("view"),
  };
});
jest.mock("../../../constants/designSystem", () => ({
  spacing: { xs: 4, sm: 8 },
  text: { secondary: "grey" },
  typography: { caption: { fontSize: 12 } },
}));
jest.mock("../../location/AddressInput", () => ({
  AddressInput: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("mapbox-address-input", props),
}));
jest.mock("../../location/AddressMapPreview", () => ({
  AddressMapPreview: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("address-map-preview", props),
}));
const forwardHierarchyMapbox = jest.fn();
jest.mock("../../../services/placesService", () => ({
  forwardHierarchyMapbox: (...args: unknown[]) => forwardHierarchyMapbox(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BrandEditAddressField } = require("../BrandEditAddressField") as typeof import("../BrandEditAddressField");
type Patch = import("../../../utils/brandAddressPatch").BrandAddressPatch;

function mount(props: {
  address: string | null;
  city?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  onChange: (patch: Patch) => void;
}) {
  let r!: ReturnType<typeof TestRenderer.create>;
  void TestRenderer.act(() => {
    r = TestRenderer.create(
      <BrandEditAddressField
        address={props.address}
        city={props.city}
        countryCode={props.countryCode}
        lat={props.lat}
        lng={props.lng}
        onChange={props.onChange}
        testID="brand-address"
      />,
    );
  });
  return r;
}

const input = (r: ReturnType<typeof mount>): Node =>
  r.root.findAll((n) => n.type === "mapbox-address-input")[0];

beforeEach(() => forwardHierarchyMapbox.mockReset());

describe("#3355 P5 — Brand Edit address field, rendered", () => {
  test("an untouched legacy free-text address loads as the selected address, no re-search", () => {
    const changes: Patch[] = [];
    const legacy = "Upstairs at the Old Fire Station, ask for Tunde";
    const r = mount({ address: legacy, onChange: (p) => changes.push(p) });
    const field = input(r);
    expect(field.props.value).toBe(legacy);
    expect(field.props.selectionState).toBe("selected");
    expect(field.props.selectedLabel).toBe(legacy);
    expect(field.props.allowFreeText).toBe(true);
    expect(changes).toEqual([]);
    expect(forwardHierarchyMapbox).not.toHaveBeenCalled();
    void TestRenderer.act(() => r.unmount());
  });

  test("an empty address opens in editing; the city/country line says what is missing", () => {
    const r = mount({ address: null, onChange: () => undefined });
    expect(input(r).props.selectionState).toBe("editing");
    const line = r.root.findAll(
      (n) => n.type === "text" && n.props.testID === "brand-address-city-country",
    )[0];
    expect(line.props.children).toBe(
      "No city or country yet. Pick your address to set them.",
    );
    void TestRenderer.act(() => r.unmount());
  });

  test("ranking uses the brand's saved point and country", () => {
    const r = mount({
      address: "1 Old Arch, London",
      city: "London",
      countryCode: "GB",
      lat: 51.5,
      lng: -0.1,
      onChange: () => undefined,
    });
    expect(input(r).props.proximitySources).toEqual({
      brandPoint: { lat: 51.5, lng: -0.1, countryCode: "GB" },
      draftPoint: null,
    });
    void TestRenderer.act(() => r.unmount());
  });

  test("a picked place writes address, city, country and point together; never a Mapbox id", () => {
    const changes: Patch[] = [];
    const r = mount({ address: "", onChange: (p) => changes.push(p) });
    void TestRenderer.act(() => {
      (input(r).props.onPick as (details: unknown, label?: string) => void)(
        {
          placeId: "dXJuOm1ieHBvaTo",
          formattedAddress: "12 Harbour Street, Margate CT9 1EU, United Kingdom",
          city: "Margate",
          region: "England",
          regionCode: null,
          regionCodeFull: null,
          countryCode: "gb",
          location: { lat: 51.3891, lng: 1.3863 },
        },
        "12 Harbour Street, Margate",
      );
    });
    expect(changes).toEqual([
      {
        address: "12 Harbour Street, Margate",
        city: "Margate",
        countryCode: "GB",
        lat: 51.3891,
        lng: 1.3863,
      },
    ]);
    expect(JSON.stringify(changes)).not.toContain("dXJuOm1ieHBvaTo");
    expect(input(r).props.selectionState).toBe("selected");
    void TestRenderer.act(() => r.unmount());
  });

  test("'use what you typed' is placed by the shared search and the map says approximate", async () => {
    forwardHierarchyMapbox.mockResolvedValue({
      details: {
        lat: 51.38,
        lng: 1.38,
        city: "Margate",
        region: "England",
        countryCode: "GB",
      },
      matchLevel: "city",
    });
    const changes: Patch[] = [];
    const r = mount({
      address: "",
      city: "London",
      countryCode: "GB",
      onChange: (p) => changes.push(p),
    });
    await TestRenderer.act(async () => {
      (input(r).props.onFreeText as (label: string) => void)("The pier, Margate");
    });
    expect(forwardHierarchyMapbox).toHaveBeenCalledWith("The pier, Margate", {
      city: "London",
      countryCode: "GB",
    });
    expect(changes[0]).toEqual({ address: "The pier, Margate" });
    expect(changes[1]).toMatchObject({
      address: "The pier, Margate",
      city: "Margate",
      countryCode: "GB",
      lat: 51.38,
      lng: 1.38,
    });
    const preview = r.root.findAll((n) => n.type === "address-map-preview")[0];
    expect(preview.props.approximate).toBe(true);
    void TestRenderer.act(() => r.unmount());
  });

  test("the map preview is the shared one, at the brand's point; a cleared address shows no old pin", () => {
    const changes: Patch[] = [];
    const r = mount({
      address: "1 Old Arch, London",
      lat: 51.5,
      lng: -0.1,
      onChange: (p) => changes.push(p),
    });
    const preview = (): Node =>
      r.root.findAll((n) => n.type === "address-map-preview")[0];
    expect(preview().props).toMatchObject({
      lat: 51.5,
      lng: -0.1,
      approximate: false,
      accessibilityLabel: "Map of 1 Old Arch, London",
    });
    void TestRenderer.act(() => {
      (input(r).props.onClear as () => void)();
    });
    expect(changes).toEqual([{ address: null }]);
    void TestRenderer.act(() => r.unmount());
    const cleared = mount({ address: "", lat: 51.5, lng: -0.1, onChange: () => undefined });
    const empty = cleared.root.findAll((n) => n.type === "address-map-preview")[0];
    expect(empty.props.lat).toBeNull();
    expect(empty.props.lng).toBeNull();
    void TestRenderer.act(() => cleared.unmount());
  });
});
