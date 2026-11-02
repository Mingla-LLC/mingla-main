/**
 * #3355 — the shared map preview under every Host address field (the event
 * "Where" step and Brand Edit), rendered.
 *
 * REAL-DATA-ONLY: no point (or no map URL) shows the honest "pick an address"
 * empty state, never a fake tile. A point shows the real static map; a point
 * placed from free text zooms out and says "Approximate location".
 */
import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void) => void;
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
    Image: host("image"),
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Text: host("text"),
    View: host("view"),
  };
});
jest.mock("../../../constants/designSystem", () => ({
  accent: { warm: "#eb7825" },
  glass: { border: { profileBase: "x" }, tint: { profileBase: "x" } },
  radius: { lg: 16, full: 999 },
  spacing: { xs: 4, sm: 8, md: 16 },
  text: { primary: "white", quaternary: "grey" },
  typography: { caption: { fontSize: 12 } },
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
const buildStaticMapUrl = jest.fn(
  (params: { lat: number | null; lng: number | null; zoom: number }) =>
    params.lat === null || params.lng === null
      ? null
      : `https://maps.test/static?c=${params.lng},${params.lat}&z=${params.zoom}`,
);
jest.mock("../../../utils/mapboxStaticImage", () => ({
  buildStaticMapUrl: (params: { lat: number | null; lng: number | null; zoom: number }) =>
    buildStaticMapUrl(params),
}));

const { AddressMapPreview, ADDRESS_MAP_PREVIEW_EMPTY_COPY } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../AddressMapPreview") as typeof import("../AddressMapPreview");

function mount(props: {
  lat: number | null;
  lng: number | null;
  approximate?: boolean;
}) {
  let r!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    r = TestRenderer.create(
      <AddressMapPreview
        lat={props.lat}
        lng={props.lng}
        approximate={props.approximate}
        accessibilityLabel="Map of 10 Downing Street"
        testID="map"
      />,
    );
  });
  return r;
}

const texts = (r: ReturnType<typeof mount>): unknown[] =>
  r.root.findAll((n) => n.type === "text").map((n) => n.props.children);

beforeEach(() => buildStaticMapUrl.mockClear());

describe("#3355 — shared address map preview", () => {
  test("no point: the honest empty state, no map image", () => {
    const r = mount({ lat: null, lng: null });
    expect(r.root.findAll((n) => n.type === "image")).toHaveLength(0);
    expect(texts(r)).toEqual([ADDRESS_MAP_PREVIEW_EMPTY_COPY]);
    expect(ADDRESS_MAP_PREVIEW_EMPTY_COPY).toBe("Pick an address to preview the map");
    expect(
      r.root.findAll((n) => n.type === "view" && n.props.testID === "map-empty"),
    ).toHaveLength(1);
    void TestRenderer.act(() => r.unmount());
  });

  test("a picked point: the real static map, precise zoom, read out by name", () => {
    const r = mount({ lat: 51.5034, lng: -0.1276 });
    expect(buildStaticMapUrl).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 51.5034, lng: -0.1276, zoom: 14 }),
    );
    const [image] = r.root.findAll((n) => n.type === "image");
    expect(image.props.source).toEqual({
      uri: "https://maps.test/static?c=-0.1276,51.5034&z=14",
    });
    expect(image.props.accessibilityLabel).toBe("Map of 10 Downing Street");
    expect(texts(r)).not.toContain("Approximate location");
    void TestRenderer.act(() => r.unmount());
  });

  test("a point placed from free text zooms out and says it is approximate", () => {
    const r = mount({ lat: 51.5, lng: -0.12, approximate: true });
    expect(buildStaticMapUrl).toHaveBeenCalledWith(
      expect.objectContaining({ zoom: 11 }),
    );
    expect(texts(r)).toContain("Approximate location");
    void TestRenderer.act(() => r.unmount());
  });
});
