/**
 * #4238 — fixes from the tester's FAIL verdict (server side).
 *
 * D4: sales readiness is read once per account for 10 minutes (call count).
 * D6: a Host never sees a provider's own search error text.
 * Extra B: a Host create body may not choose bidding, promotion type or
 * TikTok placement. Extra C: only live accounts bind to a Host plan.
 * D3: Ari's ad card shows money in the brand currency and plain words.
 *
 * Fails on revert: removing the readiness cache makes the probe count 3, not
 * 1; returning provider text to Hosts leaks SNAPCHAT_AD_ACCOUNT_ID; dropping
 * the delivery-field list lets bid_strategy through.
 */

import "../adChannel.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  AdApiError,
  type AdConnectionRow,
  AdNotConnectedError,
  HOST_SEARCH_UNAVAILABLE,
  hostSafeSearchWarning,
} from "../adChannelCore.ts";
import {
  cachedSalesReadiness,
  clearSalesReadinessCache,
  SALES_READINESS_TTL_MS,
  type SalesSignalProbes,
} from "../adSalesReadiness.ts";
import { hostAllocationLaneError, hostGoalBodyError } from "../adHostGoal.ts";
import { preflightMoneyProposal } from "../agentDomainTools.ts";

const META = {
  id: "meta-1",
  platform: "meta",
  lane: "consumer",
  extra: { dataset_id: "d" },
} as unknown as AdConnectionRow;

Deno.test("D4 #4238 sales readiness is read once per account for 10 minutes", async () => {
  clearSalesReadinessCache();
  let calls = 0;
  const probes: SalesSignalProbes = {
    metaHasSignal: () => {
      calls += 1;
      return Promise.resolve(true);
    },
    snapchatPurchases28d: () => Promise.resolve(0),
    tiktokPurchases28d: () => Promise.resolve(0),
  };
  const t0 = 1_000_000;
  await cachedSalesReadiness(META, { probes, now: t0 });
  await cachedSalesReadiness(META, { probes, now: t0 + 1000 });
  await cachedSalesReadiness(META, {
    probes,
    now: t0 + SALES_READINESS_TTL_MS - 1,
  });
  assertEquals(calls, 1);
  await cachedSalesReadiness(META, {
    probes,
    now: t0 + SALES_READINESS_TTL_MS + 1,
  });
  assertEquals(calls, 2);
  clearSalesReadinessCache();
});

Deno.test("D4 #4238 a failed read is retried after a minute, not ten", async () => {
  clearSalesReadinessCache();
  let calls = 0;
  const probes: SalesSignalProbes = {
    metaHasSignal: () => {
      calls += 1;
      return Promise.reject(new Error("down"));
    },
    snapchatPurchases28d: () => Promise.resolve(0),
    tiktokPurchases28d: () => Promise.resolve(0),
  };
  const t0 = 5_000_000;
  const first = await cachedSalesReadiness(META, { probes, now: t0 });
  assertEquals(first, { ready: false, reason: "unknown" });
  await cachedSalesReadiness(META, { probes, now: t0 + 30_000 });
  assertEquals(calls, 1);
  await cachedSalesReadiness(META, { probes, now: t0 + 61_000 });
  assertEquals(calls, 2);
  clearSalesReadinessCache();
});

Deno.test("D4 #4238 host_setup uses the cached readiness", async () => {
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  assert(plan.includes("cachedSalesReadiness(row)"));
  // No uncached live read remains in host_setup.
  assert(!/[^d]salesReadiness\(row\)/.test(plan));
});

Deno.test("D6 #4238 Hosts never see provider error text, logs keep it", () => {
  const logged: Record<string, unknown>[] = [];
  const leak = new AdApiError({
    platform: "snapchat",
    code: "account_mismatch",
    message:
      "SNAPCHAT_AD_ACCOUNT_ID (1111) does not match the persisted connection's ad account (2222)",
  });
  const warning = hostSafeSearchWarning(leak, (_m, detail) => {
    logged.push(detail);
  });
  assertEquals(warning, HOST_SEARCH_UNAVAILABLE);
  assert(!warning.includes("SNAPCHAT_AD_ACCOUNT_ID"));
  assert(!/\d{4}/.test(warning));
  assertEquals(logged[0].code, "account_mismatch");
  assert(String(logged[0].message).includes("SNAPCHAT_AD_ACCOUNT_ID"));
  assertEquals(
    hostSafeSearchWarning(new AdNotConnectedError("meta"), () => {}),
    HOST_SEARCH_UNAVAILABLE,
  );
  assertEquals(
    hostSafeSearchWarning(
      new Error("META_SYSTEM_USER_TOKEN missing"),
      () => {},
    ),
    HOST_SEARCH_UNAVAILABLE,
  );
});

