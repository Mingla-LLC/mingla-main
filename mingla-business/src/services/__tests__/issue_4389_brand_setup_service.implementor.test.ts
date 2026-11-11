/**
 * #4389 — brand setup service (Host).
 * MINGLA-INVARIANT: I-4389-SETUP-DONE-IS-SERVER | issue #4389 | the Host picks the setup step only from brand_readiness(brand_setup); "done" is unreachable while any of the 4 items is open, whatever the deep link asks (SC-2).
 * FAILS-ON-REVERT: letting deriveSetupStep return the requested step
 * unconditionally fails "SC-2"; dropping the draft_exists branch in
 * createSetupBrand fails "N1".
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockRpc = jest.fn<(name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>();
const mockInvoke = jest.fn<(name: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>>();
const mockGetSession = jest.fn<() => Promise<{ data: { session: { access_token?: string | null } | null } }>>();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (name: string, params: Record<string, unknown>) => mockRpc(name, params),
    functions: { invoke: (name: string, opts: unknown) => mockInvoke(name, opts) },
    auth: { getSession: () => mockGetSession() },
  },
}));

import {
  createSetupBrand,
  deriveSetupStep,
  parseBrandSetupChecklist,
  setBrandPayoutCountry,
  slugForBrandName,
} from "../brandSetupService";
import { tapToPayBrandEligible } from "../../utils/tapToPayBrandEligible";
import { isAuthNotReadyError } from "../../utils/authReadyGate";
import { parseBrandReadiness } from "../brandReadinessService";

const BRAND = "43890000-0000-4000-b000-000000000001";

function item(key: string, state: string) {
  return {
    key, group: "money", label: key, state, value_preview: null, blocks_action: state !== "verified",
    deferrable: false, fix: { route: null, route_label: "Brand setup", can_caller_fix: true, who_can_fix: "you" },
  };
}

function checklist(states: [string, string][], setup: Record<string, unknown> = {}) {
  return parseBrandSetupChecklist({
    brand_id: BRAND, context_revision: null, evaluated_at: "2026-11-11T00:00:00Z", action: "brand_setup",
    can_proceed: states.every(([, s]) => s === "verified"),
    items: states.map(([k, s]) => item(k, s)),
    money: { can_sell: false, can_be_paid_out: false, sell_reason: "no_provider", payout_reason: "no_bank", rail: "none", currency: null },
    setup,
  }, parseBrandReadiness);
}

beforeEach(() => {
  mockRpc.mockReset();
  mockInvoke.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "jwt" } } });
});

describe("#4389 deriveSetupStep", () => {
  test("picks the first open item", () => {
    expect(deriveSetupStep(checklist([["brand.name", "verified"], ["money.market", "missing"], ["money.terms_member", "missing"], ["money.details_submitted", "missing"]]))).toBe("country");
    expect(deriveSetupStep(checklist([["brand.name", "verified"], ["money.market", "verified"], ["money.terms_member", "verified"], ["money.details_submitted", "missing"]]))).toBe("pay");
    expect(deriveSetupStep(null)).toBe("name");
  });

  test("SC-2: done is unreachable while anything is open, whatever the deep link says", () => {
    const open = checklist([["brand.name", "verified"], ["money.market", "verified"], ["money.terms_member", "missing"], ["money.details_submitted", "missing"]]);
    expect(deriveSetupStep(open, "done")).toBe("pay");
    expect(deriveSetupStep(open, "country")).toBe("country");
    const all = checklist([["brand.name", "verified"], ["money.market", "verified"], ["money.terms_member", "verified"], ["money.details_submitted", "verified"]]);
    expect(deriveSetupStep(all, "done")).toBe("done");
  });

  test("parses the server facts and counts done items", () => {
    const c = checklist([["brand.name", "verified"], ["money.market", "verified"], ["money.terms_member", "missing"], ["money.details_submitted", "missing"]],
      { provider: "paystack", is_draft: true, waiting_for: null, stripe_state: "none", payout_country: "NG" });
    expect(c.doneCount).toBe(2);
    expect(c.facts.provider).toBe("paystack");
    expect(c.facts.isDraft).toBe(true);
    expect(c.facts.payoutCountry).toBe("NG");
  });
});

describe("#4389 createSetupBrand (F1, R-1, N1)", () => {
  test("sends the client id; a retry is the same brand", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, brand_id: BRAND, created: false }, error: null });
    const r = await createSetupBrand({ brandId: BRAND, name: "Night Owl" });
    expect(r).toEqual({ brandId: BRAND, created: false });
    expect(mockRpc).toHaveBeenCalledWith("biz_create_setup_brand", expect.objectContaining({ p_brand_id: BRAND, p_slug: "night-owl" }));
  });

  test("N1: a brand already in setup comes back as draft_exists with that brand", async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, error: "draft_exists", brand_id: "other", brand_name: "Lantern Room" }, error: null });
    await expect(createSetupBrand({ brandId: BRAND, name: "Night Owl" })).rejects.toMatchObject({
      code: "draft_exists",
      detail: { brandId: "other", brandName: "Lantern Room" },
    });
  });

  test("a taken slug retries with a suffix, same id", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: { ok: false, error: "slug_taken" }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, brand_id: BRAND, created: true }, error: null });
    await createSetupBrand({ brandId: BRAND, name: "Night Owl" });
    expect(mockRpc.mock.calls[1][1]).toMatchObject({ p_brand_id: BRAND, p_slug: "night-owl-43890" });
  });

  test("slugs", () => {
    expect(slugForBrandName("Café Ünïcode  Club!")).toBe("cafe-unicode-club");
  });
});

describe("#4389 setBrandPayoutCountry (F2)", () => {
  test("one RPC; Nigeria then stamps the hold", async () => {
    mockRpc.mockResolvedValue({ data: { payout_country: "NG", default_currency: "NGN", payment_provider: "paystack" }, error: null });
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    const r = await setBrandPayoutCountry(BRAND, "NG");
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("brand-paystack-onboard", { body: { action: "select_provider", brand_id: BRAND } });
    expect(r.provider).toBe("paystack");
  });

  test("a locked country surfaces as payout_country_locked", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "payout_country_locked" } });
    await expect(setBrandPayoutCountry(BRAND, "GB")).rejects.toMatchObject({ code: "payout_country_locked" });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// META-ORCH-1232 C2 kept by #4389: the new setup writes (F1 create, F2 bank
// country) never go out before a real access token is attached; the cap
// elapsing throws AuthNotReadyError, which F1/F2 show as their own retryable
// message. FAILS-ON-REVERT: removing either awaitSessionAttached call in
// brandSetupService fails these.
describe("META-ORCH-1232 C2 — #4389 setup writes wait for an attached session", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("F1 create without a token never calls the RPC and throws AuthNotReadyError", async () => {
    jest.useFakeTimers();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const pending = createSetupBrand({ brandId: BRAND, name: "Lantern Room" });
    const settled = pending.then(() => null, (e: unknown) => e);
    await jest.advanceTimersByTimeAsync(6000);
    expect(isAuthNotReadyError(await settled)).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("F2 bank country without a token never calls the RPC and throws AuthNotReadyError", async () => {
    jest.useFakeTimers();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "" } } });
    const pending = setBrandPayoutCountry(BRAND, "GB");
    const settled = pending.then(() => null, (e: unknown) => e);
    await jest.advanceTimersByTimeAsync(6000);
    expect(isAuthNotReadyError(await settled)).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("a token attaching mid-wait lets the create go out once", async () => {
    jest.useFakeTimers();
    mockGetSession
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValue({ data: { session: { access_token: "jwt" } } });
    mockRpc.mockResolvedValue({ data: { ok: true, brand_id: BRAND, created: true }, error: null });
    const pending = createSetupBrand({ brandId: BRAND, name: "Lantern Room" });
    await jest.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toEqual({ brandId: BRAND, created: true });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

describe("#4389 D2 — Tap to Pay eligibility follows the bank country", () => {
  test("country decides; a USD brand banked elsewhere is not a US brand", () => {
    expect(tapToPayBrandEligible({ paymentProvider: "stripe", payoutCountry: "US", defaultCurrency: "USD" })).toBe(true);
    expect(tapToPayBrandEligible({ paymentProvider: "stripe", payoutCountry: "DE", defaultCurrency: "USD" })).toBe(false);
    expect(tapToPayBrandEligible({ paymentProvider: "stripe", payoutCountry: "GB", defaultCurrency: "GBP" })).toBe(true);
    expect(tapToPayBrandEligible({ paymentProvider: "paystack", payoutCountry: "NG" })).toBe(false);
  });
});
