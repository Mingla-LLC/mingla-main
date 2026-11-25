/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4490 Explorer W3 — the native venue pane, mounted (react-test-renderer,
 * the #2774 render lane): every state renders and no tap is dead.
 *
 *   P-1 loading: rows from the payload at once, book buttons wait (disabled, busy);
 *   P-2 success: a sold-out row says "Sold out" and is disabled; an open row's
 *       button opens the buyer web tab in Mingla's in-app browser and sends
 *       venue_tapped_to_book (source venue_page); the docked bar reads the
 *       cheapest open row;
 *   P-3 error: the §6 line and "Try again", which re-asks; buttons stay usable;
 *   P-4 offline: the §5 offline line;
 *   P-5 empty: "Nothing to book here right now.";
 *   P-6 plans: a full plan is "Sold out"; no availability read is made.
 *
 * FAILS-ON-REVERT: drop the `checking` disable and P-1 fails; drop the sold-out
 * disable and P-2 fails; drop the error line and P-3 fails.
 */
import React from "react";
import type { PublicVenueEntrySlotContext, PublicVenueReservationBar } from "@mingla/brand-rendering/PublicVenueScreen";

const { act, create } = require("react-test-renderer") as typeof import("react-test-renderer");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");

const mockOpened: string[] = [];
const mockCaptured: Array<{ event: string; props: unknown }> = [];
let mockAvailability: (input: { offeringId: string }) => Promise<unknown> = async () => ({ days: [] });

// TEST-MOD-APPROVED #4490 (06-W4): the book button opens the native checkout
// sheet (the W3 buyer-web hand-off is retired). The sheet is a stand-in that
// records what it was opened with.
jest.mock("../VenueOfferCheckoutSheet", () => ({
  VenueOfferCheckoutSheet: ({ open }: { open: { kind: string; offerId: string | null; brandSlug: string; venueSlug: string } | null }) => {
    if (open !== null) {
      const id = `${open.kind}:${open.offerId}:${open.brandSlug}/${open.venueSlug}`;
      if (mockOpened[mockOpened.length - 1] !== id) mockOpened.push(id);
    }
    return null;
  },
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: (event: string, props: unknown) => mockCaptured.push({ event, props }) },
}));
jest.mock("../../../services/venuePurchaseService", () => {
  class mockVenuePurchaseError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    VenuePurchaseError: mockVenuePurchaseError,
    getVenueOfferAvailability: (input: { offeringId: string }) => mockAvailability(input),
  };
});

const { VenueOfferPane } = require("../VenueOfferPane") as typeof import("../VenueOfferPane");
const { VenuePurchaseError } = require("../../../services/venuePurchaseService") as { VenuePurchaseError: new (code: string) => Error };

const palette = {
  page: "#000000", accent: "#eb7825", accentText: "#16110d", primaryText: "#ffffff", secondaryText: "#cccccc",
  tertiaryText: "#999999", panel: "#111111", panelStrong: "#222222", panelBorder: "#333333", card: "#0a0a0a",
  cutoutBorder: "#444444", glass: "#000000", glassTint: "dark", accentWash: "#1a1a1a",
};
const offer = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: "entry", entryStyle: "day_pass", name: `Pass ${id}`, summary: null, fromMinor: 400000, unit: "guest",
  guestMin: null, guestMax: null, confirmationMode: "instant", spaceIds: null, sortOrder: 0, ...over,
});
const day = (status: string) => ({ local_date: "2026-11-20", window_id: "w1", status, remaining: 0 });

function mount(kind: "entry" | "plans", context: Partial<PublicVenueEntrySlotContext> & { plans?: unknown[] }) {
  const bars: Array<PublicVenueReservationBar | null> = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ctx = {
    palette, surface: {}, theme: {}, offers: [], currencyCode: "NGN", exponent: 2, verb: "Buy a day pass",
    onBookingBarChange: (bar: PublicVenueReservationBar | null) => bars.push(bar),
    ...context,
  } as unknown as PublicVenueEntrySlotContext & { plans?: never[] };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <QueryClientProvider client={client}>
        <VenueOfferPane kind={kind} context={ctx} brandSlug="harmattan-qa-local" venueSlug="gamelandqa" venueId="v1"
          timezone="Africa/Lagos" mode="solo" now={new Date("2026-11-20T10:00:00Z")} />
      </QueryClientProvider>,
    );
  });
  return { tree, bars };
}
const byTestId = (tree: ReturnType<typeof create>, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type !== "string")[0] ?? tree.root.findAll((n) => n.props.testID === id)[0];
const texts = (tree: ReturnType<typeof create>): string[] =>
  tree.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);
