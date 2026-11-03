/**
 * #4238 — tester adversarial suite for the Host ads builder (Business app).
 * Different angles from the implementor's suites:
 *
 *  1. No country is ever invented: for EVERY known non-NG brand country the
 *     builder starts on that country and never on Nigeria; junk draft values
 *     (numbers, objects, spaced codes) are dropped, never coerced.
 *  2. The country picker chips: adding a lowercase code stores ISO upper case,
 *     re-adding a chosen country never duplicates it, removing works, and the
 *     open picker never shows or announces a dial code.
 *  3. "Ticket sales" is never frozen for a website, a non-ticket page,
 *     Google/Reddit, or an old draft connection with no readiness field.
 *  4. Targeting search always tells the server it is a Host and never names a
 *     lane (the server owns it); a Host never sees the plan hash, but the
 *     approval still sends it.
 *
 * Fails on revert: (1) the "NG" default in create.tsx / initialHostAdCountries,
 * (3) dropping the page-type check in hostAdPageSellsTickets, (4) restoring
 * `lane: "business"` in searchHostAdTargeting.
 */

import fs from "node:fs";
import path from "node:path";
import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = {
  props: Record<string, unknown>;
  type: unknown;
  children: (RenderNode | string)[];
};
type Renderer = {
  root: {
    findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
  };
  unmount: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => Renderer;
};

jest.mock("react-native", () => {
  const base = jest.requireActual("react-native") as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require("react") as typeof React;
  const FlatList = ({
    data,
    renderItem,
  }: {
    data: readonly unknown[];
    renderItem: (info: { item: unknown; index: number }) => React.ReactElement;
  }) =>
    ReactLib.createElement(
      "FlatList",
      null,
      data.map((item, index) =>
        ReactLib.cloneElement(renderItem({ item, index }), { key: String(index) }),
      ),
    );
  return {
    ...base,
    FlatList,
    Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
  };
});
jest.mock("../../../../../../packages/phone-input/keyboardPrimitives", () => ({
  KeyboardProvider: ({ children }: { children: React.ReactNode }) => children,
  KeyboardToolbar: () => null,
}));
jest.mock(
  "react-native-safe-area-context",
  () => ({
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  }),
  { virtual: true },
);
jest.mock(
  "expo-haptics",
  () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }),
  { virtual: true },
);
jest.mock("../../../ui/PhoneField", () => ({ BUSINESS_SHEET_PHONE_THEME: {} }));
jest.mock("../../../ui/Icon", () => ({ Icon: () => null }));

const mockInvoke = jest.fn();
jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

// eslint-disable-next-line import/first
import { HostAdCountryPicker } from "../HostAdCountryPicker";
// eslint-disable-next-line import/first
import { initialHostAdCountries } from "../hostAdCountries";
// eslint-disable-next-line import/first
import { COUNTRIES } from "../../../../../../packages/phone-input/countries";
// eslint-disable-next-line import/first
import {
  hostAdPageSellsTickets,
  hostOptimizationByPlatform,
  searchHostAdTargeting,
  type HostAdConnection,
} from "../../../../services/hostAdPlanService";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

const textOf = (node: RenderNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

function render(element: React.ReactElement): Renderer {
  let renderer: Renderer | null = null;
  act(() => {
    renderer = create(element);
  });
  return renderer as unknown as Renderer;
}

const byTestId = (renderer: Renderer, id: string): RenderNode[] =>
  renderer.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === id,
  );

describe("#4238 ADV-1 no invented country", () => {
  it("starts every known non-NG brand on its own country, never Nigeria", () => {
    const others = COUNTRIES.filter((country) => country.code !== "NG");
    expect(others.length).toBeGreaterThan(100);
    for (const country of others) {
      expect(initialHostAdCountries(country.code)).toEqual([country.code]);
      expect(initialHostAdCountries(country.code.toLowerCase(), [], "")).toEqual([
        country.code,
      ]);
      expect(initialHostAdCountries(country.code, null, null)).not.toContain("NG");
    }
  });

  it("drops junk saved values instead of coercing them", () => {
    expect(
      initialHostAdCountries("US", [123, { code: "GH" }, "N G", "NGA", "", null, "ZZ"]),
    ).toEqual(["US"]);
    expect(initialHostAdCountries(undefined, ["ZZ", "XX"], "ZZ, 12")).toEqual([]);
    expect(initialHostAdCountries("", null, null)).toEqual([]);
    expect(initialHostAdCountries("ZZ")).toEqual([]);
  });

  it("keeps the builder free of a Nigeria fallback anywhere", () => {
    const createRoute = read("src/screens/hostAds/HostAdCreateScreen.tsx");
    expect(createRoute).not.toMatch(/\?\?\s*"NG"/);
    expect(createRoute).not.toMatch(/useState\(\s*"NG"\s*\)/);
    const countries = read("src/components/marketing/ads/hostAdCountries.ts");
    expect(countries).not.toContain('"NG"');
  });
});

