/**
 * #3872 Promote overview — tester adversarial proofs (a different angle from
 * the implementor's suites).
 *
 * ANGLE 1 — the failure shapes Supabase really throws. The implementor's
 * Try again proof rejects with `new Error("network")`, an error with no
 * `code`. `fetchPromotionOverview` rethrows the supabase-js error object, and
 * postgrest-js ALWAYS gives it a string `code`: `""` for a network failure
 * (fetch threw), `"42501"` for permission denied, `"57014"` for a statement
 * timeout. A server `{ok:false}` answer other than the two fallback codes
 * arrives as `PromotionOverviewError("<code>")`. Every one of those must show
 * the "didn't load" card with Try again, never a blank area under the
 * picker, and a retry that fails again must keep the card.
 *
 * ANGLE 2 — GlassCard's flattened content style, through react-native-web,
 * for the shapes REAL consumers pass that the implementor's padding proof
 * does not cover: a `padding` SHORTHAND inside contentStyle
 * (GuestRosterExperience rows with `padding={0}`, CompetitorWatchSection with
 * the default 16), an array with a `null` entry (BlastPromotionOverview way
 * cards), a longhand on top of `paddingHorizontal` (native Yoga precedence),
 * and the #1532 layout keys (`gap`, `flexDirection`) that must still reach the
 * content node. The caller's StyleSheet object must not be mutated.
 *
 * FAILS ON REVERT (angle 2): put `style={[{ padding }, contentStyle]}` back in
 * GlassCard.tsx and the shorthand cases go red (the inline card padding beats
 * the caller's class on web).
 *
 * Run (from mingla-business/):
 *   npx jest --config jest.issue3872promote.web.render.cjs --ci --maxWorkers=2
 */
import React from "react";
import { StyleSheet, Text } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// No @types/react-test-renderer in this app: type the slice these proofs use.
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

const mockFetch = jest.fn();

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
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
  useResponsiveLayout: () => ({ isWideDesktop: false, isWeb: true, width: 390, isShort: false }),
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
import { GlassCard } from "../../ui/GlassCard";
import { mapPromotionOverview } from "../../../services/promotionOverview";
import { PromotionOverviewError } from "../../../services/promotionOverviewService";

type Style = Record<string, string | undefined>;

const hosts = (r: Renderer, test: (n: TestNode) => boolean) =>
  r.root.findAll((n) => typeof n.type === "string" && test(n));
const hasTestId = (r: Renderer, id: string) =>
  hosts(r, (n) => n.props["data-testid"] === id).length > 0;
const byTestId = (r: Renderer, id: string) => {
  const found = hosts(r, (n) => n.props["data-testid"] === id);
  if (found.length === 0) throw new Error(`no ${id}`);
  return found[0];
};
const allText = (r: Renderer): string =>
  hosts(r, () => true)
    .flatMap((n) => n.children.filter((c): c is string => typeof c === "string"))
    .join(" | ");

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Settle until neither the skeleton nor an in-flight request is on screen. */
async function settle(r: Renderer): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (!hasTestId(r, "blast-overview-skeleton")) {
      await flush();
      return;
    }
    await flush();
  }
  throw new Error(`never settled: ${allText(r)}`);
}

async function mountOverview(): Promise<Renderer> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let renderer: Renderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={client}>
        <BlastPromotionOverview
          brandId="b1"
          brandName="Rooftop Social Lagos"
          initialListing={null}
          onNewCampaign={jest.fn()}
        />
      </QueryClientProvider>,
    );
  });
  if (!renderer) throw new Error("did not mount");
  await settle(renderer);
  return renderer;
}

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

function overview() {
  return mapPromotionOverview({
    ok: true,
    listings: [],
    listing: null,
    currency: "USD",
    sold_minor: 0,
    tickets: 0,
    clicks: 0,
    spent_minor: 0,
    campaigns: null,
    ads: null,
    creators: {},
    referrals: {},
  });
}

/** The object postgrest-js returns as `error` (supabase.rpc never throws). */
function postgrestError(code: string, message: string) {
  return { message, details: "", hint: "", code };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("ANGLE 1 — real Supabase failures show the error card, never a blank (#3872)", () => {
  const cases: Array<[string, () => unknown]> = [
    ["network failure (postgrest code \"\")", () => postgrestError("", "TypeError: Failed to fetch")],
    ["permission denied (42501)", () => postgrestError("42501", "permission denied for function")],
    ["statement timeout (57014)", () => postgrestError("57014", "canceling statement due to statement timeout")],
    ["server {ok:false} other than the fallback codes", () => new PromotionOverviewError("unknown")],
  ];

  it.each(cases)("%s → \"didn't load\" + Try again", async (_name, makeError) => {
    mockFetch.mockRejectedValue(makeError());
    const r = await mountOverview();
    expect(hasTestId(r, "blast-overview-results")).toBe(false);
    // Expected: the error card. Actual on a regression: nothing under the picker.
    expect(allText(r)).toContain("Promotion results didn't load");
    expect(hasTestId(r, "blast-overview-retry")).toBe(true);
  });

  it("a retry that fails again keeps the card and Try again (never blank)", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));
    const r = await mountOverview();
    await press(byTestId(r, "blast-overview-retry"));
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(allText(r)).toContain("Promotion results didn't load");
    expect(allText(r)).toContain("Try again");
  });

  it("the fallback codes still fall back to the whole brand, not the error card", async () => {
    mockFetch.mockImplementation((_brand: string, listing: unknown) =>
      listing ? Promise.reject(new PromotionOverviewError("listing_not_found")) : Promise.resolve(overview()),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let r: Renderer | undefined;
    await act(async () => {
      r = TestRenderer.create(
        <QueryClientProvider client={client}>
          <BlastPromotionOverview
            brandId="b1"
            initialListing={{ kind: "venue", id: "gone" }}
            onNewCampaign={jest.fn()}
          />
        </QueryClientProvider>,
      );
    });
    const mounted = r as Renderer;
    for (let i = 0; i < 20 && !hasTestId(mounted, "blast-overview-results"); i += 1) await flush();
    expect(hasTestId(mounted, "blast-overview-results")).toBe(true);
    expect(allText(mounted)).not.toContain("Promotion results didn't load");
    expect(allText(mounted)).toContain("isn't published any more");
  });
});

