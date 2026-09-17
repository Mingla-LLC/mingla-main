/**
 * #3430 — IMPLEMENTOR render proof for human-readable Upcoming kind labels.
 *
 * Raw lowercase offering enums are data/control values for keys, callbacks and
 * routing. They must never be rendered to people in visible or accessible copy.
 *
 * The real shared `PublicBrandPage` is mounted through the existing RN-web
 * harness with one Upcoming row of every supported kind.
 */

jest.mock("lucide-react-native", () => {
  const React = require("react");
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("mock-icon", { ...props, name });
  return new Proxy(
    {},
    {
      get: (_target, key: string) => (key === "__esModule" ? true : icon(key)),
    },
  );
});
jest.mock("@mingla/offering-rendering", () => {
  const React = require("react");
  const { View } = require("react-native");
  const lifecycle = jest.requireActual(
    "../../offering-rendering/eventAcquisitionLifecycle",
  );
  const theme = {
    color: "#f60",
    foregroundColor: "#fff",
    font: "inter",
    fontFamilyValue: "Inter",
    animation: "none",
  };
  const palette = {
    page: "#fff",
    card: "#fff",
    panelBorder: "#ddd",
    accent: "#f60",
    accentWash: "#fee",
    accentText: "#fff",
    primaryText: "#111",
    secondaryText: "#333",
    tertiaryText: "#666",
  };
  return {
    ...lifecycle,
    MINGLA_DEFAULT_THEME: theme,
    resolveTheme: () => theme,
    createThemePalette: () => palette,
    offeringSurfaceStyles: () => ({
      card: {},
      cardStrong: {},
      primaryText: {},
      secondaryText: {},
    }),
    useResponsiveLayout: () => ({ isDesktop: false }),
    EventCoverMedia: () => React.createElement(View),
    ParallaxCoverShell: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
  };
});

import React from "react";
import { AppState } from "react-native";
import { PublicBrandPage } from "../PublicBrandPage";
import type { PublicBrandPageProps, PublicBrandUpcoming } from "../types";

type Node = {
  props: Record<string, unknown>;
};
type JsonNode = {
  children?: Array<JsonNode | string>;
};
type Renderer = {
  root: { findAll: (fn: (node: Node) => boolean) => Node[] };
  toJSON: () => JsonNode | JsonNode[] | null;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const offering = (
  offeringType: PublicBrandUpcoming["offeringType"],
): PublicBrandUpcoming => ({
  offeringId: `${offeringType}-1`,
  brandId: "brand-1",
  brandSlug: "lantern-room",
  brandName: "Lantern Room",
  offeringType,
  offeringSlug: `${offeringType}-one`,
  name: `${offeringType} one`,
  bio: null,
  coverMediaUrl: null,
  coverMediaType: null,
  theme: null,
  startsAt: "2026-10-01T18:00:00Z",
  endsAt: null,
  priceFromMinorUnits: null,
  currency: "GBP",
  isFree: false,
  publishedAt: "2026-09-15T00:00:00Z",
});

const rows: PublicBrandUpcoming[] = [
  offering("event"),
  offering("rsvp"),
  offering("trip"),
  offering("experience"),
];

const mount = async (
  onOpenUpcoming: (item: PublicBrandUpcoming) => void,
): Promise<Renderer> => {
  const props: PublicBrandPageProps = {
    brand: {
      id: "brand-1",
      slug: "lantern-room",
      displayName: "Lantern Room",
      address: null,
      coverHue: 25,
    },
    events: [],
    trips: [],
    upcoming: rows,
    callbacks: {
      onClose: () => undefined,
      onShare: () => undefined,
      onOpenEvent: () => undefined,
      onOpenTrip: () => undefined,
      onOpenUpcoming,
    },
  };
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<PublicBrandPage {...props} />);
  });
  const upcomingTab = tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === "Upcoming" &&
      typeof node.props.onPress === "function",
  )[0];
  expect(upcomingTab).toBeDefined();
  await act(async () => {
    (upcomingTab?.props.onPress as () => void)();
  });
  return tree;
};

const visibleText = (node: JsonNode | JsonNode[] | null): string[] => {
  if (node === null) return [];
  if (Array.isArray(node)) return node.flatMap(visibleText);
  return (node.children ?? []).flatMap((child) =>
    typeof child === "string" ? [child] : visibleText(child),
  );
};

beforeEach(() => {
  jest
    .spyOn(AppState, "addEventListener")
    .mockReturnValue({ remove: () => undefined } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("Upcoming presents all four human labels and preserves the raw callback object", async () => {
  const onOpenUpcoming = jest.fn<void, [PublicBrandUpcoming]>();
  const tree = await mount(onOpenUpcoming);

  const expectedLabels = [
    "Open Event event one",
    "Open RSVP rsvp one",
    "Open Trip trip one",
    "Open Experience experience one",
  ];
  const cards = tree.root
    .findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        typeof node.props.accessibilityLabel === "string" &&
        expectedLabels.includes(node.props.accessibilityLabel as string),
    )
    .map((node) => node.props.accessibilityLabel as string)
    .filter((label, index, all) => all.indexOf(label) === index);

  // Vacuity guard: all four real Upcoming cards must exist before copy checks.
  expect(cards).toHaveLength(4);
  expect(cards).toEqual(expectedLabels);
  expect(
    visibleText(tree.toJSON()).filter((text) =>
      ["Event", "RSVP", "Trip", "Experience"].includes(text),
    ),
  ).toEqual(["Event", "RSVP", "Trip", "Experience"]);

  const rsvpCard = tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === "Open RSVP rsvp one" &&
      typeof node.props.onPress === "function",
  )[0];
  await act(async () => {
    (rsvpCard?.props.onPress as () => void)();
  });
  expect(onOpenUpcoming).toHaveBeenCalledTimes(1);
  expect(onOpenUpcoming.mock.calls[0]?.[0]).toBe(rows[1]);
  expect(onOpenUpcoming.mock.calls[0]?.[0].offeringType).toBe("rsvp");

  await act(async () => tree.unmount());
});
