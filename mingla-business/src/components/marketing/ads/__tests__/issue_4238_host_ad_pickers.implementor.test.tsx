/**
 * #4238 — render proof for the Host ads page picker and the country picker.
 *
 * T-B5: cards show type, date and city with no URL, and the type filter
 * narrows the list. T-C3: the shared country picker keeps the phone default
 * (dial code shown and searched) and hides dial codes when asked.
 */

import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = {
  props: Record<string, unknown>;
  type: unknown;
  children: (RenderNode | string)[];
};
type Renderer = {
  root: {
    findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
  };
  unmount: () => void;
};

// The repository intentionally omits declarations for this test-only renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => Renderer;
};

jest.mock("react-native", () => {
  const base = jest.requireActual("react-native") as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require("react") as typeof React;
  // Render every row so the picker's rows are inspectable.
  const FlatList = ({
    data,
    renderItem,
  }: {
    data: readonly unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactElement;
  }) =>
    ReactLib.createElement(
      "FlatList",
      null,
      data.map((item, index) =>
        ReactLib.cloneElement(renderItem({ item, index }), { key: String(index) }),
      ),
    );
  return { ...base, FlatList, Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default } };
});
jest.mock("../../../../../../packages/phone-input/keyboardPrimitives", () => ({
  KeyboardProvider: ({ children }: { children: React.ReactNode }) => children,
  KeyboardToolbar: () => null,
}));
jest.mock(
  "react-native-safe-area-context",
  () => ({
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  }),
  { virtual: true },
);
jest.mock(
  "expo-haptics",
  () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }),
  { virtual: true },
);

// eslint-disable-next-line import/first
import { HostAdPagePicker } from "../HostAdPagePicker";
// eslint-disable-next-line import/first
import { CountryPickerModal } from "../../../../../../packages/phone-input/CountryPickerModal";
// eslint-disable-next-line import/first
import type { HostAdPage } from "../../../../services/hostAdPlanService";

const pages: HostAdPage[] = [
  {
    page_type: "event",
    id: "e1",
    brand_slug: "femzy",
    entity_slug: "deserted-island",
    title: "Deserted Island",
    brand_name: "Femzy",
    canonical_url: "https://usemingla.com/e/femzy/deserted-island",
    availability: "available",
    starts_at: "2026-12-05T12:00:00Z",
    city: "Lagos",
    cover_url: "https://cdn.example/cover.mp4",
    result_kind: "tickets",
  },
  {
    page_type: "venue",
    id: "v1",
    brand_slug: "femzy",
    entity_slug: "femzy-lounge",
    title: "Femzy Lounge",
    brand_name: "Femzy",
    canonical_url: "https://usemingla.com/v/femzy/femzy-lounge",
    availability: "available",
    starts_at: null,
    city: "Abuja",
    cover_url: "https://cdn.example/lounge.jpg",
    result_kind: "bookings",
  },
  {
    page_type: "brand",
    id: "b1",
    brand_slug: "femzy",
    entity_slug: null,
    title: "Femzy",
    brand_name: "Femzy",
    canonical_url: "https://usemingla.com/b/femzy",
    availability: "available",
    starts_at: null,
    city: null,
    cover_url: null,
    result_kind: "clicks",
  },
];

const textOf = (node: RenderNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

function render(element: React.ReactElement): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = create(element);
  });
  return renderer as unknown as Renderer;
}

const byTestId = (renderer: Renderer, id: string): RenderNode[] =>
  renderer.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === id,
  );

