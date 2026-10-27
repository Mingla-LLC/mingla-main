/**
 * #3872 Promote polish — Blast › Overview behaves as designed on web.
 *
 * WHAT RUNS HERE: the REAL BlastPromotionOverview and the REAL Program kit
 * (ListRow, ProgramButton, StatStrip) through react-native-web on a
 * react-test-renderer root, with the overview read stubbed. Navigation,
 * the sheet host and the shimmer are inert stand-ins.
 *
 * Pins:
 * - Send is its own accessible button, a SIBLING of the Campaigns row's
 *   button (never nested), with a hit area of at least 44pt; pressing it
 *   opens the composer and does not navigate, and the row does the reverse.
 * - The error state has a working Try again that refetches.
 * - The picker marks the selected scope with a check and `aria-checked`,
 *   not colour alone, and the mark moves when the host picks.
 * - "Whole brand" (never "All listings") names the brand-wide scope, and a
 *   one-listing view offers "See whole brand".
 * - A deep-linked listing that is gone falls back and says so.
 * - Desktop: four way cards, Send still a sibling of the card's button.
 * - On web, Send and the notice's Dismiss are real 44px boxes, because
 *   react-native-web's Pressable ignores hitSlop; Send's pill stays 36px.
 *
 * FAILS ON REVERT: render Send inside the row again (`right={<Pressable…>}`)
 * and the nesting test goes red; drop the Try again button and the retry
 * test goes red; mark selection with text only and the marker test goes red;
 * drop the web hit box from ProgramButton or shrink Dismiss back to 32 and
 * the hit-target tests go red.
 *
 * Run (from mingla-business/):
 *   npx jest --config jest.issue3872promote.web.render.cjs --ci --maxWorkers=2
 */
import React from "react";
import { StyleSheet } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// No @types/react-test-renderer in this app: type the slice these proofs use
// (same pattern as the #3827 web render suites).
type TestNode = {
  type: unknown;
  props: Record<string, unknown>;
  parent: TestNode | null;
  children: Array<TestNode | string>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
};
type Renderer = { root: TestNode };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (fn: () => void | Promise<void>) => Promise<void> | void;
};
const { act } = TestRenderer;

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const mockReplace = jest.fn();
const mockFetch = jest.fn();
let mockWide = false;

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useFocusEffect: () => undefined,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("react-native-reanimated", () => ({ useReducedMotion: () => true }));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("../../programs/ProgramSheet", () => ({
  ProgramSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? children : null,
}));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: mockWide, isWeb: true, width: mockWide ? 1440 : 390, isShort: false }),
}));
jest.mock("../../../services/promotionOverviewService", () => {
  class PromotionOverviewError extends Error {
    readonly code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    fetchPromotionOverview: (...args: unknown[]) => mockFetch(...args),
    PromotionOverviewError,
  };
});

import { BlastPromotionOverview } from "../BlastPromotionOverview";
import { mapPromotionOverview } from "../../../services/promotionOverview";
import { PromotionOverviewError } from "../../../services/promotionOverviewService";

const LISTINGS = [
  { kind: "event", id: "e1", title: "Afrobeats Brunch", starts_at: "2026-11-09T14:00:00Z" },
  { kind: "venue", id: "v1", title: "Rooftop Social", starts_at: null },
];

