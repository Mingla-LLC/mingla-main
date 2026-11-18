/**
 * issue #4420 wave 2 — public brand page, premium frame (behaviour proof).
 *
 * Mounts the REAL shared PublicBrandPage through react-native-web and checks
 * what a guest gets:
 *   B-1 Upcoming is the default tab when anything is upcoming; the selected
 *       tab is ink-filled (the page's text colour), never the accent;
 *   B-2 one upcoming offering puts the "Next up" glass bar on the page, its
 *       button opens that offering;
 *   B-3 nothing upcoming: no bar, the calm empty card (no emoji), About is
 *       the default, and Follow appears exactly once;
 *   B-4 the Upcoming count is hidden while more pages exist (never a false
 *       total), and matches the rows otherwise;
 *   B-5 an offering card's action is a tonal pill (wash fill, ink text);
 *   B-6 desktop: Share is a ghost pill (no accent fill) under the flyer.
 *
 * fails-on-revert: About as the default fails B-1; deleting the bar or
 * gating it on >1 upcoming fails B-2; the 🗺️ emoji or a second Follow fails
 * B-3; counting a capped page fails B-4; an accent-filled card button fails
 * B-5; an accent-filled Share fails B-6.
 */

jest.mock("lucide-react-native", () => {
  const mockReact = require("react");
  const icon = (name: string) => {
    const MockIcon = (props: Record<string, unknown>) =>
      mockReact.createElement("mock-icon", { "data-icon": name, ...props });
    MockIcon.displayName = name;
    return MockIcon;
  };
  return new Proxy(
    {},
    {
      get: (_target, prop: string) =>
        prop === "__esModule" ? true : icon(prop),
    },
  );
});

jest.mock("expo-video", () => {
  const mockReact = require("react");
  return {
    __esModule: true,
    VideoView: (props: Record<string, unknown>) =>
      mockReact.createElement("mock-video", props),
    useVideoPlayer: () => ({
      play: () => undefined,
      pause: () => undefined,
      replace: () => undefined,
      release: () => undefined,
      muted: true,
      loop: true,
    }),
  };
});

jest.mock("react-native-svg", () => {
  const mockReact = require("react");
  const el =
    (name: string) =>
    (props: Record<string, unknown>) =>
      mockReact.createElement(`mock-svg-${name.toLowerCase()}`, props);
  return new Proxy(
    { __esModule: true, default: el("Svg") },
    {
      get: (target: Record<string, unknown>, prop: string) =>
        prop in target ? target[prop] : el(prop),
    },
  );
});

jest.mock("lottie-react-native", () => {
  const mockReact = require("react");
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      mockReact.createElement("mock-lottie", props),
  };
});

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: null, manifest2: null },
}));

jest.mock(
  "../../../mingla-business/node_modules/expo-modules-core/src/polyfill",
  () =>
    jest.requireActual(
      "../../../mingla-business/node_modules/expo-modules-core/src/polyfill/index.web",
    ),
);

jest.mock("expo-haptics", () => ({
  __esModule: true,
  impactAsync: async () => undefined,
  notificationAsync: async () => undefined,
  selectionAsync: async () => undefined,
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

jest.mock("expo-blur", () => {
  const mockReact = require("react");
  return {
    __esModule: true,
    BlurView: (props: Record<string, unknown>) =>
      mockReact.createElement("mock-blur", props),
  };
});

import React from "react";
import { Dimensions, StyleSheet } from "react-native";

import { PublicBrandPage } from "../PublicBrandPage";
import { createThemePalette } from "../../offering-rendering/themePalette";
import type {
  PublicBrandEvent,
  PublicBrandPageProps,
  PublicBrandUpcoming,
} from "../types";

type HostNode = {
  type: unknown;
  props: Record<string, unknown>;
  children?: Array<HostNode | string>;
};
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (element: unknown) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(120000);

const THEME = {
  color: "#2266cc",
  foregroundColor: "#ffffff" as const,
  font: "inter" as const,
  fontFamilyValue: "TestFont",
  animation: "none" as const,
};
const palette = createThemePalette(THEME);

const setViewport = (width: number): void => {
  const dims = { width, height: 900, scale: 2, fontScale: 1 };
  Dimensions.set({ window: dims, screen: dims });
};

const row = (
  id: string,
  offeringType: PublicBrandUpcoming["offeringType"] = "event",
): PublicBrandUpcoming => ({
  offeringId: id,
  brandId: "brand-1",
  brandSlug: "lantern-room",
  brandName: "Lantern Room",
  offeringType,
  offeringSlug: `slug-${id}`,
  name: `Night ${id}`,
  bio: null,
  coverMediaUrl: null,
  coverMediaType: null,
  theme: null,
  startsAt: "2099-03-04T19:00:00Z",
  priceFromMinorUnits: 2500,
  currency: "GBP",
  isFree: false,
  publishedAt: "2026-08-01T00:00:00Z",
});

const event: PublicBrandEvent = {
  id: "ev-1",
  name: "Vinyl Night",
  brandSlug: "lantern-room",
  eventSlug: "vinyl-night",
  status: "scheduled",
  eventType: "event",
  operatorEndedAtUtc: null,
  terminalSource: { kind: "single_end", endAtUtc: "2099-03-04T23:00:00Z" },
  masterStartAtUtc: "2099-03-04T19:00:00Z",
  masterEndAtUtc: "2099-03-04T23:00:00Z",
  masterTimezone: "UTC",
  dateLine: "Wed 4 Mar",
  venueName: "The Loft",
  format: "in_person",
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  currency: "GBP",
  tickets: [],
};

const onOpenUpcoming = jest.fn();
const props = (
  overrides: Partial<PublicBrandPageProps> = {},
): PublicBrandPageProps => ({
  brand: {
    id: "brand-1",
    slug: "lantern-room",
    displayName: "Lantern Room",
    address: "41 Bond Street, New York, NY",
    coverHue: 210,
    links: {},
    contact: {},
  },
  events: [],
  trips: [],
  upcoming: [],
  theme: THEME,
  callbacks: {
    onClose: () => undefined,
    onShare: () => undefined,
    onOpenEvent: () => undefined,
    onOpenTrip: () => undefined,
    onOpenUpcoming,
    onToggleFollow: () => undefined,
  },
  ...overrides,
});

const mount = async (p: PublicBrandPageProps): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      React.createElement(
        PublicBrandPage as unknown as React.FC<PublicBrandPageProps>,
        p,
      ),
    );
  });
  if (tree === undefined) throw new Error("did not mount");
  return tree;
};

