/**
 * #4238 W3 (amendment A Part 1 + Part 3) — every current builder capability
 * survives the new contracts (SC-K), duplicate asks for rights and the wider
 * area again (K-7), and the In review / visits-fallback lines are true
 * (U-3, U-4).
 */

const mockInvoke = jest.fn();
jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

// eslint-disable-next-line import/first
import {
  hostAdDraftFromPlan,
  prepareHostAdPlan,
  type HostAdConnection,
  type HostAdPage,
} from "../../../../services/hostAdPlanService";
// eslint-disable-next-line import/first
import { hostAdInReviewCopy, hostAdVisitsFallbackCopy } from "../hostAdCopy";

const page: HostAdPage = {
  page_type: "event",
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
  result_kind: "tickets",
} as HostAdPage;
const connection = (platform: HostAdConnection["platform"]): HostAdConnection => ({
  id: `${platform}-id`,
  platform,
  currency: "USD",
  status: "connected",
  connected: true,
  sales: { ready: true, reason: "ready" },
} as HostAdConnection);

function mockServer(): void {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((name: string, request: { body: Record<string, unknown> }) => {
    const action = request.body.action;
    if (name === "ad-plan" && action === "open") {
      return Promise.resolve({ data: { plan: { id: "plan-1" } }, error: null });
    }
    if (name === "ad-plan" && action === "create_version") {
      return Promise.resolve({
        data: { version: { id: "v-1", plan_hash: "a".repeat(64), canonical_plan: {} } },
        error: null,
      });
    }
    if (name === "ad-plan" && action === "freeze_targeting") {
      return Promise.resolve({ data: { targeting_snapshots: [] }, error: null });
    }
    return Promise.resolve({ data: { ok: true }, error: null });
  });
}

describe("#4238 SC-K: every K option reaches the canonical plan", () => {
  it("snapshots the canonical keys a fully-set plan sends", async () => {
    mockServer();
    await prepareHostAdPlan({
      brandId: "11111111-1111-4111-8111-111111111111",
      page,
      connections: [connection("meta"), connection("tiktok")],
      creative: { id: "creative-1" } as never,
      creativeIds: ["creative-1", "creative-2"],
      occurrenceKey: "2026-12-01",
      appChoice: "mingla",
      audienceChoice: "host",
      optimizationGoal: "sales",
      acknowledgedVisitsFallback: ["tiktok"],
      name: "Deserted Island",
      primaryText: "Three days off-grid.",
      headline: "Deserted Island",
      countries: ["NG"],
      cities: [],
      radiusKm: null,
      interests: [],
      excludedPlaces: [],
      languages: ["en"],
      ageMin: 21,
      ageMax: 45,
      gender: "women",
      dailyBudgetCents: 3000,
      capCents: 21000,
      startsAt: "2026-11-20T09:00:00Z",
      endsAt: "2026-11-30T09:00:00Z",
      acceptBroader: true,
      rightsConfirmed: true,
      rightsBasis: "owned",
      aiGenerated: false,
      optimization: "sales",
      audienceKeys: [],
      excludePastBuyers: true,
      cta: "tickets",
      budgetMode: "total",
    });
    const call = mockInvoke.mock.calls.find(
      ([name, request]) => name === "ad-plan" && request.body.action === "create_version",
    );
    const canonical = call?.[1].body.canonical_plan as Record<string, unknown>;
    // Fails if any K capability (or a W3 choice) is dropped on the way.
    expect(Object.keys(canonical).sort()).toEqual([
      "acknowledged_visits_fallback",
      "app_choice",
      "audience_choice",
      "audience_intent",
      "audience_selection",
      "broader_acceptance",
      "budget_mode",
      "call_to_action",
      "confirmation_phrase",
      "copy",
      "creative_library_id",
      "creative_library_ids",
      "creative_url",
      "media_rights",
      "name",
      "occurrence_key",
      "optimization_by_platform",
      "optimization_goal",
      "schedule",
      "special_ad_category",
      "targeting_selection",
    ]);
    expect(canonical.creative_library_ids).toEqual(["creative-1", "creative-2"]);
    expect(canonical.schedule).toEqual({
      starts_at: "2026-11-20T09:00:00Z",
      ends_at: "2026-11-30T09:00:00Z",
    });
    expect(canonical.audience_selection).toEqual({
      include_keys: [],
      exclude_keys: ["brand:11111111-1111-4111-8111-111111111111:guests"],
    });
    expect(canonical.broader_acceptance).toEqual({ meta: true, tiktok: true });
  });
});

describe("#4238 K-7: Promote again", () => {
  const aggregate = (canonical: Record<string, unknown>) => ({
    plan: { id: "plan-1", brand_id: "b" },
    version: { id: "v", plan_hash: "h", canonical_plan: canonical },
    provider_allocations: [
      { platform: "meta", connection_id: "meta-id", host_budget_cents: 7000 },
    ],
  }) as never;

  it("copies the creatives, date and choices; asks for rights and the wider area again", () => {
    const draft = hostAdDraftFromPlan(aggregate({
      name: "Night",
      creative_library_id: "c1",
      creative_library_ids: ["c1", "c2", "c3"],
      occurrence_key: "2026-12-01",
      app_choice: "mingla",
      audience_choice: "host",
      optimization_by_platform: { meta: "signups" },
      media_rights: { rights_confirmed: true, rights_basis: "licensed", ai_generated: true },
      broader_acceptance: { meta: true },
      audience_selection: { include_keys: ["brand:b:contacts"] },
      budget_mode: "total",
    }));
    expect(draft.creative_ids).toEqual(["c1", "c2", "c3"]);
    expect(draft.occurrence_key).toBe("2026-12-01");
    expect(draft.app_choice).toBe("mingla");
    expect(draft.optimization).toBe("signups");
    expect(draft.rights_confirmed).toBe(false);
    expect(draft.accept_broader).toBe(false);
    expect(draft.rights_basis).toBe("licensed");
    expect(draft.ai_generated).toBe(true);
    expect(draft.audience_keys).toEqual(["brand:b:contacts"]);
  });

  it("a Mingla-chosen audience (a possible past-guest seed) is never copied as the Host's pick", () => {
    const draft = hostAdDraftFromPlan(aggregate({
      audience_choice: "mingla",
      audience_selection: { include_keys: ["brand:b:guests_lookalike"] },
    }));
    expect(draft.audience_keys).toEqual([]);
    expect(draft.audience_choice).toBe("mingla");
  });
});

describe("#4238 U-3 / U-4 copy", () => {
  it("In review is true for both branches", () => {
    expect(hostAdInReviewCopy(true)).toBe(
      "Mingla checks your first 3 ads, then the apps check them. Nothing is spent until they're approved.",
    );
    expect(hostAdInReviewCopy(false)).toBe(
      "The apps check every new ad before it runs. Nothing is spent until it's approved.",
    );
    expect(hostAdInReviewCopy(undefined)).toBe(hostAdInReviewCopy(false));
  });
  it("names the visits fallback per app", () => {
    expect(hostAdVisitsFallbackCopy("TikTok", "sales")).toBe(
      "TikTok will get page visits, not ticket sales, until its sales signal is ready",
    );
  });
});
