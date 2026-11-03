/**
 * #4238 wave 2 — two Host-facing fixes:
 * 1. An Ads list row read "₦0.00 cap · $137.00": symbols, a zero cap, and
 *    the word "cap". It now uses the Results card's "NGN 1,000.00" style and
 *    hides a zero or missing budget.
 * 2. After the app already retried a failed video once, the Host read the
 *    server's "Retry this platform.". The Host now reads plain copy that
 *    does not ask them to repeat what the app did.
 */
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import { supabase } from "../supabase";
// eslint-disable-next-line import/first
import { launchHostAdPlan } from "../hostAdPlanService";
// eslint-disable-next-line import/first
import { hostAdListRowMoney } from "../hostAdLifecycle";
// eslint-disable-next-line import/first
import { hostAdErrorMessage } from "../../components/marketing/ads/hostAdCopy";

describe("#4238 Ads list row money", () => {
  const base = { currency: "NGN", capCents: null, spendCents: null, spendByCurrency: [] };

  it("never shows a zero cap beside the apps' own spend", () => {
    const line = hostAdListRowMoney({
      ...base,
      capCents: 0,
      spendByCurrency: [{ currency: "USD", spend_cents: 13_700 }],
    });
    expect(line).toBe("USD 137.00 spent on the apps");
    expect(line).not.toMatch(/₦|\$|0\.00 cap|\bcap\b/);
  });

  it("writes Host-currency spend against the budget in code style", () => {
    expect(
      hostAdListRowMoney({ ...base, capCents: 10_000_000, spendCents: 4_200_000 }),
    ).toBe("NGN 42,000.00 of NGN 100,000.00 spent");
  });

  it("drops the budget part when there is no budget", () => {
    expect(hostAdListRowMoney({ ...base, capCents: 0, spendCents: 4_200_000 })).toBe(
      "NGN 42,000.00 spent",
    );
  });

  it("shows the budget alone when spend is not in Host currency yet", () => {
    expect(
      hostAdListRowMoney({
        ...base,
        capCents: 10_000_000,
        spendByCurrency: [{ currency: "USD", spend_cents: 13_700 }],
      }),
    ).toBe("NGN 100,000.00 budget · USD 137.00 spent on the apps");
  });

  it("falls back to plain words when nothing is known", () => {
    expect(hostAdListRowMoney({ ...base, currency: null })).toBe("Budget set before launch");
  });
});

describe("#4238 video copy after the automatic retry", () => {
  const HASH = "e".repeat(64);
  const AGGREGATE = {
    ok: true,
    plan: { id: "p1", brand_id: "b1", state: "staff_approved", current_version_id: "v1" },
    version: {
      id: "v1",
      plan_hash: HASH,
      canonical_plan: {
        name: "Deserted Island",
        destination: { ok: true, page_type: "event", brand_slug: "femzy", entity_slug: "deserted-island", title: "Deserted Island" },
        creative_library_id: "a4238000-0000-4000-8000-000000000001",
        copy: { primary: "Three days off-grid.", headline: "Deserted Island" },
      },
    },
    funding_hold: { state: "held" },
    provider_allocations: [
      { platform: "meta", host_budget_cents: 150_000_000, provider_budget_cents: 96_774 },
    ],
    targeting_snapshots: [
      { platform: "meta", audience_intent: { countries: ["NG"] }, compiled_targeting: { geo_locations: { countries: ["NG"] } } },
    ],
  };
  const FAILED = {
    state: "failed",
    retry_after_seconds: null,
    error: {
      code: "provider_terminal",
      message: "The platform could not process this video. Retry this platform.",
    },
  };

  it("never tells the Host to retry what the app already retried", async () => {
    jest.useFakeTimers();
    const actions: unknown[] = [];
    (supabase.functions.invoke as jest.Mock).mockImplementation(
      async (name: string, { body }: { body: Record<string, unknown> }) => {
        if (name === "ad-plan" && body.action === "get") return { data: AGGREGATE, error: null };
        if (name === "ad-plan") return { data: { ok: true }, error: null };
        if (name === "admin-ad-creative-prepare") {
          actions.push(body.action);
          return { data: FAILED, error: null };
        }
        return { data: { ok: true }, error: null };
      },
    );
    let copy = "(launched)";
    const run = launchHostAdPlan({ planId: "p1", versionId: "v1", planHash: HASH }).catch(
      (cause: unknown) => {
        copy = hostAdErrorMessage(cause, "The campaign could not launch.");
      },
    );
    await jest.runAllTimersAsync();
    await run;
    jest.useRealTimers();
    expect(actions).toContain("retry");
    expect(copy).toBe("Facebook & Instagram couldn't use this video. Try a different video.");
    expect(copy).not.toMatch(/retry this platform/i);
  });
});
