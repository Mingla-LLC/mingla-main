/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4490 Explorer W3 fix round 3 — mounted (react-test-renderer, #2774 lane).
 *
 *   R-1  a refused Buy hand-off says "Something went wrong. Try again." under
 *        the row that raised it only, and the next tap that opens clears it
 *        (W3-N23; the route keys each pane by tab, pinned in the pure twin);
 *   R-2  a server failure (no answer while online) shows the pane's plain
 *        error line with "Try again", never "You're offline" (W3-N25);
 *   G-1  the tab strip scrolls the SELECTED pill into view as soon as its
 *        layout is known, so a page opened on a far tab ("See all" → What's
 *        on, the pinned copy) shows it (W3-N26, W3-N30);
 *   G-2  a native pill label has no line limit, so it can never ellipsise
 *        ("Overvi…", W3-N26);
 *   H-1  the native glass header follows the one glass rule: opaque on
 *        Android always and on iOS without a blur (W3-N26, spec 06 §8).
 *
 * FAILS-ON-REVERT: one pane-wide handoff flag -> R-1 (the line shows above
 * every row); "offline" for every no-answer -> R-2; no reveal on layout -> G-1;
 * numberOfLines back on native -> G-2.
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import type { PublicVenueEntrySlotContext, PublicVenueReservationBar } from "@mingla/brand-rendering/PublicVenueScreen";

const { act, create } = require("react-test-renderer") as typeof import("react-test-renderer");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");

let mockHandoffOpens = false;
let mockAvailability: () => Promise<unknown> = async () => ({ days: [] });

jest.mock("../../InAppBrowserProvider", () => ({
  useOpenInMingla: () => ({ open: () => undefined, openDocument: () => undefined }),
}));
jest.mock("../../../services/postHogService", () => ({ postHogService: { capture: () => undefined } }));
jest.mock("../venueOfferCheckoutSeam", () => ({ openVenueOfferCheckout: () => mockHandoffOpens }));
// TEST-MOD-APPROVED #4490 (06-W4): the pane now mounts the native checkout
// sheet; a stand-in keeps this suite about the pane's own error line.
jest.mock("../VenueOfferCheckoutSheet", () => ({ VenueOfferCheckoutSheet: () => null }));
jest.mock("../../../services/venuePurchaseService", () => {
  class mockVenuePurchaseError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return { VenuePurchaseError: mockVenuePurchaseError, getVenueOfferAvailability: () => mockAvailability() };
});

const { VenueOfferPane } = require("../VenueOfferPane") as typeof import("../VenueOfferPane");
const { VenuePurchaseError } = require("../../../services/venuePurchaseService") as { VenuePurchaseError: new (code: string) => Error };
const { GlassTabs, glassTabRevealX } = require("@mingla/brand-rendering/GlassTabs") as typeof import("@mingla/brand-rendering/GlassTabs");

const palette = {
  page: "#000000", accent: "#eb7825", accentText: "#16110d", primaryText: "#ffffff", secondaryText: "#cccccc",
  tertiaryText: "#999999", panel: "#111111", panelStrong: "#222222", panelBorder: "#333333", card: "#0a0a0a",
  cutoutBorder: "#444444", glass: "#000000", glassTint: "dark", accentWash: "#1a1a1a",
};
const offer = (id: string, fromMinor: number) => ({
  id, kind: "entry", entryStyle: "walk_in", name: `Entry ${id}`, summary: null, fromMinor, unit: "guest",
  guestMin: null, guestMax: null, confirmationMode: "instant", spaceIds: null, sortOrder: 0,
});
type Tree = ReturnType<typeof create>;
const byTestId = (tree: Tree, id: string) =>
  tree.root.findAll((n) => n.props.testID === id && typeof n.type !== "string")[0] ?? tree.root.findAll((n) => n.props.testID === id)[0];
// This lane renders through react-native-web: one element per testID is enough.
const countTestId = (tree: Tree, id: string): number => (tree.root.findAll((n) => n.props.testID === id).length > 0 ? 1 : 0);
const texts = (tree: Tree): string[] =>
  tree.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);
const flush = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

function mountPane(offers: unknown[]): Tree {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx = {
    palette, surface: {}, theme: {}, offers, currencyCode: "NGN", exponent: 2, verb: "Buy entry",
    onBookingBarChange: (_bar: PublicVenueReservationBar | null) => undefined,
  } as unknown as PublicVenueEntrySlotContext;
  let tree!: Tree;
  act(() => {
    tree = create(
      <QueryClientProvider client={client}>
        <VenueOfferPane kind="entry" context={ctx} brandSlug="harmattan-qa-local" venueSlug="gamelandqa" venueId="v1"
          timezone="Africa/Lagos" mode="solo" now={new Date("2026-11-22T10:00:00Z")} />
      </QueryClientProvider>,
    );
  });
  return tree;
}

