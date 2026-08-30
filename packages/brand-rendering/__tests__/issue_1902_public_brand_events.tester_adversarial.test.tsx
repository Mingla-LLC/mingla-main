jest.mock("lucide-react-native", () => {
  const React = require("react");
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("mock-icon", { ...props, name });
  return new Proxy({}, { get: (_target, key: string) => (key === "__esModule" ? true : icon(key)) });
});
jest.mock("@mingla/offering-rendering", () => {
  const React = require("react");
  const { View } = require("react-native");
  const lifecycle = jest.requireActual("../../offering-rendering/eventAcquisitionLifecycle");
  const theme = { color: "#f60", foregroundColor: "#fff", font: "inter", fontFamilyValue: "Inter", animation: "none" };
  const palette = {
    page: "#fff", card: "#fff", panelBorder: "#ddd", accent: "#f60", accentWash: "#fee",
    accentText: "#fff", primaryText: "#111", secondaryText: "#333", tertiaryText: "#666",
  };
  return {
    ...lifecycle,
    MINGLA_DEFAULT_THEME: theme,
    resolveTheme: () => theme,
    createThemePalette: () => palette,
    offeringSurfaceStyles: () => ({ card: {}, primaryText: {}, secondaryText: {} }),
    useResponsiveLayout: () => ({ isDesktop: false }),
    EventCoverMedia: () => React.createElement(View),
    ParallaxCoverShell: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
  };
});

import React from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { PublicBrandPage } from "../PublicBrandPage";
import type { PublicBrandEvent, PublicBrandPageProps } from "../types";

type Node = { props: Record<string, unknown> };
type Renderer = {
  root: { findAll: (fn: (node: Node) => boolean) => Node[] };
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = (id: string): Omit<PublicBrandEvent, "terminalSource"> => ({
  id,
  name: id,
  brandSlug: "brand",
  eventSlug: id,
  status: "scheduled",
  eventType: "event",
  operatorEndedAtUtc: null,
  masterStartAtUtc: "2026-08-29T12:00:00Z",
  masterEndAtUtc: "2026-08-29T19:00:00Z",
  masterTimezone: "Africa/Lagos",
  dateLine: id,
  venueName: "Venue",
  format: "in_person",
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  currency: "USD",
  tickets: [{ priceGbp: null, currency: "USD", isFree: true }],
});

const twoDay: PublicBrandEvent = {
  ...base("two-day"),
  terminalSource: {
    kind: "occurrences",
    value: [
      { id: "d1", startAt: "2026-08-29T12:00:00Z", endAt: "2026-08-29T19:00:00Z", timezone: "Africa/Lagos", isMaster: true },
      { id: "d2", startAt: "2026-08-30T12:00:00Z", endAt: "2026-08-30T19:00:00Z", timezone: "Africa/Lagos", isMaster: false },
    ],
  },
};
const invalid: PublicBrandEvent = {
  ...base("invalid"),
  terminalSource: {
    kind: "occurrences",
    value: [{ id: "bad", startAt: "2026-08-30T12:00:00Z", endAt: "offset-free" }],
  },
};
const props: PublicBrandPageProps = {
  brand: { id: "b", slug: "brand", displayName: "Brand", address: null, coverHue: 25 },
  events: [twoDay, invalid],
  trips: [],
  callbacks: {
    onClose: () => undefined,
    onShare: () => undefined,
    onOpenEvent: () => undefined,
    onOpenTrip: () => undefined,
  },
};

test("issue #2582 tester adversarial: brand keeps the multi-day card between dates and removes it at final equality", async () => {
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: () => undefined });
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-08-30T08:00:00Z"));
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<PublicBrandPage {...props} />);
  });
  const eventsTab = tree.root.findAll((node) => node.props.accessibilityLabel === "Events")[0];
  await act(async () => {
    (eventsTab?.props.onPress as () => void)();
  });
  const labels = () => tree.root.findAll((node) => typeof node.props.accessibilityLabel === "string")
    .map((node) => node.props.accessibilityLabel as string);
  expect(labels().some((label) => label.includes("two-day"))).toBe(true);
  expect(labels().some((label) => label.includes("invalid"))).toBe(false);

  await act(async () => {
    jest.advanceTimersByTime(11 * 60 * 60 * 1_000);
  });
  expect(labels().some((label) => label.includes("two-day"))).toBe(false);
  await act(async () => tree.unmount());
  jest.useRealTimers();
});