function overview(extra: Record<string, unknown> = {}) {
  return mapPromotionOverview({
    ok: true,
    listings: LISTINGS,
    listing: null,
    currency: "NGN",
    sold_minor: 184000000,
    tickets: 40,
    clicks: 3418,
    spent_minor: 12600000,
    campaigns: { sent: 3, last_sent_at: "2026-10-24T10:00:00Z" },
    ads: { live: 2, draft: 1, needs_setup: false },
    creators: { gigs_live: 1, interested: 4, hired: 1, paid: 0 },
    referrals: { offers_live: 2, promoters: 7 },
    ...extra,
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Let React Query settle until `ready` holds (or fail loudly). */
async function until(r: Renderer, ready: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (ready()) return;
    await flush();
  }
  throw new Error(`never settled: ${allText(r)}`);
}

async function mount(
  initialListing: { kind: "event" | "venue"; id: string } | null = null,
  onNewCampaign = jest.fn(),
): Promise<Renderer> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={client}>
        <BlastPromotionOverview
          brandId="b1"
          brandName="Rooftop Social Lagos"
          initialListing={initialListing}
          onNewCampaign={onNewCampaign}
        />
      </QueryClientProvider>,
    );
  });
  if (!renderer) throw new Error("did not mount");
  const mounted = renderer;
  await until(
    mounted,
    () =>
      hosts(mounted, (n) => n.props["data-testid"] === "blast-overview-skeleton").length === 0,
  );
  return mounted;
}

const hosts = (r: Renderer, test: (n: TestNode) => boolean) =>
  r.root.findAll((n) => typeof n.type === "string" && test(n));
const byLabel = (r: Renderer, label: string | RegExp) => {
  const found = hosts(r, (n) => {
    const own = n.props["aria-label"];
    if (typeof own !== "string") return false;
    return typeof label === "string" ? own === label : label.test(own);
  });
  if (found.length === 0) throw new Error(`no element labelled ${String(label)}`);
  return found[0];
};
const byTestId = (r: Renderer, id: string) => {
  const found = hosts(r, (n) => n.props["data-testid"] === id);
  if (found.length === 0) throw new Error(`no ${id}`);
  return found[0];
};
const allText = (r: Renderer): string =>
  hosts(r, () => true)
    .flatMap((n) => n.children.filter((c): c is string => typeof c === "string"))
    .join(" | ");
const isInside = (node: TestNode, ancestor: TestNode): boolean => {
  let current: TestNode | null = node.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
};
async function press(node: TestNode): Promise<void> {
  await act(async () => {
    (node.props.onClick as ((event: unknown) => void) | undefined)?.({
      nativeEvent: {},
      altKey: false,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
      isDefaultPrevented: () => false,
      currentTarget: {},
      target: {},
    });
  });
  await flush();
}

beforeEach(() => {
  mockReplace.mockReset();
  mockFetch.mockReset();
  mockWide = false;
});

describe("Send is a real, separate button (#3872)", () => {
  it("is its own accessible button, a sibling of the Campaigns row", async () => {
    mockFetch.mockResolvedValue(overview());
    const onNewCampaign = jest.fn();
    const r = await mount(null, onNewCampaign);
    const row = byLabel(r, "Campaigns, 3 sent · last Oct 24");
    const send = byLabel(r, "Send a campaign");
    expect(row.props.role).toBe("button");
    expect(send.props.role).toBe("button");
    // Never a button inside a button.
    expect(isInside(send, row)).toBe(false);
    expect(isInside(row, send)).toBe(false);

    await press(send);
    expect(onNewCampaign).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    await press(row);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/marketing/campaigns");
    expect(onNewCampaign).toHaveBeenCalledTimes(1);
  });

  it("keeps its 44pt hit area (hitSlop) in the kit", () => {
    // Read from the kit so a smaller hitSlop is caught without a device.
    const { PROGRAM_BUTTON_HIT_SLOP } = jest.requireActual("../../programs/ProgramKit") as {
      PROGRAM_BUTTON_HIT_SLOP: { top: number; bottom: number };
    };
    expect(36 + PROGRAM_BUTTON_HIT_SLOP.top + PROGRAM_BUTTON_HIT_SLOP.bottom).toBeGreaterThanOrEqual(44);
  });

  it("stays a sibling of the card on desktop, beside four way cards", async () => {
    mockWide = true;
    mockFetch.mockResolvedValue(overview());
    const r = await mount();
    for (const key of ["campaigns", "ads", "creators", "referrals"]) {
      byTestId(r, `blast-overview-way-${key}`);
    }
    const card = byTestId(r, "blast-overview-way-campaigns-open");
    const send = byLabel(r, "Send a campaign");
    expect(isInside(send, card)).toBe(false);
  });
});

