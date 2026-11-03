/**
 * #4238 wave 2 rework (tester retest 3):
 * 1. A non-2xx edge answer never carries the SDK's own text ("Edge Function
 *    returned a non-2xx status code") as detail, and hostAdErrorMessage never
 *    shows technical text or a raw unknown code.
 * 2. A 2xx body throws only on a non-empty error STRING; an error object
 *    beside `state: "failed"` reaches the prepare retry, which runs once.
 * 3. A draft whose plan already has a campaign or was launched is hidden.
 * 4. The detail header writes app spend as "USD 137.00".
 */
import fs from "node:fs";
import path from "node:path";

jest.mock("../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import { supabase } from "../supabase";
// eslint-disable-next-line import/first
import {
  HostAdPlanError,
  launchHostAdPlan,
  listHostAdWorkspace,
  searchHostAdTargeting,
  type HostAdDraft,
} from "../hostAdPlanService";
// eslint-disable-next-line import/first
import { listHostAdCampaignPage, type HostAdCampaign } from "../hostAdCampaignService";
// eslint-disable-next-line import/first
import { getAdCreditWallet } from "../adCreditService";
// eslint-disable-next-line import/first
import { buildHostAdList } from "../hostAdLifecycle";
// eslint-disable-next-line import/first
import { hostAdErrorMessage } from "../../components/marketing/ads/hostAdCopy";

const invokeMock = supabase.functions.invoke as jest.Mock;
const SDK_TEXT = "Edge Function returned a non-2xx status code";
const FALLBACK = "That didn't work just now. Try again in a minute, or contact Mingla support if it keeps happening.";
const SEARCH = { brandId: "b1", platform: "meta" as const, kind: "city" as const, query: "Lagos" };

function httpError(body: Record<string, unknown>) {
  return Object.assign(new Error(SDK_TEXT), {
    name: "FunctionsHttpError",
    context: { status: 503, json: async () => body },
  });
}

describe("#4238 non-2xx answers never carry SDK text", () => {
  beforeEach(() => invokeMock.mockReset());

  it("hostAdPlanService falls back to the server code", async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: httpError({ error: "connection_lookup_failed", trace_id: "t" }) });
    const caught = await searchHostAdTargeting(SEARCH).catch((cause: unknown) => cause);
    expect(caught).toBeInstanceOf(HostAdPlanError);
    expect(caught).toMatchObject({ code: "connection_lookup_failed", detail: "connection_lookup_failed" });
    expect((caught as Error).message).not.toContain("non-2xx");
  });

  it("hostAdPlanService uses request_failed when the body is unreadable", async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: new Error(SDK_TEXT) });
    await expect(searchHostAdTargeting(SEARCH)).rejects.toMatchObject({ code: "network", detail: "request_failed" });
  });

  it("hostAdCampaignService and adCreditService do the same", async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: httpError({ error: "plan_lookup_failed" }) });
    const campaign = await listHostAdCampaignPage("b1").catch((cause: unknown) => cause);
    expect((campaign as Error).message).toBe("plan_lookup_failed");
    invokeMock.mockResolvedValueOnce({ data: null, error: httpError({ error: "audit_write_failed" }) });
    const credit = await getAdCreditWallet("b1").catch((cause: unknown) => cause);
    expect((credit as Error).message).toBe("audit_write_failed");
  });
});

describe("#4238 hostAdErrorMessage never passes technical text", () => {
  it.each(["connection_lookup_failed", "plan_lookup_failed", "audit_write_failed"])(
    "unknown code %s with the SDK message reads as plain copy",
    (code) => {
      expect(hostAdErrorMessage(new HostAdPlanError(code, SDK_TEXT))).toBe(FALLBACK);
      expect(hostAdErrorMessage(new HostAdPlanError(code, code))).toBe(FALLBACK);
    },
  );

  it("keeps a sentence the app owns", () => {
    expect(
      hostAdErrorMessage(new HostAdPlanError("x", "Set aside the money for this ad before you start it.")),
    ).toBe("Set aside the money for this ad before you start it.");
  });
});

