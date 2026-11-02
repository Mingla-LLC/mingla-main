/**
 * #4238 — Host ads builder: readable page labels, named countries, one honest
 * unavailable state, truthful copy, and a server-checked ticket-sales goal.
 *
 * invariant: {"id":"I-PROPOSED-HOST-AD-NO-FABRICATED-COUNTRY","status":"DRAFT","issue":4238,"rule":"The Host ads builder never defaults a country it did not read from the brand or the saved draft (no hard-coded \"NG\").","gate":"this file: T-C1, T-C2, T-C4"}
 *
 * Fails on revert: T-B1 (labels module absent), T-C1 (Nigeria default),
 * T-D1 (unavailable state removed), T-E1 (lookalike copy restored), T-F4
 * (goal not frozen into the plan).
 */

import fs from "node:fs";
import path from "node:path";

import {
  HOST_AD_PAGE_TYPE_LABEL,
  HOST_AD_PAGE_TYPE_ORDER,
  hostAdPageMeta,
  isImageCoverUrl,
  pageTypeFilters,
} from "../hostAdPageLabels";
import {
  countryLabel,
  initialHostAdCountries,
} from "../hostAdCountries";
import { hostAdSetupErrorCopy } from "../hostAdSetupCopy";
import { filterCountryList } from "../../../../../../packages/phone-input/CountryPickerModal";
import { COUNTRIES } from "../../../../../../packages/phone-input/countries";

// The country picker module's native boundaries are not under test here; only
// its pure search helper is.
jest.mock("../../../../../../packages/phone-input/keyboardPrimitives", () => ({
  KeyboardProvider: () => null,
  KeyboardToolbar: () => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: () => null,
  SafeAreaView: () => null,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}), { virtual: true });
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}), { virtual: true });

const mockInvoke = jest.fn();
jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

// eslint-disable-next-line import/first
import {
  hostAdPageSellsTickets,
  hostOptimizationByPlatform,
  hostOptimizationSummary,
  prepareHostAdPlan,
  type HostAdConnection,
  type HostAdPage,
} from "../../../../services/hostAdPlanService";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

const createRoute = read("app/(tabs)/marketing/ads/create.tsx");

describe("#4238 page labels (T-B1..B4)", () => {
  it("T-B1 reads type, date and city", () => {
    expect(
      hostAdPageMeta({
        page_type: "trip",
        starts_at: "2026-12-05T12:00:00Z",
        city: "Lagos",
      }),
    ).toBe("Trip · Sat 5 Dec · Lagos");
    expect(hostAdPageMeta({ page_type: "brand", starts_at: null, city: null })).toBe(
      "Brand page",
    );
    expect(
      hostAdPageMeta({ page_type: "venue", starts_at: "not a date", city: " Accra " }),
    ).toBe("Venue · Accra");
  });

  it("T-B2 labels every Host page type the RPC returns", () => {
    // ad_advertisable_pages v_types minus the Admin-only marketing type.
    const rpcTypes = ["event", "rsvp", "trip", "experience", "brand", "venue", "reservation", "site"];
    for (const type of rpcTypes) {
      expect(HOST_AD_PAGE_TYPE_LABEL[type as keyof typeof HOST_AD_PAGE_TYPE_LABEL]).toBeTruthy();
    }
    expect([...HOST_AD_PAGE_TYPE_ORDER].sort()).toEqual([...rpcTypes].sort());
    expect(HOST_AD_PAGE_TYPE_LABEL.venue).toBe("Venue");
  });

  it("T-B3 never draws a video as a cover image", () => {
    expect(isImageCoverUrl("https://x/v.mp4?a=1")).toBe(false);
    expect(isImageCoverUrl("https://x/v.MOV")).toBe(false);
    expect(isImageCoverUrl("https://x/live.m3u8#t")).toBe(false);
    expect(isImageCoverUrl("https://x/c.jpg")).toBe(true);
    expect(isImageCoverUrl(null)).toBe(false);
    expect(isImageCoverUrl("  ")).toBe(false);
  });

  it("T-B4 offers filters only for types present, in order", () => {
    expect(
      pageTypeFilters([{ page_type: "venue" }, { page_type: "event" }, { page_type: "event" }]),
    ).toEqual(["all", "event", "venue"]);
  });
});

