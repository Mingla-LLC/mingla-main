/**
 * ISSUE-867 WP2 — google.ts adapter unit tests (implementor happy-path suite).
 *
 * Regression contract coverage:
 *   AC-G-1 (fail-close): GOOGLE_ADS_* secrets absent → AdNotConnectedError
 *   `google_not_provisioned` with ZERO network calls. Reverting the
 *   resolveGoogleEnvConfig throw makes these fail.
 *   G-P3 (the PROVEN reference body): temp-ID ordering (negative, unique,
 *   defined-before-referenced), G-14 containsEuPoliticalAdvertising, PRESENCE
 *   geo type, PAUSED campaign + PAUSED ad + ENABLED ad group, search-only
 *   networkSettings, targetSpend, partialFailure:false, validateOnly
 *   passthrough.
 *   RT-5 (GR-01 money): cents ×10,000 → micros at THE one google boundary
 *   ($5.00 → 5,000,000 · $20.00 → 20,000,000).
 *   AC-G-4 (REMOVED-never): the status writer can only emit ENABLED|PAUSED.
 *   A4.f/A1.1(5) (destination split): finalUrls = [dest_url]; the OneLink
 *   rides ONLY in trackingUrlTemplate.
 *   G-4 (RSA): 3–15 headlines ≤30 / 2–4 descriptions ≤90, validated pre-call.
 *   GR-15/GR-73 (keywords): required, PHRASE default, ≤80 chars/≤10 words.
 *   GR-37/G-P2 (geo): countryCode-scoped disambiguation — London,Ontario,
 *   Canada sorting first must NEVER win a GB lookup; REMOVAL_PLANNED excluded.
 *   G-3 (review): BOTH approval_status AND review_status + policy_topic_entries
 *   land in the review detail.
 *   external_ad_id = the `{ad_group_id}~{ad_id}` composite.
 *   SC-SEC-1: ya29./1// secrets scrubbed from normalized errors.
 *   Token mint: one HTTP mint per cache window; re-mint after reset.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/google.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type AdConnectionRow,
  AdApiError,
  AdNotConnectedError,
  type AdvertiserStatus,
  centsToPlatformBudget,
  getAdapter,
} from "../adChannel.ts";
import {
  buildGoogleMutateOperations,
  buildGoogleMutateRequest,
  buildGoogleReviewDetail,
  buildGoogleStatusUpdateOperation,
  GOOGLE_EU_POLITICAL_ADVERTISING_VALUE,
  GOOGLE_GEO_COUNTRY_CONSTANTS,
  type GoogleCreateFullCampaignInput,
  googleAdapter,
  googleStatusForAdvertiserStatus,
  idFromResourceName,
  mintGoogleAccessToken,
  normalizeGoogleError,
  normalizeGoogleKeywords,
  parseGoogleMutateResults,
  pickGeoSuggestion,
  resetGoogleTokenCacheForTests,
  resolveGoogleEnvConfig,
  scrubGoogleSecrets,
  validateGoogleFinalUrl,
  validateGoogleRsa,
} from "../google.ts";

const GOOGLE_ENV_NAMES = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_OAUTH_CLIENT_ID",
  "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "GOOGLE_ADS_CUSTOMER_ID",
];

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-000000000002",
  platform: "google",
  lane: "consumer",
  display_name: "Google Ads · Consumer",
  external_account_id: "1230001111",
  external_org_id: "8280000000",
  auth_kind: "dev_token_oauth",
  token_env_var: "GOOGLE_ADS_REFRESH_TOKEN",
  extra: {},
  status: "connected",
  currency: "USD",
  timezone: "America/New_York",
  min_daily_budget_cents: null,
  account_status: "ENABLED",
  token_last_verified_at: null,
  connected: true,
};

function withGoogleEnvUnset(fn: () => void | Promise<void>): () => Promise<void> {
  return async () => {
    const prior = new Map<string, string | undefined>();
    for (const name of GOOGLE_ENV_NAMES) {
      prior.set(name, Deno.env.get(name));
      Deno.env.delete(name);
    }
    resetGoogleTokenCacheForTests();
    try {
      await fn();
    } finally {
      for (const [name, value] of prior) {
        if (value !== undefined) Deno.env.set(name, value);
      }
    }
  };
}

function withGoogleEnvSet(fn: () => void | Promise<void>): () => Promise<void> {
  return async () => {
    const prior = new Map<string, string | undefined>();
    const values: Record<string, string> = {
      GOOGLE_ADS_DEVELOPER_TOKEN: "test-dev-token",
      GOOGLE_ADS_REFRESH_TOKEN: "test-refresh-token",
      GOOGLE_ADS_OAUTH_CLIENT_ID: "test-client-id",
      GOOGLE_ADS_OAUTH_CLIENT_SECRET: "test-client-secret",
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: "828-470-0017", // dashes must be stripped
      GOOGLE_ADS_CUSTOMER_ID: "3623860476",
    };
    for (const name of GOOGLE_ENV_NAMES) {
      prior.set(name, Deno.env.get(name));
      Deno.env.set(name, values[name]);
    }
    resetGoogleTokenCacheForTests();
    try {
      await fn();
    } finally {
      for (const [name, value] of prior) {
        if (value !== undefined) Deno.env.set(name, value);
        else Deno.env.delete(name);
      }
      resetGoogleTokenCacheForTests();
    }
  };
}

const CREATE_INPUT: GoogleCreateFullCampaignInput = {
  name: "Test Event Campaign",
  dailyBudgetCents: 2000, // $20.00
  cpcBidCents: 100, // $1.00 max CPC
  finalUrl: "https://usemingla.com/e/test-brand/test-event",
  trackingUrlTemplate:
    "https://go.usemingla.com/w36m?pid=google_ads&af_c_id={campaignid}&af_ad={creative}&deep_link_value=event&deep_link_sub1=test-brand&af_r={lpurl}",
  headlines: ["Book Test Event", "Live in London", "Reserve Your Spot"],
  descriptions: ["A real Mingla event you can book today.", "Tickets are limited — reserve now."],
  keywords: [
    { text: "events in london tonight", matchType: "PHRASE" },
    { text: "book event london", matchType: "PHRASE" },
  ],
  geoTargetCriterionIds: ["1006886"], // London (UK) — PROOF G-P2
};

const CUSTOMER_ID = "3623860476";

// ── AC-G-1: fail-close, zero network calls, google_not_provisioned ────────────

Deno.test(
  "AC-G-1: resolveGoogleEnvConfig throws google_not_provisioned when ANY secret is unset",
  withGoogleEnvUnset(() => {
    // Reverting the fail-close throw (returning defaults instead) makes this
    // fail — no path may proceed toward spend on an unprovisioned channel.
    const err = assertThrows(() => resolveGoogleEnvConfig(CONN), AdNotConnectedError);
    assertEquals(err.detail, "google_not_provisioned");
  }),
);

Deno.test(
  "AC-G-1: one missing secret (developer token) still fail-closes",
  withGoogleEnvSet(() => {
    Deno.env.delete("GOOGLE_ADS_DEVELOPER_TOKEN");
    const err = assertThrows(() => resolveGoogleEnvConfig(CONN), AdNotConnectedError);
    assertEquals(err.detail, "google_not_provisioned");
  }),
);

Deno.test(
  "AC-G-1: adapter connect / setStatus / getStatus / setBudget make ZERO network calls when unprovisioned",
  withGoogleEnvUnset(async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      await assertRejects(() => googleAdapter.connect(CONN), AdNotConnectedError);
      await assertRejects(
        () => googleAdapter.setStatus(CONN, "campaign", "123", "ACTIVE"),
        AdNotConnectedError,
      );
      await assertRejects(
        () => googleAdapter.getStatus(CONN, "campaign", "123"),
        AdNotConnectedError,
      );
      await assertRejects(
        () => googleAdapter.setBudget(CONN, "campaign", "123", 2000),
        AdNotConnectedError,
      );
      assertEquals(fetchCalls, 0, "secrets-absent must fail BEFORE any network call");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }),
);

Deno.test(
  "env config strips dashes from login-customer-id (G-P3 header contract: digits only)",
  withGoogleEnvSet(() => {
    const env = resolveGoogleEnvConfig(CONN);
    assertEquals(env.loginCustomerId, "8284700017");
    assertEquals(env.customerId, "3623860476");
    assertEquals(env.apiVersion, "v24"); // G-1 — v25 does not exist
  }),
);

// ── The PROVEN G-P3 reference body ────────────────────────────────────────────

Deno.test("G-P3: operations are ordered budget → campaign → criteria → adGroup → ad → keywords", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER_ID, CREATE_INPUT);
  const keys = ops.map((op) => Object.keys(op)[0]);
  assertEquals(keys, [
    "campaignBudgetOperation",
    "campaignOperation",
    "campaignCriterionOperation",
    "adGroupOperation",
    "adGroupAdOperation",
    "adGroupCriterionOperation",
    "adGroupCriterionOperation",
  ]);
});

Deno.test("G-P3: temp IDs are negative, unique, and DEFINED BEFORE REFERENCED", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER_ID, CREATE_INPUT);
  const defined = new Set<string>();
  const tempIds = new Set<string>();
  for (const op of ops) {
    const operation = Object.values(op)[0] as Record<string, unknown>;
    const create = operation.create as Record<string, unknown>;
    // Every temp resource REFERENCED by this op must already be DEFINED.
    for (const field of ["campaignBudget", "campaign", "adGroup"]) {
      const ref = create[field];
      if (typeof ref === "string" && /\/-\d+$/.test(ref)) {
        assert(
          defined.has(ref),
          `temp resource ${ref} referenced by ${Object.keys(op)[0]} before it was defined — declaration order matters (G-P3 hard rule)`,
        );
      }
    }
    const resourceName = create.resourceName;
    if (typeof resourceName === "string") {
      const match = resourceName.match(/\/(-\d+)$/);
      assert(match, `resourceName ${resourceName} must carry a NEGATIVE temp id`);
      assert(!tempIds.has(match[1]), `temp id ${match[1]} must be unique within the request`);
      tempIds.add(match[1]);
      defined.add(resourceName);
    }
  }
  assertEquals(tempIds.size, 3, "budget, campaign, ad group each get one temp id");
});

Deno.test("G-14: EVERY campaign create carries containsEuPoliticalAdvertising (fails-on-revert target)", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER_ID, CREATE_INPUT);
  const campaignOp = ops.find((op) => "campaignOperation" in op) as Record<string, unknown>;
  const campaign = (campaignOp.campaignOperation as Record<string, unknown>)
    .create as Record<string, unknown>;
  // PROOF G-P3: the validate-only chain FAILED without this field and
  // validated clean ({}) with it — v24 REQUIRES it, unconditionally.
  assertEquals(
    campaign.containsEuPoliticalAdvertising,
    GOOGLE_EU_POLITICAL_ADVERTISING_VALUE,
  );
  assertEquals(
    GOOGLE_EU_POLITICAL_ADVERTISING_VALUE,
    "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
  );
});

Deno.test("G-P3: campaign is PAUSED + SEARCH + targetSpend + PRESENCE + search-only networks (PAUSED = fails-on-revert target)", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER_ID, CREATE_INPUT);
  const campaignOp = ops.find((op) => "campaignOperation" in op) as Record<string, unknown>;
  const campaign = (campaignOp.campaignOperation as Record<string, unknown>)
    .create as Record<string, unknown>;
  assertEquals(campaign.status, "PAUSED"); // GR-11 — never a platform default
  assertEquals(campaign.advertisingChannelType, "SEARCH"); // PMax/DISPLAY deferred
  assertEquals(campaign.targetSpend, {}); // GR-55 maximize clicks
  assertEquals(
    (campaign.geoTargetTypeSetting as Record<string, unknown>).positiveGeoTargetType,
    "PRESENCE", // GR-37 — PRESENCE_OR_INTEREST shows London ads to anyone "interested"
  );
  assertEquals(campaign.networkSettings, {
    targetGoogleSearch: true,
    targetSearchNetwork: false,
    targetContentNetwork: false,
    targetPartnerSearchNetwork: false,
  });
  // The budget reference points at the temp budget resource.
  assertEquals(campaign.campaignBudget, `customers/${CUSTOMER_ID}/campaignBudgets/-1`);
});

Deno.test("G-P3: PAUSED ad + ENABLED ad group (the proven shape); ad group is SEARCH_STANDARD", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER_ID, CREATE_INPUT);
  const adGroupOp = ops.find((op) => "adGroupOperation" in op) as Record<string, unknown>;
  const adGroup = (adGroupOp.adGroupOperation as Record<string, unknown>)
    .create as Record<string, unknown>;
  assertEquals(adGroup.status, "ENABLED");
  assertEquals(adGroup.type, "SEARCH_STANDARD");
  const adOp = ops.find((op) => "adGroupAdOperation" in op) as Record<string, unknown>;
  const adGroupAd = (adOp.adGroupAdOperation as Record<string, unknown>)
    .create as Record<string, unknown>;
  assertEquals(adGroupAd.status, "PAUSED");
});

Deno.test("RT-5 money: budget cents ×10,000 → micros at THE one google boundary", () => {
  // A4.a mandatory pair: $5.00 (500¢) → 5,000,000 and $20.00 (2,000¢) → 20,000,000.
  assertEquals(centsToPlatformBudget("google", 500), 5_000_000);
  assertEquals(centsToPlatformBudget("google", 2000), 20_000_000);
  const ops = buildGoogleMutateOperations(CUSTOMER_ID, CREATE_INPUT);
  const budgetOp = ops.find((op) => "campaignBudgetOperation" in op) as Record<string, unknown>;
  const budget = (budgetOp.campaignBudgetOperation as Record<string, unknown>)
    .create as Record<string, unknown>;
  assertEquals(budget.amountMicros, "20000000"); // 2,000¢ — int64 as string
  assertEquals(budget.deliveryMethod, "STANDARD"); // ACCELERATED is sunset (G-13)
  assertEquals(budget.explicitlyShared, false);
  const adGroupOp = ops.find((op) => "adGroupOperation" in op) as Record<string, unknown>;
  const adGroup = (adGroupOp.adGroupOperation as Record<string, unknown>)
    .create as Record<string, unknown>;
  assertEquals(adGroup.cpcBidMicros, "1000000"); // 100¢ ($1.00) × 10,000
});

Deno.test("A4.f/A1.1(5) split: finalUrls = [dest_url]; the OneLink rides ONLY in trackingUrlTemplate", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER_ID, CREATE_INPUT);
  const adOp = ops.find((op) => "adGroupAdOperation" in op) as Record<string, unknown>;
  const ad = ((adOp.adGroupAdOperation as Record<string, unknown>)
    .create as Record<string, unknown>).ad as Record<string, unknown>;
  assertEquals(ad.finalUrls, ["https://usemingla.com/e/test-brand/test-event"]);
  // The ad-visible destination must NEVER be the OneLink (PROOF D-P1 — the
  // AppsFlyer interstitial reads as cloaking to ad-review crawlers).
  const adJson = JSON.stringify(ad);
  assert(!adJson.includes("go.usemingla.com"), "the OneLink must not appear anywhere on the ad");
  const campaignOp = ops.find((op) => "campaignOperation" in op) as Record<string, unknown>;
  const campaign = (campaignOp.campaignOperation as Record<string, unknown>)
    .create as Record<string, unknown>;
  assertEquals(campaign.trackingUrlTemplate, CREATE_INPUT.trackingUrlTemplate);
  assert(String(campaign.trackingUrlTemplate).includes("{lpurl}"));
});

Deno.test("G-P3: RSA carries the AdTextAsset shape; keyword ops default nothing silently", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER_ID, CREATE_INPUT);
  const adOp = ops.find((op) => "adGroupAdOperation" in op) as Record<string, unknown>;
  const rsa = (((adOp.adGroupAdOperation as Record<string, unknown>)
    .create as Record<string, unknown>).ad as Record<string, unknown>)
    .responsiveSearchAd as Record<string, unknown>;
  assertEquals(rsa.headlines, [
    { text: "Book Test Event" },
    { text: "Live in London" },
    { text: "Reserve Your Spot" },
  ]);
  assertEquals(rsa.descriptions, [
    { text: "A real Mingla event you can book today." },
    { text: "Tickets are limited — reserve now." },
  ]);
  const keywordOps = ops.filter((op) => "adGroupCriterionOperation" in op);
  assertEquals(keywordOps.length, 2);
  const first = (keywordOps[0].adGroupCriterionOperation as Record<string, unknown>)
    .create as Record<string, unknown>;
  assertEquals(first.keyword, { text: "events in london tonight", matchType: "PHRASE" });
  assertEquals(first.status, "ENABLED");
  assertEquals(first.adGroup, `customers/${CUSTOMER_ID}/adGroups/-3`);
});

Deno.test("negative keywords are separate ops with negative:true (GR-73 — immutable, never toggled)", () => {
  const ops = buildGoogleMutateOperations(CUSTOMER_ID, {
    ...CREATE_INPUT,
    negativeKeywords: [{ text: "free", matchType: "BROAD" }],
  });
  const criterionOps = ops.filter((op) => "adGroupCriterionOperation" in op);
  assertEquals(criterionOps.length, 3);
  const negative = (criterionOps[2].adGroupCriterionOperation as Record<string, unknown>)
    .create as Record<string, unknown>;
  assertEquals(negative.negative, true);
  assertEquals(negative.keyword, { text: "free", matchType: "BROAD" });
});

Deno.test("G-P3 envelope: partialFailure:false (native atomicity) + validateOnly passthrough", () => {
  const request = buildGoogleMutateRequest(CUSTOMER_ID, CREATE_INPUT);
  assertEquals(request.partialFailure, false);
  assertEquals(request.validateOnly, false);
  const validateRequest = buildGoogleMutateRequest(CUSTOMER_ID, {
    ...CREATE_INPUT,
    validateOnly: true,
  });
  assertEquals(validateRequest.validateOnly, true);
  assertEquals(validateRequest.partialFailure, false);
});

Deno.test("no create body ever carries REMOVED (AC-G-4 blast check on the whole request)", () => {
  const request = buildGoogleMutateRequest(CUSTOMER_ID, CREATE_INPUT);
  assert(!JSON.stringify(request).includes("REMOVED"));
});

// ── external_ad_id: the {ad_group_id}~{ad_id} composite ──────────────────────

Deno.test("mutate result parsing: external_ad_id is the {ad_group_id}~{ad_id} composite", () => {
  const payload = {
    mutateOperationResponses: [
      { campaignBudgetResult: { resourceName: `customers/${CUSTOMER_ID}/campaignBudgets/111` } },
      { campaignResult: { resourceName: `customers/${CUSTOMER_ID}/campaigns/222` } },
      { campaignCriterionOperationIgnored: {} },
      { adGroupResult: { resourceName: `customers/${CUSTOMER_ID}/adGroups/333` } },
      { adGroupAdResult: { resourceName: `customers/${CUSTOMER_ID}/adGroupAds/333~444` } },
    ],
  };
  const names = parseGoogleMutateResults(payload);
  assertEquals(idFromResourceName(names.campaignResourceName ?? ""), "222");
  assertEquals(idFromResourceName(names.adGroupResourceName ?? ""), "333");
  assertEquals(idFromResourceName(names.adGroupAdResourceName ?? ""), "333~444");
});

// ── AC-G-4: the REMOVED-never status writer ───────────────────────────────────

Deno.test("AC-G-4: googleStatusForAdvertiserStatus maps ONLY to ENABLED|PAUSED", () => {
  assertEquals(googleStatusForAdvertiserStatus("ACTIVE"), "ENABLED");
  assertEquals(googleStatusForAdvertiserStatus("PAUSED"), "PAUSED");
  // A hostile cast cannot smuggle REMOVED through — the exhaustive switch throws.
  const hostile = "REMOVED" as AdvertiserStatus;
  assertThrows(() => googleStatusForAdvertiserStatus(hostile), AdApiError);
});

Deno.test("AC-G-4: the status-update operation never emits REMOVED and pins updateMask:status", () => {
  for (
    const [level, externalId, path] of [
      ["campaign", "222", "campaigns:mutate"],
      ["ad_set", "333", "adGroups:mutate"],
      ["ad", "333~444", "adGroupAds:mutate"],
    ] as const
  ) {
    for (const status of ["ACTIVE", "PAUSED"] as const) {
      const op = buildGoogleStatusUpdateOperation(CUSTOMER_ID, level, externalId, status);
      assertEquals(op.path, `customers/${CUSTOMER_ID}/${path}`);
      const operation = (op.body.operations as Record<string, unknown>[])[0];
      assertEquals(operation.updateMask, "status");
      const update = operation.update as Record<string, unknown>;
      assertEquals(update.status, status === "ACTIVE" ? "ENABLED" : "PAUSED");
      assert(!JSON.stringify(op.body).includes("REMOVED"));
    }
  }
});

Deno.test("external id hygiene: non-numeric / non-composite ids are rejected (GAQL injection guard)", () => {
  assertThrows(
    () => buildGoogleStatusUpdateOperation(CUSTOMER_ID, "campaign", "1 OR 1=1", "PAUSED"),
    AdApiError,
  );
  assertThrows(
    () => buildGoogleStatusUpdateOperation(CUSTOMER_ID, "ad", "444", "PAUSED"),
    AdApiError,
    undefined,
    "an ad id must be the {ad_group_id}~{ad_id} composite",
  );
});

// ── G-4: RSA validators (pre-call 422 material) ───────────────────────────────

Deno.test("G-4: RSA validator enforces 3–15 headlines ≤30 and 2–4 descriptions ≤90", () => {
  const h = (n: number) => Array.from({ length: n }, (_, i) => `Headline ${i + 1}`);
  const d = (n: number) => Array.from({ length: n }, (_, i) => `Description ${i + 1}`);
  assertEquals(validateGoogleRsa(h(3), d(2)).ok, true);
  assertEquals(validateGoogleRsa(h(15), d(4)).ok, true);
  const tooFewHeadlines = validateGoogleRsa(h(2), d(2));
  assert(!tooFewHeadlines.ok && tooFewHeadlines.detail === "rsa_headline_count");
  const tooManyHeadlines = validateGoogleRsa(h(16), d(2));
  assert(!tooManyHeadlines.ok && tooManyHeadlines.detail === "rsa_headline_count");
  const longHeadline = validateGoogleRsa(["x".repeat(31), "ok", "ok2"], d(2));
  assert(!longHeadline.ok && longHeadline.detail === "rsa_headline_too_long");
  const tooFewDescriptions = validateGoogleRsa(h(3), d(1));
  assert(!tooFewDescriptions.ok && tooFewDescriptions.detail === "rsa_description_count");
  // RSA max is 4 — the 5-description figure is PMax, a DIFFERENT ad type (G-4).
  const tooManyDescriptions = validateGoogleRsa(h(3), d(5));
  assert(!tooManyDescriptions.ok && tooManyDescriptions.detail === "rsa_description_count");
  const longDescription = validateGoogleRsa(h(3), ["x".repeat(91), "ok"]);
  assert(!longDescription.ok && longDescription.detail === "rsa_description_too_long");
});

// ── GR-15/GR-73: keywords ─────────────────────────────────────────────────────

Deno.test("GR-15: keywords are REQUIRED for SEARCH; PHRASE is the default match type", () => {
  const missing = normalizeGoogleKeywords(undefined);
  assert(!missing.ok && missing.detail === "keywords_required");
  const empty = normalizeGoogleKeywords([]);
  assert(!empty.ok && empty.detail === "keywords_required");
  const strings = normalizeGoogleKeywords(["dinner in london"]);
  assert(strings.ok);
  assertEquals(strings.keywords, [{ text: "dinner in london", matchType: "PHRASE" }]);
  const explicit = normalizeGoogleKeywords([{ text: "mingla events", match_type: "exact" }]);
  assert(explicit.ok);
  assertEquals(explicit.keywords[0].matchType, "EXACT");
});

Deno.test("GR-73: keyword caps — ≤80 chars, ≤10 words; invalid match types rejected", () => {
  const tooLong = normalizeGoogleKeywords(["x".repeat(81)]);
  assert(!tooLong.ok && tooLong.detail === "keyword_too_long");
  const tooManyWords = normalizeGoogleKeywords(["a b c d e f g h i j k"]);
  assert(!tooManyWords.ok && tooManyWords.detail === "keyword_too_many_words");
  const badMatch = normalizeGoogleKeywords([{ text: "ok", match_type: "NEGATIVE" }]);
  assert(!badMatch.ok && badMatch.detail === "keyword_match_type_invalid");
  const optional = normalizeGoogleKeywords(undefined, { required: false });
  assert(optional.ok && optional.keywords.length === 0);
});

Deno.test("GR-73: final URL must be https and ≤2,084 bytes", () => {
  assertEquals(validateGoogleFinalUrl("https://usemingla.com/e/a/b").ok, true);
  const http = validateGoogleFinalUrl("http://usemingla.com/e/a/b");
  assert(!http.ok && http.detail === "invalid_destination_url");
  const huge = validateGoogleFinalUrl(`https://usemingla.com/${"x".repeat(2100)}`);
  assert(!huge.ok && huge.detail === "invalid_destination_url");
});

// ── GR-37/G-P2: geo resolver — the London/Ontario hazard ─────────────────────

const LONDON_SUGGEST_PAYLOAD = {
  geoTargetConstantSuggestions: [
    {
      // The hazard: London,Ontario,Canada sorts FIRST on a naive lookup.
      geoTargetConstant: {
        resourceName: "geoTargetConstants/1002325",
        id: "1002325",
        name: "London",
        countryCode: "CA",
        targetType: "City",
        status: "ENABLED",
        canonicalName: "London,Ontario,Canada",
      },
    },
    {
      geoTargetConstant: {
        resourceName: "geoTargetConstants/9999999",
        id: "9999999",
        name: "London",
        countryCode: "GB",
        targetType: "City",
        status: "REMOVAL_PLANNED", // rotting IDs must never be persisted
        canonicalName: "London,England,United Kingdom",
      },
    },
    {
      geoTargetConstant: {
        resourceName: "geoTargetConstants/1006886",
        id: "1006886",
        name: "London",
        countryCode: "GB",
        targetType: "City",
        status: "ENABLED",
        canonicalName: "London,England,United Kingdom",
      },
    },
  ],
};

Deno.test("GR-37: a GB-scoped London lookup NEVER resolves to London,Ontario,Canada", () => {
  const resolved = pickGeoSuggestion(LONDON_SUGGEST_PAYLOAD, {
    name: "London",
    countryCode: "GB",
  });
  assert(resolved !== null);
  assertEquals(resolved.criterionId, "1006886"); // PROOF G-P2
  assertEquals(resolved.canonicalName, "London,England,United Kingdom");
  assertEquals(resolved.countryCode, "GB");
});

Deno.test("GR-37: REMOVAL_PLANNED constants are skipped; no match → null", () => {
  const resolved = pickGeoSuggestion(LONDON_SUGGEST_PAYLOAD, {
    name: "London",
    countryCode: "GB",
  });
  // 9999999 is REMOVAL_PLANNED and must lose to the ENABLED 1006886.
  assert(resolved !== null && resolved.criterionId !== "9999999");
  const noMatch = pickGeoSuggestion(LONDON_SUGGEST_PAYLOAD, {
    name: "London",
    countryCode: "NG",
  });
  assertEquals(noMatch, null);
});

Deno.test("GR-37: verified country seed constants (CSV-verified — never guessed)", () => {
  assertEquals(GOOGLE_GEO_COUNTRY_CONSTANTS.US.criterionId, "2840");
  assertEquals(GOOGLE_GEO_COUNTRY_CONSTANTS.GB.criterionId, "2826");
  assertEquals(GOOGLE_GEO_COUNTRY_CONSTANTS.NG.criterionId, "2566");
});

// ── G-3: BOTH review vocabularies persisted ───────────────────────────────────

Deno.test("G-3: review detail carries approval_status AND review_status AND policy_topic_entries", () => {
  const detail = buildGoogleReviewDetail({
    issuesInfo: [{ topic: "TRADEMARKS", type: "LIMITED" }],
    adReviewFeedback: {
      approval_status: "APPROVED_LIMITED",
      review_status: "REVIEWED",
    },
  });
  assert(detail !== null);
  assertEquals(detail.approval_status, "APPROVED_LIMITED");
  assertEquals(detail.review_status, "REVIEWED");
  assertEquals(detail.policy_topic_entries, [{ topic: "TRADEMARKS", type: "LIMITED" }]);
  assertEquals(buildGoogleReviewDetail({}), null);
});

// ── SC-SEC-1: secret scrubbing + error normalization ──────────────────────────

Deno.test("SC-SEC-1: ya29. access tokens and 1// refresh tokens are scrubbed", () => {
  const scrubbed = scrubGoogleSecrets(
    "auth failed for ya29.a0AbCdEf-123_456 and 1//0abcDEF-ghiJKL",
  );
  assert(!scrubbed.includes("ya29."));
  assert(!scrubbed.includes("1//"));
  assertEquals(scrubbed, "auth failed for [redacted] and [redacted]");
});

Deno.test("normalizeGoogleError extracts errorCode key, message, and requestId (what Google support requires)", () => {
  const normalized = normalizeGoogleError({
    error: {
      code: 400,
      message: "Request contains an invalid argument.",
      status: "INVALID_ARGUMENT",
      details: [
        {
          "@type": "type.googleapis.com/google.ads.googleads.v24.errors.GoogleAdsFailure",
          errors: [
            {
              errorCode: { campaignError: "CANNOT_TARGET_REMOVED_CAMPAIGN" },
              message: "Cannot target removed campaign.",
            },
          ],
          requestId: "abc123request",
        },
      ],
    },
  });
  assertEquals(normalized.code, "INVALID_ARGUMENT");
  assertEquals(normalized.subcode, "campaignError.CANNOT_TARGET_REMOVED_CAMPAIGN");
  assertEquals(normalized.message, "Cannot target removed campaign.");
  assertEquals(normalized.request_id, "abc123request");
});

// ── Token mint + cache ────────────────────────────────────────────────────────

Deno.test(
  "mint cache: two resolves within the window → ONE token HTTP call; reset → re-mint",
  withGoogleEnvSet(async () => {
    const originalFetch = globalThis.fetch;
    let mintCalls = 0;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("oauth2.googleapis.com/token")) {
        mintCalls += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "ya29.test-token", expires_in: 3600 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as typeof fetch;
    try {
      const env = resolveGoogleEnvConfig(CONN);
      const first = await mintGoogleAccessToken(env);
      const second = await mintGoogleAccessToken(env);
      assertEquals(first, second);
      assertEquals(mintCalls, 1, "the cached token must be reused within its window");
      resetGoogleTokenCacheForTests();
      await mintGoogleAccessToken(env);
      assertEquals(mintCalls, 2, "a cleared cache must re-mint");
    } finally {
      globalThis.fetch = originalFetch;
      resetGoogleTokenCacheForTests();
    }
  }),
);

Deno.test(
  "mint failure (revoked refresh token) fails CLOSE with google_not_connected — never a stale/empty token",
  withGoogleEnvSet(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      )) as typeof fetch;
    try {
      const env = resolveGoogleEnvConfig(CONN);
      const err = await assertRejects(() => mintGoogleAccessToken(env), AdNotConnectedError);
      assertEquals(err.detail, "google_not_connected");
    } finally {
      globalThis.fetch = originalFetch;
      resetGoogleTokenCacheForTests();
    }
  }),
);

// ── Registry wiring + sequential-path lockout ─────────────────────────────────

Deno.test("registry: getAdapter('google') is the live adapter, not the fail-close stub", () => {
  assertEquals(getAdapter("google"), googleAdapter);
  assertEquals(googleAdapter.platform, "google");
});

Deno.test(
  "sequential createCampaign/createAdSet/createAd are DISABLED (atomic-only — A1.1(4)); createCreative is absent",
  withGoogleEnvSet(async () => {
    await assertRejects(
      () => googleAdapter.createCampaign(CONN, { name: "x", objective: "SEARCH" }),
      AdApiError,
      "atomic",
    );
    await assertRejects(
      () =>
        googleAdapter.createAdSet(CONN, "222", {
          name: "x",
          optimizationGoal: "MAXIMIZE_CLICKS",
          billingEvent: "",
          targeting: {},
        }),
      AdApiError,
      "atomic",
    );
    await assertRejects(
      () => googleAdapter.createAd(CONN, "333", { name: "x", externalCreativeId: "" }),
      AdApiError,
      "atomic",
    );
    assertEquals(googleAdapter.createCreative, undefined);
    // rollback hooks deliberately absent: partialFailure:false is natively
    // atomic and REMOVED is permanent (A1.1(4)).
    assertEquals(googleAdapter.rollbackCampaign, undefined);
    assertEquals(googleAdapter.rollbackCreative, undefined);
  }),
);

Deno.test(
  "setBudget rejects non-campaign levels (Google budgets live on the campaign budget resource)",
  withGoogleEnvSet(async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      await assertRejects(
        () => googleAdapter.setBudget(CONN, "ad_set", "333", 2000),
        AdApiError,
        "campaign budget",
      );
      assertEquals(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      resetGoogleTokenCacheForTests();
    }
  }),
);