describe("#4238 HostAdPagePicker (T-B5)", () => {
  it("shows type, date and city, never a URL, and filters by type", () => {
    const onSelect = jest.fn();
    const renderer = render(
      <HostAdPagePicker pages={pages} selected={null} onSelect={onSelect} />,
    );
    const all = textOf(renderer.root as unknown as RenderNode);
    expect(all).not.toContain("https://");
    // The type shows once, as a badge; the detail line is date and city.
    expect(all).toContain("Sat 5 Dec · Lagos");
    expect(all).not.toContain("Event · Sat 5 Dec");
    expect(all).toContain("Abuja");
    expect(all).not.toContain("Venue · Abuja");
    expect(all).toContain("Brand page");
    // Inside one card the type appears once (the badge), never in the details.
    const brandRow = textOf(byTestId(renderer, "host-ad-page-b1")[0]);
    expect(brandRow.split("Brand page").length - 1).toBe(1);
    const eventRow = textOf(byTestId(renderer, "host-ad-page-e1")[0]);
    expect(eventRow.split("Event").length - 1).toBe(1);

    const event = byTestId(renderer, "host-ad-page-e1")[0];
    expect(event.props.accessibilityLabel).toBe(
      "Deserted Island, Event, Sat 5 Dec, Lagos",
    );
    // A video cover is never drawn as an image; the jpg is.
    const images = renderer.root.findAll(
      (node) => node.type === "Image" && typeof node.props.source === "object",
    );
    expect(
      images.map((node) => (node.props.source as { uri: string }).uri),
    ).toEqual(["https://cdn.example/lounge.jpg"]);

    act(() => {
      (byTestId(renderer, "host-ad-page-filter-venue")[0].props.onPress as () => void)();
    });
    expect(byTestId(renderer, "host-ad-page-e1")).toHaveLength(0);
    expect(byTestId(renderer, "host-ad-page-v1")).toHaveLength(1);

    act(() => {
      (byTestId(renderer, "host-ad-page-v1")[0].props.onPress as () => void)();
    });
    expect(onSelect).toHaveBeenCalledWith(pages[1]);
    renderer.unmount();
  });

  it("explains an empty brand instead of showing nothing", () => {
    const renderer = render(
      <HostAdPagePicker pages={[]} selected={null} onSelect={jest.fn()} />,
    );
    expect(textOf(byTestId(renderer, "host-ad-page-empty")[0])).toContain(
      "You don't have a public page to promote yet.",
    );
    renderer.unmount();
  });

  it("hides type filters when the brand has only one type", () => {
    const renderer = render(
      <HostAdPagePicker pages={[pages[0]]} selected={null} onSelect={jest.fn()} />,
    );
    expect(byTestId(renderer, "host-ad-page-filter-all")).toHaveLength(0);
    renderer.unmount();
  });
});

describe("#4238 CountryPickerModal showDialCode (T-C3, SC-16)", () => {
  const props = {
    visible: true,
    selectedCode: null,
    onSelect: jest.fn(),
    onClose: jest.fn(),
    iconRenderer: () => <></>,
    labels: {
      pickerTitle: "Select country",
      pickerSearchPlaceholder: "Search",
      pickerCloseAccessibilityLabel: "Close",
    },
  };
  const nigeriaRow = (renderer: Renderer): RenderNode | undefined =>
    renderer.root.findAll(
      (node) =>
        typeof node.type !== "string" &&
        typeof node.props.accessibilityLabel === "string" &&
        String(node.props.accessibilityLabel).startsWith("Nigeria") &&
        node.props.accessibilityRole === "button",
    )[0];

  it("keeps the phone default: dial code shown and announced", () => {
    const renderer = render(<CountryPickerModal {...props} />);
    const row = nigeriaRow(renderer);
    expect(row?.props.accessibilityLabel).toBe("Nigeria +234");
    expect(textOf(row as RenderNode)).toContain("+234");
    renderer.unmount();
  });

  it("hides dial codes for a country-only picker", () => {
    const renderer = render(<CountryPickerModal {...props} showDialCode={false} />);
    const row = nigeriaRow(renderer);
    expect(row?.props.accessibilityLabel).toBe("Nigeria");
    expect(textOf(row as RenderNode)).not.toContain("+234");
    renderer.unmount();
  });
});