describe("#4238 countries (T-C1..C4)", () => {
  it("T-C1 starts from the draft, then legacy text, then the brand, never Nigeria", () => {
    expect(initialHostAdCountries("GB")).toEqual(["GB"]);
    expect(initialHostAdCountries("gb")).toEqual(["GB"]);
    expect(initialHostAdCountries(null)).toEqual([]);
    expect(initialHostAdCountries(null, null, "NG, gh")).toEqual(["NG", "GH"]);
    expect(initialHostAdCountries("GB", ["KE"], "NG")).toEqual(["KE"]);
    expect(initialHostAdCountries("GB", [], "")).toEqual(["GB"]);
    expect(countryLabel("NG")).toBe("🇳🇬 Nigeria");
  });

  it("T-C2 the builder has no hard-coded country and no code text field", () => {
    expect(createRoute).not.toContain('"NG"');
    expect(createRoute).not.toContain("Country codes");
    expect(createRoute).not.toContain("countriesText");
    expect(createRoute).toContain("<HostAdCountryPicker");
    expect(createRoute).toContain("Choose at least one country.");
    expect(createRoute).toContain("Choose a country first.");
  });

  it("T-C3 the phone picker still searches dial codes; the country picker does not", () => {
    expect(filterCountryList(COUNTRIES, "+234").map((c) => c.code)).toContain("NG");
    expect(filterCountryList(COUNTRIES, "+234", true).map((c) => c.code)).toContain("NG");
    expect(filterCountryList(COUNTRIES, "+234", false)).toEqual([]);
    expect(filterCountryList(COUNTRIES, "niger", false).map((c) => c.code)).toEqual(
      expect.arrayContaining(["NG", "NE"]),
    );
    expect(filterCountryList(COUNTRIES, "")).toBe(COUNTRIES);
  });

  it("T-C4 drops unknown codes", () => {
    expect(initialHostAdCountries("ZZ")).toEqual([]);
    expect(initialHostAdCountries(null, null, "ZZ, ng, QQ")).toEqual(["NG"]);
    expect(initialHostAdCountries("GB", ["ZZ"])).toEqual(["GB"]);
  });
});

describe("#4238 honest states and copy (T-D1, T-D2, T-E1, SC-12)", () => {
  it("T-D1 shows one 'Ads aren't available yet' state before any step UI", () => {
    const gate = createRoute.indexOf("setup.available === false");
    const unavailable = createRoute.indexOf('testID="host-ad-unavailable"');
    const steps = createRoute.indexOf('accessibilityLabel="Ad builder steps"');
    expect(gate).toBeGreaterThan(-1);
    expect(unavailable).toBeGreaterThan(gate);
    expect(steps).toBeGreaterThan(unavailable);
    for (const jargon of [
      "business-lane",
      "provider account currency",
      "Provider IDs",
      "Provider mappings",
      "provider-native",
      "Snapchat coordinates",
      "Choose a connected platform",
    ]) {
      expect(createRoute).not.toContain(jargon);
    }
  });

  it("T-D2 maps setup errors to plain English", () => {
    expect(hostAdSetupErrorCopy("currency_authority_unresolved")).toBe(
      "Set your brand's payout currency before running ads.",
    );
    expect(hostAdSetupErrorCopy("currency_authority_unresolved:brand")).toBe(
      "Set your brand's payout currency before running ads.",
    );
    expect(hostAdSetupErrorCopy("network")).toBe("Ads setup couldn't load. Try again.");
    expect(hostAdSetupErrorCopy(null)).toBe("Ads setup couldn't load. Try again.");
  });

  it("T-E1 no surface promises lookalike audiences", () => {
    expect(read("src/components/ari/renditions/AriRenditionPreview.tsx")).not.toMatch(
      /lookalike/i,
    );
    expect(
      read("../mingla-admin/src/components/campaign-builder/StepAudience.jsx"),
    ).not.toMatch(/lookalike/i);
  });

  it("the page picker never prints a raw URL", () => {
    const picker = read("src/components/marketing/ads/HostAdPagePicker.tsx");
    expect(picker).not.toContain("canonical_url");
    expect(createRoute).toContain("<HostAdPagePicker");
  });
});

const page = (resultKind: string): HostAdPage => ({
  page_type: resultKind === "tickets" ? "event" : "rsvp",
  id: "page-1",
  brand_slug: "femzy",
  entity_slug: "deserted-island",
  title: "Deserted Island",
  brand_name: "Femzy",
  canonical_url: "https://usemingla.com/e/femzy/deserted-island",
  availability: "available",
  starts_at: null,
  city: "Lagos",
  cover_url: null,
  result_kind: resultKind,
});
const connection = (
  platform: HostAdConnection["platform"],
  ready: boolean,
): HostAdConnection => ({
  id: `${platform}-id`,
  platform,
  currency: "USD",
  status: "connected",
  connected: true,
  sales: { ready, reason: ready ? "ready" : "waiting_for_sales" },
});

