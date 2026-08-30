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
import { AccessibilityInfo, AppState } from "react-native";
import type { PublicBrandPageProps, PublicBrandEvent } from "../types";
import { PublicBrandPage } from "../PublicBrandPage";

type Node = { props: Record<string, unknown>; children?: Node[] };
type Renderer = {
  root: { findAll: (fn: (node: Node) => boolean) => Node[] };
  toJSON: () => unknown;
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (
    node: React.ReactElement,
    options?: { createNodeMock?: (element: React.ReactElement) => unknown },
  ) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const event = (
  id: string,
  eventType: "event" | "rsvp",
  start: string,
  end: string,
): PublicBrandEvent => ({
  id,
  name: id,
  brandSlug: "brand",
  eventSlug: id,
  status: "scheduled",
  eventType,
  operatorEndedAtUtc: null,
  terminalSource:
    eventType === "rsvp"
      ? { kind: "single_end", endAtUtc: end }
      : {
          kind: "occurrences",
          value: [
            {
              id: `${id}-day`,
              startAt: start,
              endAt: end,
              timezone: "UTC",
              isMaster: true,
            },
          ],
        },
  masterStartAtUtc: start,
  masterEndAtUtc: end,
  masterTimezone: "UTC",
  dateLine: id,
  venueName: "Venue",
  format: "in_person",
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  currency: "USD",
  tickets:
    eventType === "event"
      ? [{ priceGbp: 10, currency: "USD", isFree: false }]
      : [],
});
const props: PublicBrandPageProps = {
  brand: {
    id: "b",
    slug: "brand",
    displayName: "Brand",
    address: null,
    coverHue: 25,
  },
  events: [
    event(
      "ticket-later",
      "event",
      "2026-08-11T14:00:00Z",
      "2026-08-11T15:00:00Z",
    ),
    event("rsvp-first", "rsvp", "2026-08-11T13:00:00Z", "2026-08-11T13:00:01Z"),
    event("elapsed", "event", "2026-08-10T13:00:00Z", "2026-08-10T15:00:00Z"),
  ],
  trips: [],
  callbacks: {
    onClose: () => undefined,
    onShare: () => undefined,
    onOpenEvent: () => undefined,
    onOpenTrip: () => undefined,
  },
};

test("mounted shared brand page shows ordered current ticket+RSVP cards then removes boundary row", async () => {
  jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
    .mockResolvedValue(true);
  jest
    .spyOn(AppState, "addEventListener")
    .mockReturnValue({ remove: () => undefined });
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-11T13:00:00Z"));
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<PublicBrandPage {...props} />);
  });
  const eventsTab = tree.root.findAll(
    (node) => node.props.accessibilityLabel === "Events",
  )[0];
  expect(eventsTab).toBeDefined();
  await act(async () => {
    (eventsTab?.props.onPress as () => void)();
  });
  const labels = () =>
    tree.root
      .findAll((node) => typeof node.props.accessibilityLabel === "string")
      .map((node) => node.props.accessibilityLabel as string);
  expect(labels()).toContain("Open RSVP event rsvp-first. rsvp-first.");
  expect(labels()).toContain(
    "Open event ticket-later. Tickets. ticket-later. From $10.",
  );
  expect(
    labels().findIndex((label) => label.includes("rsvp-first")),
  ).toBeLessThan(labels().findIndex((label) => label.includes("ticket-later")));
  expect(labels().some((label) => label.includes("elapsed"))).toBe(false);
  expect(JSON.stringify(tree.toJSON())).not.toContain("Past");
  const focusedCard = tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel ===
      "Open RSVP event rsvp-first. rsvp-first.",
  )[0];
  await act(async () => {
    (focusedCard?.props.onFocus as () => void)();
  });
  await act(async () => {
    jest.advanceTimersByTime(1_000);
  });
  expect(labels().some((label) => label.includes("rsvp-first"))).toBe(false);
  expect(
    tree.root.findAll(
      (node) =>
        (node.props.focusRequest as { tab?: string } | null)?.tab === "events",
    ).length,
  ).toBeGreaterThan(0);
  await act(async () => {
    tree.unmount();
  });
  jest.useRealTimers();
});

test("partial expiry does not steal focus when the expired card was not focused", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-11T13:00:00Z"));
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<PublicBrandPage {...props} />);
  });
  const eventsTab = tree.root.findAll(
    (node) => node.props.accessibilityLabel === "Events",
  )[0];
  await act(async () => {
    (eventsTab?.props.onPress as () => void)();
    jest.advanceTimersByTime(1_000);
  });
  expect(
    tree.root.findAll(
      (node) =>
        (node.props.focusRequest as { tab?: string } | null)?.tab === "events",
    ),
  ).toHaveLength(0);
  await act(async () => {
    tree.unmount();
  });
  jest.useRealTimers();
});