const byTestID = (tree: Tree, id: string): HostNode[] =>
  tree.root.findAll((n) => n.props.testID === id);

const flat = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

const texts = (tree: Tree): string[] => {
  const out: string[] = [];
  for (const n of tree.root.findAll((x) => typeof x.type === "string")) {
    for (const c of n.children ?? []) if (typeof c === "string") out.push(c);
  }
  return out;
};

const tabStyle = (tree: Tree, tab: string): Record<string, unknown> => {
  const node = byTestID(tree, `issue-4420-brand-tab-${tab}`).find(
    (n) => typeof n.props.onPress === "function",
  );
  const style = node?.props.style;
  return flat(typeof style === "function" ? style({ pressed: false }) : style);
};

beforeEach(() => {
  setViewport(390);
  onOpenUpcoming.mockClear();
});

describe("#4420 wave 2 — public brand page", () => {
  test("B-1 Upcoming is the default tab and the selected tab is ink", async () => {
    const tree = await mount(props({ upcoming: [row("a")] }));
    expect(tabStyle(tree, "upcoming").backgroundColor).toBe(palette.primaryText);
    expect(tabStyle(tree, "about").backgroundColor).not.toBe(palette.primaryText);
    expect(tabStyle(tree, "upcoming").backgroundColor).not.toBe(palette.accent);
    tree.unmount();
  });

  test("B-2 one upcoming offering shows the Next-up bar; its button opens it", async () => {
    const only = row("a", "event");
    const tree = await mount(props({ upcoming: [only] }));
    const bar = byTestID(tree, "issue-4420-brand-next-up-bar");
    expect(bar.length).toBeGreaterThan(0);
    const all = texts(tree).join(" | ");
    expect(all).toContain("Next up");
    expect(all).toContain("Get tickets");
    const action = byTestID(tree, "issue-4420-brand-next-up-bar-action").find(
      (n) => typeof n.props.onPress === "function",
    );
    await TestRenderer.act(() => {
      (action?.props.onPress as () => void)();
    });
    expect(onOpenUpcoming).toHaveBeenCalledWith(only);
    tree.unmount();
  });

  test("B-3 nothing upcoming: no bar, the empty card without emoji, one Follow", async () => {
    const tree = await mount(props());
    expect(byTestID(tree, "issue-4420-brand-next-up-bar")).toHaveLength(0);
    expect(byTestID(tree, "issue-4420-brand-empty").length).toBeGreaterThan(0);
    const all = texts(tree);
    expect(all.join(" ")).toContain("Nothing on the calendar yet");
    expect(all.some((t) => /\u{1F5FA}/u.test(t))).toBe(false);
    expect(all.filter((t) => t === "Follow")).toHaveLength(1);
    expect(tabStyle(tree, "about").backgroundColor).toBe(palette.primaryText);
    tree.unmount();
  });

  test("B-4 the Upcoming count matches its rows and hides on a capped page", async () => {
    const tabText = (tree: Tree): string => {
      const out: string[] = [];
      const walk = (n: HostNode | string): void => {
        if (typeof n === "string") out.push(n);
        else for (const c of n.children ?? []) walk(c);
      };
      const tab = byTestID(tree, "issue-4420-brand-tab-upcoming")[0];
      if (tab !== undefined) walk(tab);
      return out.join("").trim();
    };
    const two = await mount(props({ upcoming: [row("a"), row("b")] }));
    expect(tabText(two)).toBe("Upcoming 2");
    two.unmount();
    const capped = await mount(
      props({ upcoming: [row("a"), row("b")], upcomingHasMore: true }),
    );
    expect(tabText(capped)).toBe("Upcoming");
    capped.unmount();
  });

  test("B-5 an offering card's action is a tonal pill", async () => {
    const tree = await mount(props({ events: [event] }));
    const eventsTab = byTestID(tree, "issue-4420-brand-tab-events").find(
      (n) => typeof n.props.onPress === "function",
    );
    await TestRenderer.act(() => {
      (eventsTab?.props.onPress as () => void)();
    });
    const pill = byTestID(tree, "issue-4420-brand-card-pill")[0];
    expect(pill).toBeDefined();
    expect(flat(pill?.props.style).backgroundColor).toBe(palette.accentWash);
    tree.unmount();
  });

  test("B-6 desktop: Share under the flyer is a ghost pill", async () => {
    setViewport(1440);
    const tree = await mount(props({ upcoming: [row("a")] }));
    const share = tree.root
      .findAll((n) => n.props.accessibilityLabel === "Share this brand")
      .find((n) => typeof n.props.style === "function");
    expect(share).toBeDefined();
    const style = flat((share?.props.style as (s: { pressed: boolean }) => unknown)({ pressed: false }));
    expect(style.backgroundColor).toBe("transparent");
    expect(style.borderWidth).toBe(1);
    tree.unmount();
  });
});