/**
 * The resolved CSS declarations of a host node: its react-native-web classes
 * (looked up in RNW's own style sheet) overlaid with its inline style.
 */
function resolvedCss(node: TestNode): Record<string, string> {
  const sheet = (StyleSheet as unknown as { getSheet: () => { textContent: string } }).getSheet();
  const out: Record<string, string> = {};
  const classes = String(node.props.className ?? "").split(/\s+/).filter(Boolean);
  for (const cls of classes) {
    const escaped = cls.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const match = sheet.textContent.match(new RegExp(`\\.${escaped}\\{([^}]*)\\}`));
    if (!match) continue;
    for (const decl of match[1].split(";")) {
      const at = decl.indexOf(":");
      if (at > 0) out[decl.slice(0, at).trim()] = decl.slice(at + 1).trim();
    }
  }
  const inline = (node.props.style ?? {}) as Record<string, string | number>;
  for (const [key, value] of Object.entries(inline)) {
    out[key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)] = String(value);
  }
  return out;
}
const px = (value: string | undefined): number => {
  if (value === undefined) throw new Error("no such declaration");
  return Number.parseFloat(value);
};

describe("real 44px hit targets on web (#3872)", () => {
  it("Send's pressable is at least 44px tall around a 36px pill, with a 36px footprint", async () => {
    mockFetch.mockResolvedValue(overview());
    const r = await mount();
    const send = byLabel(r, "Send a campaign");
    const box = resolvedCss(send);
    expect(px(box["min-height"])).toBeGreaterThanOrEqual(44);
    // The negative margin keeps the layout footprint at the pill's 36px.
    expect(px(box["min-height"]) + px(box["margin-top"]) + px(box["margin-bottom"])).toBe(36);
    // The pill is the first host element inside the pressable.
    const pill = send.findAll((n) => typeof n.type === "string" && n !== send)[0];
    if (!pill) throw new Error("no pill");
    expect(resolvedCss(pill).height).toBe("36px");
  });

  it("the fallback notice's Dismiss is a 44px box with a 32px footprint", async () => {
    mockFetch.mockImplementation((_brand: string, listing: { id: string } | null) =>
      listing
        ? Promise.reject(new PromotionOverviewError("listing_not_found"))
        : Promise.resolve(overview()),
    );
    const r = await mount({ kind: "venue", id: "gone" });
    await until(r, () => allText(r).includes("isn't published any more"));
    const box = resolvedCss(byLabel(r, "Dismiss"));
    expect(px(box.width)).toBeGreaterThanOrEqual(44);
    expect(px(box.height)).toBeGreaterThanOrEqual(44);
    expect(px(box.height) + px(box["margin-top"]) + px(box["margin-bottom"])).toBe(20);
    expect(px(box.width) + px(box["margin-left"]) + px(box["margin-right"])).toBe(32);
  });
});

describe("error state has a working Try again (#3872)", () => {
  it("refetches and then shows the results", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network"));
    mockFetch.mockResolvedValueOnce(overview());
    const r = await mount();
    expect(allText(r)).toContain("Promotion results didn't load");
    expect(allText(r)).not.toContain("Pull down");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await press(byTestId(r, "blast-overview-retry"));
    await until(r, () => hosts(r, (n) => n.props["data-testid"] === "blast-overview-results").length > 0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(allText(r)).not.toContain("Promotion results didn't load");
    byTestId(r, "blast-overview-results");
  });
});

