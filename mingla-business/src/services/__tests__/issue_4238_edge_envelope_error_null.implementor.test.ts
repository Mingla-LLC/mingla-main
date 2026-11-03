/**
 * #4238 wave 2 rework — every Business ads service treated the mere presence
 * of an `error` key in a 200 body as a failure. Edge envelopes such as
 * admin-ad-creative-prepare always carry `error: null` when they succeed, so a
 * ready video aborted every Host launch. Each ads service now fails only on a
 * real error value, and still fails on a real one.
 */
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import { supabase } from "../supabase";
// eslint-disable-next-line import/first
import { searchHostAdTargeting } from "../hostAdPlanService";
// eslint-disable-next-line import/first
import { listHostAdCampaignPage } from "../hostAdCampaignService";
// eslint-disable-next-line import/first
import { getAdCreditWallet } from "../adCreditService";

const invokeMock = supabase.functions.invoke as jest.Mock;

function answer(data: unknown): void {
  invokeMock.mockResolvedValueOnce({ data, error: null });
}

const SEARCH = { brandId: "b1", platform: "meta" as const, kind: "city" as const, query: "Lagos" };

describe("#4238 ads services read `error: null` as success", () => {
  beforeEach(() => invokeMock.mockReset());

  it("hostAdPlanService passes an `error: null` envelope through", async () => {
    answer({ results: [{ id: "x" }], error: null });
    await expect(searchHostAdTargeting(SEARCH)).resolves.toEqual({ results: [{ id: "x" }], error: null });
  });

  it("hostAdPlanService still throws on a real error", async () => {
    answer({ error: "forbidden", detail: "nope" });
    await expect(searchHostAdTargeting(SEARCH)).rejects.toMatchObject({ code: "forbidden", detail: "nope" });
  });

  it("hostAdCampaignService passes an `error: null` envelope through", async () => {
    answer({ ok: true, campaigns: [], summary: null, error: null });
    await expect(listHostAdCampaignPage("b1")).resolves.toEqual({ campaigns: [], summary: null });
  });

  it("hostAdCampaignService still throws on a real error", async () => {
    answer({ error: "forbidden" });
    await expect(listHostAdCampaignPage("b1")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("adCreditService passes an `error: null` envelope through", async () => {
    answer({ ok: true, wallet: null, error: null });
    await expect(getAdCreditWallet("b1")).resolves.toEqual({ ok: true, wallet: null, error: null });
  });

  it("adCreditService still throws on a real error", async () => {
    answer({ error: "forbidden" });
    await expect(getAdCreditWallet("b1")).rejects.toMatchObject({ code: "forbidden" });
  });
});