function contentStyleOf(element: React.ReactElement): Style {
  let renderer: Renderer | undefined;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  if (!renderer) throw new Error("did not mount");
  return byTestId(renderer, "card-content").props.style as Style;
}

const sheet = StyleSheet.create({
  rosterRow: { padding: 16, flexDirection: "row", alignItems: "center", gap: 16 },
  competitorCard: { gap: 16, padding: 20 },
  wayContent: { flexDirection: "row", gap: 16 },
  wayAction: { paddingRight: 120 },
  mixed: { paddingHorizontal: 24, paddingLeft: 8 },
});

describe("ANGLE 2 — GlassCard content padding for real consumer shapes on web (#3872)", () => {
  it("padding={0} + a contentStyle `padding` shorthand (guest roster rows) → 16 on every side", () => {
    const style = contentStyleOf(
      <GlassCard testID="card" padding={0} contentStyle={sheet.rosterRow}>
        <Text>row</Text>
      </GlassCard>,
    );
    expect(style.paddingTop).toBe("16px");
    expect(style.paddingRight).toBe("16px");
    expect(style.paddingBottom).toBe("16px");
    expect(style.paddingLeft).toBe("16px");
  });

  it("default padding + a larger contentStyle shorthand (competitor card) → the caller's 20", () => {
    const style = contentStyleOf(
      <GlassCard testID="card" contentStyle={sheet.competitorCard}>
        <Text>card</Text>
      </GlassCard>,
    );
    expect(style.paddingLeft).toBe("20px");
    expect(style.paddingBottom).toBe("20px");
  });

  it("an array with a null entry (way card without Send) keeps the prop padding and layout keys", () => {
    const style = contentStyleOf(
      <GlassCard testID="card" padding={20} contentStyle={[sheet.wayContent, null]}>
        <Text>way</Text>
      </GlassCard>,
    );
    expect(style.paddingLeft).toBe("20px");
    expect(style.paddingRight).toBe("20px");
    expect(style.flexDirection).toBe("row");
    expect(style.gap).toBe("16px");
  });

  it("an array with an action entry reserves the right edge only", () => {
    const style = contentStyleOf(
      <GlassCard testID="card" padding={20} contentStyle={[sheet.wayContent, sheet.wayAction]}>
        <Text>way</Text>
      </GlassCard>,
    );
    expect(style.paddingRight).toBe("120px");
    expect(style.paddingLeft).toBe("20px");
    expect(style.paddingTop).toBe("20px");
  });

  it("a longhand on top of paddingHorizontal wins on its edge (native Yoga precedence)", () => {
    const style = contentStyleOf(
      <GlassCard testID="card" padding={4} contentStyle={sheet.mixed}>
        <Text>mixed</Text>
      </GlassCard>,
    );
    expect(style.paddingLeft).toBe("8px");
    expect(style.paddingRight).toBe("24px");
    expect(style.paddingTop).toBe("4px");
  });

  it("does not mutate the caller's StyleSheet object", () => {
    const before = JSON.stringify(sheet.rosterRow);
    contentStyleOf(
      <GlassCard testID="card" padding={0} contentStyle={sheet.rosterRow}>
        <Text>row</Text>
      </GlassCard>,
    );
    expect(JSON.stringify(sheet.rosterRow)).toBe(before);
    expect(sheet.rosterRow).not.toHaveProperty("paddingTop");
  });
});

describe("ANGLE 3 — the scope radio group works from the keyboard (#3872)", () => {
  it("ArrowDown moves from Whole brand to the first listing", async () => {
    mockFetch.mockImplementation((_brand: string, listing: { id: string } | null) =>
      Promise.resolve(
        mapPromotionOverview({
          ok: true,
          listings: [
            {
              kind: "event",
              id: "event-keyboard",
              title: "Keyboard Brunch",
              starts_at: "2026-11-09T14:00:00Z",
            },
          ],
          listing: listing
            ? {
                kind: "event",
                id: "event-keyboard",
                title: "Keyboard Brunch",
                starts_at: "2026-11-09T14:00:00Z",
              }
            : null,
          currency: "NGN",
          sold_minor: 0,
          tickets: 0,
          clicks: 0,
          spent_minor: 0,
          campaigns: null,
          ads: null,
          creators: {},
          referrals: {},
        }),
      ),
    );
    const renderer = await mountOverview();
    await press(byTestId(renderer, "blast-overview-listing-picker"));

    const wholeBrand = byTestId(renderer, "blast-overview-option-whole-brand");
    expect(wholeBrand.props.role).toBe("radio");
    expect(wholeBrand.props["aria-checked"]).toBe(true);
    expect(typeof wholeBrand.props.onKeyDown).toBe("function");

    const preventDefault = jest.fn();
    const target = {
      tagName: "DIV",
      getAttribute: (name: string) => (name === "role" ? "radio" : null),
    };
    await act(async () => {
      (wholeBrand.props.onKeyDown as (event: unknown) => void)({
        key: "ArrowDown",
        target,
        currentTarget: target,
        preventDefault,
        stopPropagation: jest.fn(),
      });
    });
    await flush();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenLastCalledWith("b1", {
      kind: "event",
      id: "event-keyboard",
    });
  });
});
