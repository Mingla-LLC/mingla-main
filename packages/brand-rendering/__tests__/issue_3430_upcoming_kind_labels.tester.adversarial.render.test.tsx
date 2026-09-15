/**
 * #3430 — TESTER adversarial render proof for public-brand kind labels.
 *
 * The fixtures deliberately feed every hostile lowercase routing enum into the
 * real shared page. Human-facing text must resolve to the approved display copy
 * while callbacks keep the original objects and their lowercase control values.
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
  children?: Array<Node | string>;
};
type Renderer = {
  root: { findAll: (fn: (node: Node) => boolean) => Node[] };
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

type Kind = PublicBrandUpcoming["offeringType"];

const hostileKinds: Kind[] = ["event", "rsvp", "trip", "experience"];
const approvedKinds = ["Event", "RSVP", "Trip", "Experience"];
const forbiddenVisibleKinds = [...hostileKinds, "Rsvp"];

const offering = (
  section: "upcoming" | "now" | "past",
  offeringType: Kind,
  name: string,
): PublicBrandUpcoming => ({
  offeringId: `${section}-${offeringType}`,
  brandId: "brand-hostile",
  brandSlug: "hostile-enum-fixture",
  brandName: "Hostile Enum Fixture",
  offeringType,
  offeringSlug: `${section}-${offeringType}`,
  name,
  bio: null,
  coverMediaUrl: null,
  coverMediaType: null,
  theme: null,
  startsAt: "2026-09-15T18:00:00Z",
  endsAt:
    section === "now"
      ? "2026-09-15T22:00:00Z"
      : section === "past"
        ? "2026-09-14T22:00:00Z"
        : null,
  priceFromMinorUnits: section === "past" ? null : 2800,
  currency: "USD",
  isFree: false,
  publishedAt: "2026-09-01T00:00:00Z",
});

const upcoming = [
  offering("upcoming", "event", "Alpha"),
  offering("upcoming", "rsvp", "Bravo"),
  offering("upcoming", "trip", "Charlie"),
  offering("upcoming", "experience", "Delta"),
];
const happeningNow = [
  offering("now", "event", "Echo"),
  offering("now", "rsvp", "Foxtrot"),
  offering("now", "trip", "Golf"),
  offering("now", "experience", "Hotel"),
];
const past = [
  offering("past", "event", "India"),
  offering("past", "rsvp", "Juliet"),
  offering("past", "trip", "Kilo"),
  offering("past", "experience", "Lima"),
];

const expectedUpcomingLabels = [
  "Open Event Alpha",
  "Open RSVP Bravo",
  "Open Trip Charlie",
  "Open Experience Delta",
];

const textLeaves = (node: Node | string): string[] =>
  typeof node === "string"
    ? [node]
    : (node.children ?? []).flatMap((child) => textLeaves(child));

const uniqueNodesByLabel = (nodes: Node[]): Node[] => {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    const label = node.props.accessibilityLabel as string;
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
};

const cardsForLabels = (tree: Renderer, labels: string[]): Node[] =>
  labels.map((label) => {
    const card = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === label &&
        node.props.accessibilityRole === "button" &&
        typeof node.props.onPress === "function",
    )[0];
    expect(card).toBeDefined();
    return card;
  });

const sectionCards = (tree: Renderer, section: "happening_now" | "past") =>
  uniqueNodesByLabel(
    tree.root.findAll(
      (node) =>
        node.props.testID === `brand-section-card-${section}` &&
        typeof node.props.accessibilityLabel === "string" &&
        typeof node.props.onPress === "function",
    ),
  );

const assertHumanCopy = (cards: Node[], expectedPrefixes: string[]): void => {
  expect(cards).toHaveLength(4);
  const labels = cards.map((card) => card.props.accessibilityLabel as string);
  expectedPrefixes.forEach((prefix, index) => {
    expect(labels[index]?.startsWith(prefix)).toBe(true);
  });
  labels.forEach((label) => {
    expect(label).not.toMatch(/\b(?:event|rsvp|trip|experience)\b/);
    expect(label).not.toContain("Rsvp");
  });
  expect(
    cards.map((card) =>
      textLeaves(card).filter((text) => approvedKinds.includes(text)),
    ),
  ).toEqual(approvedKinds.map((kind) => [kind]));
  expect(
    cards
      .flatMap(textLeaves)
      .filter((text) => forbiddenVisibleKinds.includes(text)),
  ).toEqual([]);
};

const pressTab = async (tree: Renderer, label: "Upcoming" | "Past") => {
  const tab = tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onLayout === "function" &&
      typeof node.props.onPress === "function",
  )[0];
  expect(tab).toBeDefined();
  await act(async () => {
    (tab?.props.onPress as () => void)();
  });
};

beforeEach(() => {
  jest
    .spyOn(AppState, "addEventListener")
    .mockReturnValue({ remove: () => undefined } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("hostile lowercase enums stay internal across Upcoming, Happening now, Past, and taps", async () => {
  const onOpenUpcoming = jest.fn<void, [PublicBrandUpcoming]>();
  const props: PublicBrandPageProps = {
    brand: {
      id: "brand-hostile",
      slug: "hostile-enum-fixture",
      displayName: "Hostile Enum Fixture",
      address: null,
      coverHue: 19,
    },
    events: [],
    trips: [],
    upcoming,
    happeningNow,
    past,
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

  await pressTab(tree, "Upcoming");

  const upcomingCards = cardsForLabels(tree, expectedUpcomingLabels);
  // Vacuity guard before negative checks: all four hostile inputs rendered.
  expect(upcomingCards).toHaveLength(4);
  assertHumanCopy(upcomingCards, expectedUpcomingLabels);

  const allAccessibleLabels = Array.from(
    new Set(
      tree.root
        .findAll((node) => typeof node.props.accessibilityLabel === "string")
        .map((node) => node.props.accessibilityLabel as string),
    ),
  );
  expect(
    allAccessibleLabels.filter((label) =>
      [
        "Open event ",
        "Open rsvp ",
        "Open trip ",
        "Open experience ",
        "Open Rsvp ",
      ].some((prefix) => label.startsWith(prefix)),
    ),
  ).toEqual([]);

  assertHumanCopy(sectionCards(tree, "happening_now"), [
    "Open Event Echo. Happening now",
    "Open RSVP Foxtrot. Happening now",
    "Open Trip Golf. Happening now",
    "Open Experience Hotel. Happening now",
  ]);

  for (const [index, card] of upcomingCards.entries()) {
    await act(async () => {
      (card.props.onPress as () => void)();
    });
    expect(onOpenUpcoming.mock.calls[index]?.[0]).toBe(upcoming[index]);
    expect(onOpenUpcoming.mock.calls[index]?.[0].offeringType).toBe(
      hostileKinds[index],
    );
  }
  expect(onOpenUpcoming).toHaveBeenCalledTimes(4);

  await pressTab(tree, "Past");
  assertHumanCopy(sectionCards(tree, "past"), [
    "Open Event India. Ended",
    "Open RSVP Juliet. Ended",
    "Open Trip Kilo. Ended",
    "Open Experience Lima. Ended",
  ]);

  await act(async () => tree.unmount());
});
