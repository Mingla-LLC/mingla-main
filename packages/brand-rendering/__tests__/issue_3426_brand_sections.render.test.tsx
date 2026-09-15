/**
 * #3426 — IMPLEMENTOR render proof for the brand page's Happening now block and
 * Past tab: the REAL shared `PublicBrandPage`, mounted.
 *
 *   R-1  tab visibility: Upcoming appears when EITHER happening-now or upcoming
 *        has rows; Past appears when it has rows or more pages; neither appears
 *        empty; Past sits straight after Upcoming.
 *   R-2  the Upcoming tab opens with a distinct "Happening now" block (its own
 *        header, "until" date lines) ABOVE an "Upcoming" heading and the
 *        upcoming cards; the tab count is both buckets.
 *   R-3  happening-now with nothing upcoming shows the block and NO empty state.
 *   R-4  the Past tab lists all four kinds in the order given (most recent first),
 *        with "Ended <date with year>" lines and no price; a card opens through
 *        onOpenUpcoming with its own row.
 *   R-5  load more: shown only with more pages AND a callback; press calls it;
 *        busy while loading; "Try again" after a failed page. No count while
 *        more pages exist.
 *   R-6  `pastEvents` is no longer discarded: a host with no server `past` feed
 *        gets its past events and trips on the Past tab, most recent first,
 *        opening through onOpenEvent / onOpenTrip — and a host WITH the feed
 *        never shows them twice.
 *
 * VACUITY GUARDS: every order/label assertion is preceded by a count assertion.
 *
 * Mock boundary (declared): lucide icons and the offering-rendering barrel's RN
 * shell/cover components are stubbed exactly as the #1902 brand render suite
 * does; the page, its tabs, sections and cards are real.
 *
 * Run: cd mingla-business && npx jest --config jest.issue679.cfg.cjs --runInBand \
 *        --testMatch '**\/__tests__/issue_3426_brand_sections.render.test.tsx'
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

import fs from "fs";
import path from "path";
import React from "react";
import { AppState } from "react-native";
import type {
  PublicBrandEvent,
  PublicBrandPageProps,
  PublicBrandTrip,
  PublicBrandUpcoming,
} from "../types";
import { PublicBrandPage } from "../PublicBrandPage";

type Node = {
  type: unknown;
  props: Record<string, unknown>;
  children?: Array<Node | string>;
};
type Renderer = {
  root: { findAll: (fn: (node: Node) => boolean) => Node[] };
  toJSON: () => unknown;
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

jest.setTimeout(120000);

const offering = (
  id: string,
  offeringType: PublicBrandUpcoming["offeringType"],
  startsAt: string,
  endsAt: string | null,
  extra: Partial<PublicBrandUpcoming> = {},
): PublicBrandUpcoming => ({
  offeringId: id,
  brandId: "brand-1",
  brandSlug: "lantern-room",
  brandName: "Lantern Room",
  offeringType,
  offeringSlug: `slug-${id}`,
  name: `Name ${id}`,
  bio: null,
  coverMediaUrl: null,
  coverMediaType: null,
  theme: null,
  startsAt,
  endsAt,
  priceFromMinorUnits: 2500,
  currency: "GBP",
  isFree: false,
  publishedAt: "2026-08-01T00:00:00Z",
  ...extra,
});

const legacyEvent = (id: string, end: string): PublicBrandEvent => ({
  id,
  name: `Legacy ${id}`,
  brandSlug: "lantern-room",
  eventSlug: `legacy-${id}`,
  status: "scheduled",
  eventType: "event",
  operatorEndedAtUtc: null,
  terminalSource: { kind: "single_end", endAtUtc: end },
  masterStartAtUtc: "2026-01-01T12:00:00Z",
  masterEndAtUtc: end,
  masterTimezone: "UTC",
  dateLine: "Legacy",
  venueName: null,
  format: "in_person",
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  currency: "GBP",
  tickets: [],
});

const legacyTrip = (id: string, end: string): PublicBrandTrip => ({
  id,
  slug: `trip-${id}`,
  brandSlug: "lantern-room",
  title: `Trip ${id}`,
  destinationText: null,
  coverMediaUrl: null,
  coverMediaType: null,
  status: "scheduled",
  startAt: "2026-01-01T12:00:00Z",
  endAt: end,
  timezone: "UTC",
  bookingsClosed: false,
  spotsLeft: null,
  minPriceCents: null,
  currency: null,
  hasFreeTier: false,
});

const baseProps = (
  overrides: Partial<PublicBrandPageProps> = {},
  callbacks: Partial<PublicBrandPageProps["callbacks"]> = {},
): PublicBrandPageProps => ({
  brand: {
    id: "brand-1",
    slug: "lantern-room",
    displayName: "Lantern Room",
    address: null,
    coverHue: 25,
  },
  events: [],
  trips: [],
  ...overrides,
  callbacks: {
    onClose: () => undefined,
    onShare: () => undefined,
    onOpenEvent: () => undefined,
    onOpenTrip: () => undefined,
    ...callbacks,
  },
});

const mount = async (props: PublicBrandPageProps): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<PublicBrandPage {...props} />);
  });
  return tree;
};

const textOf = (node: Node | string): string =>
  typeof node === "string"
    ? node
    : (node.children ?? []).map((child) => textOf(child)).join("");

const tabLabels = (tree: Renderer): string[] =>
  tree.root
    .findAll(
      (node) =>
        node.props.accessibilityRole === "button" &&
        typeof node.props.accessibilityState === "object" &&
        node.props.accessibilityState !== null &&
        "selected" in (node.props.accessibilityState as object) &&
        typeof node.props.onLayout === "function",
    )
    .map((node) => node.props.accessibilityLabel as string)
    // react-test-renderer surfaces a composite and its host node; keep one each.
    .filter((label, index, all) => all.indexOf(label) === index);

const pressTab = async (tree: Renderer, label: string): Promise<void> => {
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

const cardLabels = (tree: Renderer, section: string): string[] =>
  tree.root
    .findAll(
      (node) =>
        node.props.testID === `brand-section-card-${section}` &&
        typeof node.props.onPress === "function",
    )
    .map((node) => node.props.accessibilityLabel as string)
    .filter((label, index, all) => all.indexOf(label) === index);

// The page's own date wording, computed the way the renderer formats it. The
// expectation must not hard-code an ICU month abbreviation: en-GB September is
// "Sep" on some ICU builds and "Sept" on newer ones (Node 22 here).
const endedLine = (iso: string): string =>
  `Ended ${new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
const untilLine = (iso: string): string =>
  `Happening now · until ${new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}`;

beforeEach(() => {
  jest
    .spyOn(AppState, "addEventListener")
    .mockReturnValue({ remove: () => undefined } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("#3426 brand page — Happening now and Past", () => {
  test("R-1 tabs appear only when their buckets have something, Past straight after Upcoming", async () => {
    const none = await mount(baseProps());
    expect(tabLabels(none)).toEqual(["About"]);
    await act(async () => none.unmount());

    const onlyNow = await mount(
      baseProps({
        happeningNow: [offering("now-1", "event", "2026-09-15T10:00:00Z", "2026-09-15T23:00:00Z")],
      }),
    );
    expect(tabLabels(onlyNow)).toEqual(["About", "Upcoming"]);
    await act(async () => onlyNow.unmount());

    const onlyMorePast = await mount(baseProps({ past: [], pastHasMore: true }));
    expect(tabLabels(onlyMorePast)).toEqual(["About", "Past"]);
    await act(async () => onlyMorePast.unmount());

    const all = await mount(
      baseProps({
        upcoming: [offering("up-1", "rsvp", "2026-10-01T18:00:00Z", null)],
        past: [offering("past-1", "trip", "2026-06-01T12:00:00Z", "2026-06-05T12:00:00Z")],
        experiences: [],
      }),
    );
    expect(tabLabels(all)).toEqual(["About", "Upcoming", "Past"]);
    await act(async () => all.unmount());
  });

  test("R-2 Upcoming opens with a distinct Happening now block above the upcoming cards", async () => {
    const tree = await mount(
      baseProps({
        happeningNow: [
          offering("now-trip", "trip", "2026-09-13T12:00:00Z", "2026-09-20T12:00:00Z"),
          offering("now-exp", "experience", "2026-09-15T11:00:00Z", "2026-09-15T13:00:00Z"),
        ],
        upcoming: [offering("up-event", "event", "2026-10-01T18:00:00Z", null)],
      }),
    );
    await pressTab(tree, "Upcoming");

    const blocks = tree.root.findAll(
      (node) => node.props.testID === "brand-happening-now",
    );
    expect(blocks.length).toBeGreaterThan(0);

    const nowLabels = cardLabels(tree, "happening_now");
    expect(nowLabels).toHaveLength(2);
    expect(nowLabels[0]).toBe(
      `Open Trip Name now-trip. ${untilLine("2026-09-20T12:00:00Z")}. From £25.`,
    );
    expect(nowLabels[1]).toBe(
      `Open Experience Name now-exp. ${untilLine("2026-09-15T13:00:00Z")}. From £25.`,
    );
    expect(nowLabels[0]).toMatch(/^Open Trip Name now-trip\. Happening now · until Sun 20 Sept?\. From £25\.$/);

    const json = JSON.stringify(tree.toJSON());
    const blockHeader = json.indexOf('"Happening now"');
    const upcomingHeader = json.indexOf('"Upcoming"', blockHeader);
    const upcomingCard = json.indexOf("Open event Name up-event");
    expect(blockHeader).toBeGreaterThanOrEqual(0);
    expect(upcomingHeader).toBeGreaterThan(blockHeader);
    expect(upcomingCard).toBeGreaterThan(upcomingHeader);

    const upcomingTab = tree.root.findAll(
      (node) => node.props.accessibilityLabel === "Upcoming" && typeof node.props.onLayout === "function",
    )[0];
    expect(textOf(upcomingTab as Node)).toContain("Upcoming 3");
    // Nothing that is happening now is presented as past.
    expect(cardLabels(tree, "past")).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test("R-3 happening now with nothing upcoming shows the block and no empty state", async () => {
    const tree = await mount(
      baseProps({
        happeningNow: [offering("now-rsvp", "rsvp", "2026-09-15T09:00:00Z", "2026-09-15T21:00:00Z")],
      }),
    );
    await pressTab(tree, "Upcoming");
    expect(cardLabels(tree, "happening_now")).toHaveLength(1);
    const json = JSON.stringify(tree.toJSON());
    expect(json).not.toContain("Nothing on the calendar yet");
    expect(json).not.toContain("No upcoming offerings yet");
    await act(async () => tree.unmount());
  });

  test("R-4 Past lists all four kinds in the given order, with the year and no price", async () => {
    const opened: PublicBrandUpcoming[] = [];
    const past = [
      offering("p-event", "event", "2026-09-12T18:00:00Z", "2026-09-12T23:00:00Z"),
      offering("p-rsvp", "rsvp", "2026-08-02T18:00:00Z", "2026-08-02T21:00:00Z"),
      offering("p-trip", "trip", "2026-06-01T12:00:00Z", "2026-06-07T12:00:00Z"),
      offering("p-exp", "experience", "2025-12-30T12:00:00Z", "2025-12-30T15:00:00Z"),
    ];
    const tree = await mount(
      baseProps({ past }, { onOpenUpcoming: (item) => opened.push(item) }),
    );
    await pressTab(tree, "Past");
    const labels = cardLabels(tree, "past");
    expect(labels).toHaveLength(4);
    expect(labels).toEqual([
      `Open Event Name p-event. ${endedLine("2026-09-12T23:00:00Z")}.`,
      "Open RSVP Name p-rsvp. Ended 2 Aug 2026.",
      "Open Trip Name p-trip. Ended 7 Jun 2026.",
      "Open Experience Name p-exp. Ended 30 Dec 2025.",
    ]);
    // The year is on the line, and no price is.
    expect(labels[0]).toMatch(/^Open Event Name p-event\. Ended 12 Sept? 2026\.$/);
    expect(labels.some((label) => label.includes("£"))).toBe(false);
    const pastTab = tree.root.findAll(
      (node) => node.props.accessibilityLabel === "Past" && typeof node.props.onLayout === "function",
    )[0];
    expect(textOf(pastTab as Node)).toContain("Past 4");

    const tripCard = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Open Trip Name p-trip. Ended 7 Jun 2026." &&
        typeof node.props.onPress === "function",
    )[0];
    await act(async () => {
      (tripCard?.props.onPress as () => void)();
    });
    expect(opened.map((item) => item.offeringId)).toEqual(["p-trip"]);
    expect(cardLabels(tree, "happening_now")).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test("R-5 load more: gated on more pages and a callback, busy while loading, retry after a failure", async () => {
    const past = [offering("p1", "event", "2026-09-01T18:00:00Z", "2026-09-01T22:00:00Z")];
    const loadMore = jest.fn();

    const loadMoreButtons = (tree: Renderer): Node[] =>
      tree.root.findAll(
        (node) => node.props.testID === "brand-past-load-more" && typeof node.props.onPress === "function",
      );

    const noMore = await mount(baseProps({ past, pastHasMore: false }, { onLoadMorePast: loadMore }));
    await pressTab(noMore, "Past");
    expect(loadMoreButtons(noMore)).toHaveLength(0);
    await act(async () => noMore.unmount());

    const noCallback = await mount(baseProps({ past, pastHasMore: true }));
    await pressTab(noCallback, "Past");
    expect(loadMoreButtons(noCallback)).toHaveLength(0);
    await act(async () => noCallback.unmount());

    const ready = await mount(baseProps({ past, pastHasMore: true }, { onLoadMorePast: loadMore }));
    await pressTab(ready, "Past");
    const pastTab = ready.root.findAll(
      (node) => node.props.accessibilityLabel === "Past" && typeof node.props.onLayout === "function",
    )[0];
    expect(textOf(pastTab as Node).trim()).toBe("Past");
    const [button] = loadMoreButtons(ready);
    expect(button?.props.accessibilityLabel).toBe("Show more past offerings");
    await act(async () => {
      (button?.props.onPress as () => void)();
    });
    expect(loadMore).toHaveBeenCalledTimes(1);
    await act(async () => ready.unmount());

    const loading = await mount(
      baseProps({ past, pastHasMore: true, pastLoadState: "loading_more" }, { onLoadMorePast: loadMore }),
    );
    await pressTab(loading, "Past");
    const [busy] = loadMoreButtons(loading);
    expect(busy?.props.disabled).toBe(true);
    expect(busy?.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(JSON.stringify(loading.toJSON())).toContain("Loading…");
    await act(async () => loading.unmount());

    const failed = await mount(
      baseProps({ past, pastHasMore: true, pastLoadState: "error" }, { onLoadMorePast: loadMore }),
    );
    await pressTab(failed, "Past");
    const [retry] = loadMoreButtons(failed);
    expect(retry?.props.accessibilityLabel).toBe("Try loading more past offerings again");
    const failedJson = JSON.stringify(failed.toJSON());
    expect(failedJson).toContain("Try again");
    expect(failedJson).toContain("Couldn’t load more past offerings.");
    await act(async () => failed.unmount());
  });

  test("R-6 pastEvents is rendered, not discarded, when the host has no server Past feed", async () => {
    const openedEvents: string[] = [];
    const openedTrips: string[] = [];
    const pastEvents = [
      legacyEvent("old", "2026-03-01T12:00:00Z"),
      legacyEvent("recent", "2026-09-01T12:00:00Z"),
    ];
    const pastTrips = [legacyTrip("mid", "2026-06-01T12:00:00Z")];
    const tree = await mount(
      baseProps(
        { pastEvents, pastTrips },
        {
          onOpenEvent: (event) => openedEvents.push(event.id),
          onOpenTrip: (trip) => openedTrips.push(trip.id),
        },
      ),
    );
    expect(tabLabels(tree)).toContain("Past");
    await pressTab(tree, "Past");
    const labels = cardLabels(tree, "past");
    expect(labels).toHaveLength(3);
    expect(labels).toEqual([
      `Open Event Legacy recent. ${endedLine("2026-09-01T12:00:00Z")}.`,
      "Open Trip Trip mid. Ended 1 Jun 2026.",
      "Open Event Legacy old. Ended 1 Mar 2026.",
    ]);
    const press = async (label: string): Promise<void> => {
      const card = tree.root.findAll(
        (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === "function",
      )[0];
      await act(async () => {
        (card?.props.onPress as () => void)();
      });
    };
    await press(`Open Event Legacy recent. ${endedLine("2026-09-01T12:00:00Z")}.`);
    await press("Open Trip Trip mid. Ended 1 Jun 2026.");
    expect(openedEvents).toEqual(["recent"]);
    expect(openedTrips).toEqual(["mid"]);
    await act(async () => tree.unmount());

    // A host WITH the server feed: the feed wins, nothing appears twice.
    const withFeed = await mount(
      baseProps({
        pastEvents,
        past: [offering("recent", "event", "2026-08-31T18:00:00Z", "2026-09-01T12:00:00Z")],
      }),
    );
    await pressTab(withFeed, "Past");
    expect(cardLabels(withFeed, "past")).toEqual([
      `Open Event Name recent. ${endedLine("2026-09-01T12:00:00Z")}.`,
    ]);
    await act(async () => withFeed.unmount());
  });

  test("R-6 structural: the renderer source no longer voids providedPastEvents", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "PublicBrandPage.tsx"), "utf8");
    expect(source).not.toMatch(/void\s+providedPastEvents/);
    expect(source).toMatch(/legacyPastCards\(providedPastEvents \?\? \[\]/);
  });
});