Deno.test("D6 #4238 targeting search maps every Host failure to the safe warning", async () => {
  const search = await Deno.readTextFile(
    new URL("../../admin-ad-targeting-search/index.ts", import.meta.url),
  );
  const failOpen = search.slice(
    search.indexOf("function failOpen("),
    search.indexOf("async function resolveMeta("),
  );
  // #4238 media-buyer: the Host branch also flags the app as unavailable.
  const hostBranch = failOpen.indexOf("warning: hostSafeSearchWarning(err),");
  const providerText = failOpen.indexOf("? err.message");
  assert(hostBranch > 0 && providerText > hostBranch);
});

Deno.test("Extra B #4238 a Host may not choose bidding, promotion type or TikTok placement", () => {
  for (
    const field of ["bid_strategy", "promotion_type", "tiktok_placement"]
  ) {
    assertEquals(
      hostGoalBodyError({ platform: "tiktok", [field]: "x" }),
      "host_delivery_field_forbidden",
    );
  }
  assertEquals(
    hostGoalBodyError({ objective: "OUTCOME_SALES" }),
    "plan_optimization_mismatch",
  );
  assertEquals(hostGoalBodyError({ platform: "meta", name: "x" }), null);
});

Deno.test("#4238 retest 2: a Host may not set manual bids inside budget", () => {
  for (
    const field of [
      "bid_type",
      "bid_price_cents",
      "cpc_bid_cents",
      "bid_cents",
      "level",
      "spend_cap_cents",
    ]
  ) {
    for (const value of ["BID_TYPE_CUSTOM", 150, null, 0, "", false]) {
      assertEquals(
        hostGoalBodyError({
          platform: "tiktok",
          budget: { type: "daily", amount_cents: 1000, [field]: value },
        }),
        "host_delivery_field_forbidden",
        `budget.${field}=${JSON.stringify(value)} accepted`,
      );
    }
  }
  assertEquals(
    hostGoalBodyError({
      platform: "tiktok",
      budget: { type: "daily", amount_cents: 1000, cap_cents: 5000 },
    }),
    null,
  );
});

Deno.test("Extra C #4238 only a live account binds to a Host plan", () => {
  const requested = [{ platform: "meta", connection_id: "c1" }];
  const row = {
    id: "c1",
    platform: "meta",
    lane: "consumer",
    connected: true,
    status: "connected",
  };
  assertEquals(hostAllocationLaneError([row], requested), null);
  assertEquals(
    hostAllocationLaneError([{ ...row, connected: false }], requested),
    "host_connection_lane_invalid",
  );
  assertEquals(
    hostAllocationLaneError([{ ...row, status: "invalid" }], requested),
    "host_connection_lane_invalid",
  );
});

const BRAND = "11111111-1111-4111-8111-111111111111";

Deno.test("D3 #4238 Ari's ad card shows money in the brand currency and plain words", async () => {
  const client = {
    functions: {
      invoke: (name: string, request: { body: Record<string, unknown> }) =>
        Promise.resolve(
          name === "ad-plan" && request.body.action === "host_setup"
            ? { data: { currency: "NGN" }, error: null }
            : { data: null, error: null },
        ),
    },
  };
  const context = await preflightMoneyProposal(
    "propose_ad_plan",
    {
      brand_id: BRAND,
      name: "Deserted Island",
      dest_page_type: "event",
      dest_brand_slug: "femzy",
      dest_entity_slug: "deserted-island",
      platforms: ["meta"],
      budget_cents: 75_000_000,
      countries: ["NG", "GH"],
      gender: "all",
      rights_basis: "owned",
      ai_generated: false,
    },
    client,
  );
  assert(context);
  assertEquals(context.currency, "NGN");
  assertEquals(
    context.ad_provider_allocation,
    "Facebook & Instagram: NGN 750,000.00 · split evenly across the apps",
  );
  assertEquals(context.ad_destination, "Event: Deserted Island");
  assert(String(context.ad_audience).startsWith("Nigeria, Ghana"));
  assert(String(context.ad_audience).includes("all genders"));
  assert(String(context.ad_media_rights).startsWith("You own this video"));
});

Deno.test("#4238 retest 3: the Host client and Ari never send budget level or spend cap", async () => {
  const service = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/services/hostAdPlanService.ts",
      import.meta.url,
    ),
  );
  const ari = await Deno.readTextFile(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  for (const source of [service, ari]) {
    assert(!source.includes("spend_cap_cents"));
    assert(!/\blevel:/.test(source));
  }
});
