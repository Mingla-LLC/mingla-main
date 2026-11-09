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
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {} },
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
jest.mock("../../../utils/staticMapImage", () => ({
  buildStaticMapUrl: (params: { lat: number | null; lng: number | null; zoom: number }) =>
    buildStaticMapUrl(params),
  // #4334 F-1 — the REAL shared renderer (it sizes the request to the box).
  StaticMapImage: jest.requireActual(
    "../../../../../packages/offering-rendering/StaticMapFrame",
  ).StaticMapImage,
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

/** Lay the map box out at a width (as the device would). */
function layout(r: ReturnType<typeof mount>, width: number, height = 160): void {
  const box = r.root.findAll((n) => n.type === "view" && n.props.testID === "map")[0];
  TestRenderer.act(() => {
    (box.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { width, height } } });
  });
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
    // #4334 F-1 — nothing is fetched until the box is measured
    expect(r.root.findAll((n) => n.type === "image")).toHaveLength(0);
    layout(r, 343);
    const [image] = r.root.findAll((n) => n.type === "image");
    expect(image.props.source).toEqual({
      uri: "https://maps.test/static?c=-0.1276%2C51.5034&z=14&w=343&h=160",
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

  test("#4334 F-1: at 320 / 375 / 430 pt the request has the box's own aspect (no cover crop of Google's logo or attribution)", () => {
    for (const phone of [320, 375, 430]) {
      const r = mount({ lat: 51.5034, lng: -0.1276 });
      const boxWidth = phone - 32;
      layout(r, boxWidth);
      const [image] = r.root.findAll((n) => n.type === "image");
      const q = new URL((image.props.source as { uri: string }).uri).searchParams;
      const w = Number(q.get("w"));
      const h = Number(q.get("h"));
      expect(Math.abs(w / h - boxWidth / 160) / (boxWidth / 160)).toBeLessThan(0.02);
      void TestRenderer.act(() => r.unmount());
    }
  });

  test("#4334 F-10: one pin only — Google's marker; no second drawn pin", () => {
    const r = mount({ lat: 51.5034, lng: -0.1276 });
    layout(r, 343);
    const views = r.root.findAll((n) => n.type === "view");
    // the box itself and nothing pin-shaped (32×32 round dot) inside it
    expect(
      views.filter((v) => JSON.stringify(v.props.style ?? "").includes('"width":32')),
    ).toHaveLength(0);
    void TestRenderer.act(() => r.unmount());
  });
});