describe("#4238 a 2xx error object is not a failed request", () => {
  beforeEach(() => invokeMock.mockReset());

  it("every ads service passes an error object through", async () => {
    const body = { state: "failed", error: { code: "provider_terminal", message: "m" } };
    invokeMock.mockResolvedValue({ data: body, error: null });
    await expect(searchHostAdTargeting(SEARCH)).resolves.toEqual(body);
    await expect(getAdCreditWallet("b1")).resolves.toEqual(body);
    invokeMock.mockResolvedValue({ data: { ...body, campaigns: [], summary: null }, error: null });
    await expect(listHostAdCampaignPage("b1")).resolves.toEqual({ campaigns: [], summary: null });
  });

  it("an empty error string is not a failure; a real code still is", async () => {
    invokeMock.mockResolvedValueOnce({ data: { results: [], error: "" }, error: null });
    await expect(searchHostAdTargeting(SEARCH)).resolves.toEqual({ results: [], error: "" });
    invokeMock.mockResolvedValueOnce({ data: { error: "forbidden" }, error: null });
    await expect(searchHostAdTargeting(SEARCH)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a failed video is retried exactly once, then the Host reads video copy", async () => {
    const HASH = "e".repeat(64);
    const aggregate = {
      ok: true,
      plan: { id: "p1", brand_id: "b1", state: "staff_approved", current_version_id: "v1" },
      version: { id: "v1", plan_hash: HASH, canonical_plan: { creative_library_id: "c1" } },
      funding_hold: { state: "held" },
      provider_allocations: [{ platform: "meta", host_budget_cents: 100, provider_budget_cents: 100 }],
      targeting_snapshots: [],
    };
    const failed = {
      state: "failed",
      retry_after_seconds: 1,
      error: { code: "provider_terminal", message: "The platform could not process this video." },
    };
    const actions: unknown[] = [];
    invokeMock.mockImplementation(async (name: string, { body }: { body: Record<string, unknown> }) => {
      if (name === "ad-plan" && body.action === "get") return { data: aggregate, error: null };
      if (name === "admin-ad-creative-prepare") {
        actions.push(body.action);
        return { data: failed, error: null };
      }
      return { data: { ok: true }, error: null };
    });
    const copy = await launchHostAdPlan({ planId: "p1", versionId: "v1", planHash: HASH })
      .then(() => "(launched)")
      .catch((cause: unknown) => hostAdErrorMessage(cause, "The campaign could not launch."));
    expect(actions.filter((action) => action === "retry")).toHaveLength(1);
    expect(copy).toMatch(/video/i);
    expect(copy).not.toMatch(/[{}_]/);
  });
});

const DRAFT_BASE: HostAdDraft = {
  id: "d1",
  client_kind: "host",
  owner_kind: "host",
  brand_id: "b1",
  plan_id: null,
  revision: 1,
  current_step: "review",
  draft_state: { name: "Deserted Island — past guests" },
  updated_at: "2026-11-02T10:00:00Z",
};

const CAMPAIGN: HostAdCampaign = {
  id: "c1",
  name: "Deserted Island — past guests",
  status: "ACTIVE",
  platform: "meta",
  daily_budget_cents: null,
  lifetime_budget_cents: null,
  cap_cents: 100,
  currency: "NGN",
  starts_at: null,
  ends_at: null,
  dest_page_type: "event",
  dest_url: null,
  brand_id: "b1",
  owner_kind: "host",
  created_at: "2026-11-02T11:00:00Z",
  updated_at: "2026-11-02T11:00:00Z",
  plan_version_id: "v-campaign",
  plan_state: "live",
  lifecycle: "live",
  next_action: "View results",
  campaign_ids: ["c1"],
  platforms: ["meta"],
  destination: { page_type: "event", url: null },
  host_spend_equivalent_cents: 0,
  spend_by_currency: [],
  primary_result_label: "ticket sales",
  primary_result_count: 0,
  cost_per_result_cents: null,
  impressions: 0,
  clicks: 0,
  creative: null,
};

describe("#4238 finished drafts leave the Ads list", () => {
  it("hides a draft whose plan already has a campaign", () => {
    const items = buildHostAdList({
      drafts: [{ ...DRAFT_BASE, plan_id: "p-campaign" }, { ...DRAFT_BASE, id: "d-open", plan_id: "p-open" }],
      plans: [],
      campaigns: [CAMPAIGN],
      planIdByVersionId: { "v-campaign": "p-campaign" },
    });
    expect(items.filter((item) => item.kind === "draft").map((item) => item.id)).toEqual(["d-open"]);
  });

  it("hides a draft whose plan is live or ended", () => {
    const items = buildHostAdList({
      drafts: [
        { ...DRAFT_BASE, id: "d-live", plan_id: "p-live" },
        { ...DRAFT_BASE, id: "d-new", plan_id: null },
      ],
      plans: [],
      campaigns: [],
      launchedPlanIds: ["p-live"],
    });
    expect(items.map((item) => item.id)).toEqual(["d-new"]);
  });

  it("the workspace names launched plans and maps versions to plans", async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce({
      data: {
        ok: true,
        plans: [
          { id: "p-live", state: "live", current_version_id: "v-live" },
          { id: "p-ended", state: "ended", current_version_id: "v-ended" },
          { id: "p-cancel", state: "cancelled_before_create", current_version_id: "v-cancel" },
        ],
        drafts: [],
      },
      error: null,
    });
    const workspace = await listHostAdWorkspace("b1");
    expect(workspace.launchedPlanIds).toEqual(["p-live", "p-ended"]);
    expect(workspace.planIdByVersionId).toEqual({
      "v-live": "p-live",
      "v-ended": "p-ended",
      "v-cancel": "p-cancel",
    });
  });

  it("the Ads list page passes both to buildHostAdList", () => {
    const route = fs.readFileSync(path.resolve(__dirname, "../../../app/(tabs)/marketing/ads/index.tsx"), "utf8");
    expect(route).toMatch(/buildHostAdList\(\{[^}]*launchedPlanIds,[^}]*planIdByVersionId,/);
  });
});

describe("#4238 detail header app spend uses the Results money style", () => {
  it("formats provider spend with formatHostAdMoneyCents", () => {
    const detail = fs.readFileSync(path.resolve(__dirname, "../../../app/(tabs)/marketing/ads/[id].tsx"), "utf8");
    const block = detail.slice(detail.indexOf("What the apps say they spent"), detail.indexOf(".join(\" · \")", detail.indexOf("What the apps say they spent")));
    expect(block).toContain("formatHostAdMoneyCents(");
    expect(block).not.toContain("formatCurrency(");
  });
});