describe("#4238 ADV-2 country picker chips", () => {
  it("stores ISO upper case, never duplicates, removes, and hides dial codes", () => {
    const onChange = jest.fn();
    const renderer = render(
      <HostAdCountryPicker countries={["GB"]} onChange={onChange} />,
    );
    const chips = textOf(renderer.root as unknown as RenderNode);
    expect(chips).toContain("United Kingdom");
    expect(chips).not.toMatch(/\+\d/);

    act(() => {
      (byTestId(renderer, "host-ad-country-add")[0].props.onPress as () => void)();
    });
    const opened = textOf(renderer.root as unknown as RenderNode);
    expect(opened).toContain("Nigeria");
    expect(opened).not.toContain("+234");
    expect(opened).not.toContain("+44");
    const announced = renderer.root
      .findAll(
        (node) =>
          node.props.accessibilityRole === "button" &&
          typeof node.props.accessibilityLabel === "string",
      )
      .map((node) => String(node.props.accessibilityLabel));
    expect(announced.some((label) => /\+\d/.test(label))).toBe(false);

    // Selecting a lowercase code adds it as ISO upper case.
    const modal = renderer.root.findAll(
      (node) => typeof node.props.onSelect === "function",
    )[0];
    act(() => {
      (modal.props.onSelect as (code: string) => void)("gh");
    });
    expect(onChange).toHaveBeenLastCalledWith(["GB", "GH"]);

    // Re-adding a chosen country never duplicates it.
    onChange.mockClear();
    act(() => {
      (byTestId(renderer, "host-ad-country-add")[0].props.onPress as () => void)();
    });
    const again = renderer.root.findAll(
      (node) => typeof node.props.onSelect === "function",
    )[0];
    act(() => {
      (again.props.onSelect as (code: string) => void)("GB");
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      (byTestId(renderer, "host-ad-country-remove-GB")[0].props.onPress as () => void)();
    });
    expect(onChange).toHaveBeenLastCalledWith([]);
    act(() => renderer.unmount());
  });
});

describe("#4238 ADV-3 ticket sales is never frozen where it cannot work", () => {
  const ready = (platform: HostAdConnection["platform"]) =>
    ({ platform, sales: { ready: true, reason: "ready" } }) as Pick<
      HostAdConnection,
      "platform" | "sales"
    >;

  it("a website or non-ticket page stays on visits even when every platform is ready", () => {
    const all = (["meta", "snapchat", "tiktok", "google", "reddit"] as const).map(ready);
    for (const page of [
      { page_type: "site", result_kind: "tickets" },
      { page_type: "brand", result_kind: "tickets" },
      { page_type: "rsvp", result_kind: "signups" },
      { page_type: "venue", result_kind: "bookings" },
      { page_type: "event", result_kind: null },
    ]) {
      expect(hostAdPageSellsTickets(page)).toBe(false);
      expect(hostOptimizationByPlatform("sales", page, all)).toEqual({
        meta: "visits",
        snapchat: "visits",
        tiktok: "visits",
        google: "visits",
        reddit: "visits",
      });
    }
  });

  it("Google/Reddit and an old draft connection without readiness stay on visits", () => {
    const page = { page_type: "event", result_kind: "tickets" };
    const oldDraft = { platform: "meta" } as unknown as Pick<
      HostAdConnection,
      "platform" | "sales"
    >;
    expect(
      hostOptimizationByPlatform("sales", page, [
        ready("google"),
        ready("reddit"),
        oldDraft,
        { platform: "snapchat", sales: { ready: "true" as unknown as boolean, reason: "ready" } },
        ready("tiktok"),
      ]),
    ).toEqual({
      google: "visits",
      reddit: "visits",
      meta: "visits",
      snapchat: "visits",
      tiktok: "sales",
    });
    // Visits chosen means visits everywhere, ready or not.
    expect(hostOptimizationByPlatform("visits", page, [ready("meta")])).toEqual({
      meta: "visits",
    });
  });
});

describe("#4238 ADV-4 the server owns the lane and the hash stays hidden", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("targeting search says it is a Host and never names a lane", async () => {
    mockInvoke.mockResolvedValue({ data: { results: [] }, error: null });
    for (const kind of ["city", "interest"] as const) {
      await searchHostAdTargeting({
        brandId: "b0000000-0000-4000-8000-000000000001",
        platform: "meta",
        kind,
        query: "Lagos",
        country: "GB",
      });
    }
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    for (const [name, request] of mockInvoke.mock.calls) {
      expect(name).toBe("admin-ad-targeting-search");
      const body = (request as { body: Record<string, unknown> }).body;
      expect(body.owner_kind).toBe("host");
      expect("lane" in body).toBe(false);
    }
  });

  it("no Host screen prints the plan hash; the approval still carries it", () => {
    const createRoute = read("src/screens/hostAds/HostAdCreateScreen.tsx");
    expect(createRoute).not.toMatch(/\{\s*prepared\.planHash\s*\}/);
    expect(createRoute).not.toMatch(/plan hash/i);
    expect(createRoute).toMatch(/planHash: prepared\.planHash/);
    const card = read("src/components/ari/ToolProposalCard.tsx");
    expect(card).not.toContain("Plan binding");
    expect(card).not.toMatch(/label:\s*"[^"]*binding/i);
    const service = read("src/services/hostAdPlanService.ts");
    expect(service).not.toMatch(/lane:\s*"business"/);
  });
});