describe("picker marks the selected scope without colour alone (#3872)", () => {
  it("checks Whole brand, then moves the check to the picked listing", async () => {
    mockFetch.mockImplementation((_brand: string, listing: { id: string } | null) =>
      Promise.resolve(
        overview(listing ? { listing: LISTINGS[0] } : {}),
      ),
    );
    const r = await mount();
    await press(byTestId(r, "blast-overview-listing-picker"));

    const whole = byTestId(r, "blast-overview-option-whole-brand");
    expect(whole.props.role).toBe("radio");
    expect(whole.props["aria-checked"]).toBe(true);
    byTestId(r, "blast-overview-option-whole-brand-check");
    expect(byTestId(r, "blast-overview-option-event-e1").props["aria-checked"]).toBe(false);
    expect(hosts(r, (n) => n.props["data-testid"] === "blast-overview-option-event-e1-check")).toHaveLength(0);
    // Both kinds → group headers.
    expect(allText(r)).toContain("Events");
    expect(allText(r)).toContain("Venues");
    expect(allText(r)).toContain("Everything Rooftop Social Lagos is promoting");
    expect(allText(r)).toContain("Event · Nov 9");

    await press(byTestId(r, "blast-overview-option-event-e1"));
    await press(byTestId(r, "blast-overview-listing-picker"));
    expect(byTestId(r, "blast-overview-option-event-e1").props["aria-checked"]).toBe(true);
    byTestId(r, "blast-overview-option-event-e1-check");
    expect(byTestId(r, "blast-overview-option-whole-brand").props["aria-checked"]).toBe(false);
  });
});

describe("Whole brand names the brand-wide scope (#3872)", () => {
  it("whole-brand view", async () => {
    mockFetch.mockResolvedValue(overview());
    const r = await mount();
    const text = allText(r);
    expect(text).toContain("Whole brand");
    expect(text).toContain("Promotion across the brand");
    expect(text).not.toMatch(/all listings|All promotion|Promoting this listing/i);
    byLabel(r, "Showing Whole brand. Change what you see");
    expect(hosts(r, (n) => n.props["data-testid"] === "blast-overview-whole-brand")).toHaveLength(0);
  });

  it("one-listing view offers See whole brand and returns to it", async () => {
    mockFetch.mockImplementation((_brand: string, listing: { id: string } | null) =>
      Promise.resolve(overview(listing ? { listing: LISTINGS[0] } : {})),
    );
    const r = await mount({ kind: "event", id: "e1" });
    expect(allText(r)).toContain("Promotion for this event");
    byLabel(r, "Showing Afrobeats Brunch · Nov 9. Change what you see");
    await press(byTestId(r, "blast-overview-whole-brand"));
    expect(allText(r)).toContain("Promotion across the brand");
    expect(mockFetch).toHaveBeenLastCalledWith("b1", null);
  });

  it("a gone listing falls back to the whole brand and says so", async () => {
    mockFetch.mockImplementation((_brand: string, listing: { id: string } | null) =>
      listing
        ? Promise.reject(new PromotionOverviewError("listing_not_found"))
        : Promise.resolve(overview()),
    );
    const r = await mount({ kind: "venue", id: "gone" });
    await until(r, () => allText(r).includes("Promotion across the brand"));
    expect(allText(r)).toContain(
      "That venue isn't published any more, so you're seeing the whole brand.",
    );
    expect(allText(r)).toContain("Promotion across the brand");
    await press(byLabel(r, "Dismiss"));
    expect(allText(r)).not.toContain("isn't published any more");
  });

  it("an all-zero strip reads calm and explains itself; Needs setup is tagged", async () => {
    mockFetch.mockResolvedValue(
      overview({
        sold_minor: 0,
        clicks: 0,
        spent_minor: 0,
        listings: [],
        ads: { live: 0, draft: 0, needs_setup: true },
      }),
    );
    const r = await mount();
    expect(allText(r)).toContain(
      "Numbers show up here once a campaign, ad, creator or referral sends someone to buy.",
    );
    expect(allText(r)).toContain("Needs setup");
    await press(byTestId(r, "blast-overview-listing-picker"));
    expect(allText(r)).toContain("Publish an event or venue to see its promotion on its own.");
  });
});
