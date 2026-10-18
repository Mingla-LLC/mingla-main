import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AdConnectionRow } from "../adChannelCore.ts";
import {
  buildRedditAudienceEstimateBody,
  buildSnapAudienceSizeBody,
  buildTikTokAudienceEstimateBody,
  type EstimateInput,
  fetchProviderAudienceEstimate,
  parseMetaAudienceEstimate,
  parseRedditAudienceEstimate,
  parseSnapAudienceEstimate,
  parseTikTokAudienceEstimate,
  type ProviderEstimateTransports,
} from "../adProviderEstimate.ts";

function connection(
  platform: AdConnectionRow["platform"],
  certified = false,
): AdConnectionRow {
  return {
    id: "00000000-0000-4000-8000-000000003697",
    platform,
    lane: "business",
    display_name: platform,
    external_account_id: platform === "snapchat"
      ? "00000000-0000-4000-8000-000000003697"
      : "123456789",
    external_org_id: null,
    auth_kind: "refresh_token",
    token_env_var: "TEST_TOKEN",
    extra: certified ? { audience_estimate_certified: true } : {},
    status: "connected",
    currency: "NGN",
    timezone: "Africa/Lagos",
    min_daily_budget_cents: null,
    account_status: "ACTIVE",
    token_last_verified_at: null,
    connected: true,
  };
}

function input(
  platform: EstimateInput["platform"],
  certified = false,
): EstimateInput {
  return {
    platform,
    verdict: "exact",
    compiledTargeting: platform === "meta"
      ? { geo_locations: { countries: ["NG"] } }
      : platform === "tiktok"
      ? { location_ids: ["5661"], gender: "GENDER_UNLIMITED" }
      : { country_codes: ["NG"], gender: "all" },
    connection: connection(platform, certified),
    providerBudgetCents: 3_000,
  };
}

const neverCall: ProviderEstimateTransports = {
  meta: async () => {
    throw new Error("unexpected Meta call");
  },
  tiktok: async () => {
    throw new Error("unexpected TikTok call");
  },
  snapchat: async () => {
    throw new Error("unexpected Snap call");
  },
  reddit: async () => {
    throw new Error("unexpected Reddit call");
  },
};

Deno.test("v1.4 provider estimates normalize native bounds without an aggregate total", () => {
  const rows = [
    parseMetaAudienceEstimate({ users: 12_000, estimate_ready: true }),
    parseSnapAudienceEstimate({
      audience_size: {
        audience_size_minimum: 9_000,
        audience_size_maximum: 15_000,
      },
    }),
    parseTikTokAudienceEstimate({
      audience_size: { lower_bound: 8_000, upper_bound: 14_000 },
    }),
    parseRedditAudienceEstimate({
      data: { target_audience_range: { min: 7_000, max: 13_000 } },
    }),
  ];
  assertEquals(rows.map((row) => row.state), [
    "available",
    "available",
    "available",
    "available",
  ]);
  assert(rows.every((row) => row.non_additive === true));
  for (const row of rows) {
    assertFalse("total" in row);
    assertFalse("combined" in row);
    assertFalse("cross_platform_total" in row);
  }
});

Deno.test("v1.4 estimate reads fail closed before any uncertified provider call", async () => {
  for (const platform of ["meta", "tiktok", "snapchat", "reddit"] as const) {
    const result = await fetchProviderAudienceEstimate(
      input(platform),
      neverCall,
    );
    assertEquals(result.state, "certification_required");
    assertEquals(result.lower_bound, null);
  }
  const unavailableInput = input("meta", true);
  unavailableInput.verdict = "check_required";
  assertEquals(
    (await fetchProviderAudienceEstimate(unavailableInput, neverCall)).state,
    "targeting_unavailable",
  );
});

Deno.test("Google reach forecasting stays allowlist-gated even on a certified connection", async () => {
  const result = await fetchProviderAudienceEstimate(
    input("google", true),
    neverCall,
  );
  assertEquals(result.state, "allowlist_required");
  assertEquals(result.source, "google:ReachPlanService.GenerateReachForecast");
});

Deno.test("certified provider reads use only the selected transport and scrub failures", async () => {
  let calls = 0;
  const transports: ProviderEstimateTransports = {
    ...neverCall,
    meta: async () => {
      calls += 1;
      return { users: 42_000, estimate_ready: true };
    },
  };
  const result = await fetchProviderAudienceEstimate(
    input("meta", true),
    transports,
  );
  assertEquals(calls, 1);
  assertEquals(result.lower_bound, 42_000);

  transports.meta = async () => {
    throw new Error("EAA-secret-should-not-surface");
  };
  const failed = await fetchProviderAudienceEstimate(
    input("meta", true),
    transports,
  );
  assertEquals(failed.detail, "provider_estimate_request_failed");
  assertFalse(JSON.stringify(failed).includes("EAA-secret"));
});

Deno.test("provider request builders do not let account currency change targeting", () => {
  const redditNgn = input("reddit", true);
  const redditUsd = {
    ...redditNgn,
    connection: { ...redditNgn.connection, currency: "USD" },
  };
  assertEquals(
    buildRedditAudienceEstimateBody(redditNgn),
    buildRedditAudienceEstimateBody(redditUsd),
  );
  assertEquals(
    buildSnapAudienceSizeBody(input("snapchat", true)),
    buildSnapAudienceSizeBody({
      ...input("snapchat", true),
      connection: { ...input("snapchat", true).connection, currency: "USD" },
    }),
  );
  const snapBody = buildSnapAudienceSizeBody(input("snapchat", true));
  assertEquals(
    (snapBody.ad_squad.targeting as Record<string, unknown>).geos,
    [{ country_code: "ng" }],
  );
  assertEquals(
    (snapBody.ad_squad.targeting as Record<string, unknown>).demographics,
    [{ min_age: "18" }],
  );
  assertEquals(
    buildTikTokAudienceEstimateBody(input("tiktok", true)),
    buildTikTokAudienceEstimateBody({
      ...input("tiktok", true),
      connection: { ...input("tiktok", true).connection, currency: "USD" },
    }),
  );
});