const flush = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
// The availability read retries once (about a second) before it shows an error.
const RETRY_WAIT_MS = 1500;

beforeEach(() => {
  mockOpened.length = 0;
  mockCaptured.length = 0;
});

describe("#4490 W3 venue pane (mounted)", () => {
  test("P-1 loading: rows at once, book buttons wait", () => {
    mockAvailability = () => new Promise(() => undefined);
    const { tree } = mount("entry", { offers: [offer("a")] as never });
    expect(texts(tree)).toContain("Pass a");
    const button = byTestId(tree, "venue-pane-book-a");
    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  test("P-2 success: sold out is disabled; the open row opens the native checkout on that offer and is tracked", async () => {
    mockAvailability = async ({ offeringId }) => ({ days: [day(offeringId === "a" ? "sold_out" : "available")] });
    const { tree, bars } = mount("entry", { offers: [offer("a", { fromMinor: 100000 }), offer("b", { fromMinor: 500000 })] as never });
    await flush(50);
    const sold = byTestId(tree, "venue-pane-book-a");
    expect(sold.props.disabled).toBe(true);
    expect(sold.props.accessibilityLabel).toBe("Pass a, Sold out");
    const open = byTestId(tree, "venue-pane-book-b");
    expect(open.props.disabled).toBe(false);
    act(() => open.props.onPress());
    expect(mockOpened).toEqual(["entry:b:harmattan-qa-local/gamelandqa"]);
    expect(mockCaptured).toEqual([{ event: "venue_tapped_to_book", props: {
      venue_id: "v1", tab: "entry", offer_kind: "entry", source: "venue_page", position_in_deck: null, is_hosted_venue: true, mode: "solo",
    } }]);
    const bar = bars.filter((b) => b !== null).pop();
    expect(bar).toMatchObject({ title: "Pass b", ctaLabel: "Buy a day pass", enabled: true });
    act(() => bar?.onPress());
    expect(mockOpened[mockOpened.length - 1]).toBe("entry:b:harmattan-qa-local/gamelandqa");
    expect(mockCaptured).toHaveLength(2);
  });

  test("P-3 error: the line and Try again, which asks again; buttons stay usable", async () => {
    let calls = 0;
    mockAvailability = async () => { calls += 1; throw new VenuePurchaseError("venue_request_failed"); };
    const { tree } = mount("entry", { offers: [offer("a")] as never });
    await flush(RETRY_WAIT_MS);
    expect(texts(tree)).toContain("Something went wrong. Try again.");
    expect(byTestId(tree, "venue-pane-book-a").props.disabled).toBe(false);
    const before = calls;
    act(() => byTestId(tree, "venue-pane-entry-retry").props.onPress());
    await flush();
    expect(calls).toBe(before + 1);
  });

  test("P-4 offline: the §5 offline line", async () => {
    mockAvailability = async () => { throw new VenuePurchaseError("offline"); };
    const { tree } = mount("entry", { offers: [offer("a")] as never });
    await flush(RETRY_WAIT_MS);
    expect(texts(tree)).toContain("You're offline. Check your connection and try again.");
  });

  test("P-5 empty: the §5 line, no bar", () => {
    const { tree, bars } = mount("entry", { offers: [] as never });
    expect(texts(tree)).toContain("Nothing to book here right now.");
    expect(bars.every((b) => b === null)).toBe(true);
  });

  test("P-6 plans: a full plan is sold out; no availability read", async () => {
    let calls = 0;
    mockAvailability = async () => { calls += 1; return { days: [] }; };
    const plan = (id: string, full: boolean) => ({ id, name: `Plan ${id}`, summary: null, priceMinor: 2500000, period: "month", joinMode: "instant",
      assignedDeskAvailable: false, inclusions: [], entryIncluded: false, roomHours: 0, guestPasses: 0, discountBps: 0, discountKinds: [],
      minMonths: 1, noticeDays: 0, graceDays: 7, renewalNoticeDays: 7, full });
    const { tree } = mount("plans", { plans: [plan("p1", true), plan("p2", false)] });
    await flush();
    expect(byTestId(tree, "venue-pane-book-p1").props.disabled).toBe(true);
    expect(byTestId(tree, "venue-pane-book-p2").props.disabled).toBe(false);
    expect(calls).toBe(0);
  });
});