describe("#4490 W3 fix 3 — pane states (mounted)", () => {
  test("R-1 the hand-off error sits under the row that raised it, and clears on the next tap that opens", async () => {
    mockAvailability = async () => ({ days: [{ local_date: "2026-11-22", window_id: "w1", status: "available", remaining: 5 }] });
    mockHandoffOpens = false;
    const tree = mountPane([offer("a", 400000), offer("b", 500000)]);
    await flush(20);
    expect(countTestId(tree, "venue-pane-entry-handoff-error")).toBe(0);
    act(() => byTestId(tree, "venue-pane-book-b").props.onPress());
    expect(countTestId(tree, "venue-pane-entry-handoff-error")).toBe(1);
    // It follows row b, not row a, and not above the list.
    const pane = byTestId(tree, "venue-pane-entry");
    const order = pane.findAll((n) => typeof n.props.testID === "string")
      .map((n) => n.props.testID as string)
      .filter((id) => /^venue-pane-row-|handoff-error$/.test(id))
      .filter((id, i, all) => all.indexOf(id) === i);
    expect(order).toEqual(["venue-pane-row-a", "venue-pane-row-b", "venue-pane-entry-handoff-error"]);
    mockHandoffOpens = true;
    act(() => byTestId(tree, "venue-pane-book-b").props.onPress());
    expect(countTestId(tree, "venue-pane-entry-handoff-error")).toBe(0);
  });

  test("R-2 a server failure says the plain error line with Try again, never offline", async () => {
    mockAvailability = async () => { throw new VenuePurchaseError("venue_unreachable"); };
    const tree = mountPane([offer("a", 400000)]);
    await flush(50);
    expect(texts(tree)).toContain("Something went wrong. Try again.");
    expect(texts(tree)).not.toContain("You're offline. Check your connection and try again.");
    expect(byTestId(tree, "venue-pane-entry-retry")).toBeTruthy();
  });
});

describe("#4490 W3 fix 3 — the tab strip and header at 375 pt", () => {
  const items = ["overview", "entry", "by_the_hour", "plans", "groups", "hire", "whats_on", "reservations"].map((key) => ({
    key, label: key, testID: `tab-${key}`,
  }));

  test("G-1 a strip that opens on a far tab scrolls that pill into view once it is laid out", () => {
    const scrolls: Array<{ x: number; animated?: boolean }> = [];
    let tree!: Tree;
    act(() => {
      tree = create(
        <GlassTabs items={items} activeKey="whats_on" onSelect={() => undefined} palette={palette as never} theme={{} as never} />,
        {
          // react-native-web's ScrollView scrolls its DOM node.
          createNodeMock: () => ({
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            scroll: (o: { left: number; behavior?: string }) => scrolls.push({ x: o.left, animated: o.behavior === "smooth" }),
            scrollTo: (o: { left: number; behavior?: string }) => scrolls.push({ x: o.left, animated: o.behavior === "smooth" }),
          }),
        },
      );
    });
    // Nothing is measured at mount: nothing to scroll yet.
    expect(scrolls).toEqual([]);
    const pill = (key: string) => byTestId(tree, `tab-${key}`);
    act(() => pill("overview").props.onLayout({ nativeEvent: { layout: { x: 4, y: 0, width: 90, height: 44 } } }));
    expect(scrolls).toEqual([]);
    act(() => pill("whats_on").props.onLayout({ nativeEvent: { layout: { x: 540, y: 0, width: 96, height: 44 } } }));
    expect(scrolls).toEqual([{ x: glassTabRevealX(540), animated: false }]);
    expect(glassTabRevealX(540)).toBe(524);
    // A later layout pass of the same pill does not fight the user's scroll.
    act(() => pill("whats_on").props.onLayout({ nativeEvent: { layout: { x: 540, y: 0, width: 96, height: 44 } } }));
    expect(scrolls).toHaveLength(1);
  });

  test("G-2 native pill labels have no line limit (no ellipsis on the selected pill)", () => {
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    const was = Platform.OS;
    const labelsWith = (os: string): Array<number | undefined> => {
      Platform.OS = os;
      try {
        let tree!: Tree;
        act(() => {
          tree = create(<GlassTabs items={items} activeKey="overview" onSelect={() => undefined} palette={palette as never} theme={{} as never} />);
        });
        return tree.root
          .findAll((n) => typeof n.type !== "string" && Array.isArray(n.props.children) && n.props.children[0] === "overview")
          .map((n) => n.props.numberOfLines as number | undefined);
      } finally {
        Platform.OS = was;
      }
    };
    const native = labelsWith("ios");
    expect(native.length > 0).toBe(true);
    expect(native.every((v) => v === undefined)).toBe(true);
    expect(labelsWith("web")).toContain(1);
  });

  test("H-1 the native header band reads the one glass rule (Android and unblurred iOS opaque)", () => {
    const { glassFillAlpha } = require("@mingla/offering-rendering/OfferingGlassContext") as typeof import("@mingla/offering-rendering/OfferingGlassContext");
    expect(glassFillAlpha({ platform: "ios", blurred: false, desktopWeb: false })).toBe(1);
    expect(glassFillAlpha({ platform: "android", blurred: true, desktopWeb: false })).toBe(1);
    const shell = fs.readFileSync(path.join(__dirname, "../../../../../packages/offering-rendering/ParallaxCoverShell.tsx"), "utf8");
    expect(shell).toMatch(/: glassFillAlpha\(\{\s*platform: Platform\.OS,\s*blurred: headerBlurred,/);
    expect(shell).not.toMatch(/Platform\.OS === "android" \? 0\.97 : 0\.93/);
  });
});