describe("#4238 ticket-sales goal (T-F3, T-F4, SC-14)", () => {
  it("T-F4 freezes sales only on ready sales platforms of a ticket page", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((name: string, request: { body: Record<string, unknown> }) => {
      const action = request.body.action;
      if (name === "ad-plan" && action === "open") {
        return Promise.resolve({ data: { plan: { id: "plan-1" } }, error: null });
      }
      if (name === "ad-plan" && action === "create_version") {
        return Promise.resolve({
          data: {
            version: {
              id: "version-1",
              plan_hash: "a".repeat(64),
              canonical_plan: {
                optimization_by_platform: request.body.canonical_plan &&
                  (request.body.canonical_plan as Record<string, unknown>).optimization_by_platform,
              },
            },
          },
          error: null,
        });
      }
      if (name === "ad-plan" && action === "freeze_targeting") {
        return Promise.resolve({ data: { targeting_snapshots: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    const prepared = await prepareHostAdPlan({
      brandId: "brand-1",
      page: page("tickets"),
      connections: [connection("meta", true), connection("snapchat", false), connection("google", true)],
      creative: { id: "creative-1" } as never,
      name: "Deserted Island",
      primaryText: "Three days off-grid.",
      headline: "Deserted Island",
      countries: ["NG"],
      cities: [],
      radiusKm: null,
      interests: [],
      ageMin: 21,
      ageMax: 45,
      gender: "all",
      dailyBudgetCents: 3000,
      capCents: 21000,
      acceptBroader: false,
      rightsConfirmed: true,
      rightsBasis: "owned",
      aiGenerated: false,
      optimization: "sales",
    });
    const version = mockInvoke.mock.calls.find(
      ([name, request]) => name === "ad-plan" && request.body.action === "create_version",
    );
    expect(version).toBeDefined();
    expect(version?.[1].body.canonical_plan.optimization_by_platform).toEqual({
      meta: "sales",
      snapchat: "visits",
      google: "visits",
    });
    expect(prepared.optimizationByPlatform).toEqual({
      meta: "sales",
      snapchat: "visits",
      google: "visits",
    });
    for (const [, request] of mockInvoke.mock.calls) {
      expect(request.body).not.toHaveProperty("lane");
    }
  });

  it("never asks for sales on a page that does not sell tickets", () => {
    expect(
      hostOptimizationByPlatform("sales", page("signups"), [connection("meta", true)]),
    ).toEqual({ meta: "visits" });
    expect(
      hostOptimizationByPlatform("visits", page("tickets"), [connection("meta", true)]),
    ).toEqual({ meta: "visits" });
  });

  it("never offers sales for a brand website or brand page, even when it reports tickets", () => {
    const site = { ...page("tickets"), page_type: "site" };
    const brand = { ...page("tickets"), page_type: "brand" };
    expect(hostAdPageSellsTickets(site)).toBe(false);
    expect(hostAdPageSellsTickets(brand)).toBe(false);
    for (const pageType of ["event", "trip", "experience"]) {
      expect(hostAdPageSellsTickets({ ...page("tickets"), page_type: pageType })).toBe(true);
    }
    expect(hostOptimizationByPlatform("sales", site, [connection("meta", true)])).toEqual({
      meta: "visits",
    });
    expect(
      hostOptimizationByPlatform("sales", page("tickets"), [connection("meta", true)]),
    ).toEqual({ meta: "sales" });
  });

  it("splits the review line per platform", () => {
    expect(
      hostOptimizationSummary({ meta: "sales", snapchat: "sales" }, ["meta", "snapchat", "google"]),
    ).toEqual({ sales: ["meta", "snapchat"], visits: ["google"] });
    expect(hostOptimizationSummary(null, ["meta"])).toEqual({ sales: [], visits: ["meta"] });
  });

  it("T-F3 the client never authors provider objectives", () => {
    const service = read("src/services/hostAdPlanService.ts");
    expect(service).not.toMatch(/\bobjective:/);
    expect(service).not.toContain("optimization_goal");
    expect(service).not.toContain("billing_event");
    expect(service).toContain("optimization_by_platform: hostOptimizationByPlatform(");
  });

  it("SC-14 the builder offers Ticket sales only on ticket pages with a ready platform", () => {
    expect(createRoute).toContain("const pageSellsTickets = hostAdPageSellsTickets(page);");
    expect(createRoute).toContain("{pageSellsTickets ? (");
    expect(createRoute).toContain("disabled={salesReadyPlatforms.length === 0}");
    expect(createRoute).toContain("Not enough ticket sales on these platforms yet.");
    expect(createRoute).toContain('testID="host-ad-goal-summary"');
    expect(createRoute).toContain("optimization,\n      });");
  });

  it("SC-3 search works before any platform is ticked", () => {
    expect(createRoute).toContain("pick(connections) ?? pick(setup?.connections ?? [])");
    // #4238 D2: one start rule for fresh, restored and not-found drafts.
    expect(createRoute).toContain("initialHostAdConnections(setup.connections, null)");
  });
});
