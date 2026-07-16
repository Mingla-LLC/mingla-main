/**
 * ISSUE-916 WP6 — reddit.ts adapter unit tests (implementor happy-path suite).
 *
 * SPEC: SPEC_ISSUE-REDDIT_CHANNEL.md §8 gates + §9 acceptance criteria
 * (mocked-transport legs; the live legs are the tester's, PAUSED, in the
 * supervised live-fire window — Reddit has NO validate-only).
 *
 * Gate coverage:
 *   G-2 CTA-case — the emitted call_to_action is byte-identical to one of the
 *     24 Title-Case strings; "Buy Tickets" never becomes BUY_TICKETS/"BUY
 *     TICKETS" (GR-29). Reverting to an uppercase normalizer fails here.
 *   G-3 unit-conversion — toMicro(500)===5_000_000, toMicro(2000)===20_000_000;
 *     the CPC band accepts 3_500_000/100_000_000 and rejects the ±1 edges; NO
 *     daily floor exists (a $2.00/day goal_value passes our validation — the
 *     API, not us, owns the floor; GR-59). Reverting ×10,000→×1,000 fails here.
 *   G-4 targeting-allowlist + query= — serializer output keys ⊆ the allowlist
 *     with age unrepresentable (R-8); gender ∈ {FEMALE,MALE,null}; r/ stripped;
 *     the community search client sends query= and never q= (R-P6). Reverting
 *     query=→q= fails here.
 *   (G-1 configured_status lives in the strict-grep gate
 *    issue-862-reddit-configured-status-explicit.mjs; the PAUSED-at-all-three-
 *    levels assertions below fail on the same revert.)
 *
 * AC coverage (mocked): AC-R-2…AC-R-5, AC-R-7…AC-R-12, AC-R-14…AC-R-26.
 * AC-R-1/AC-R-6 (live connection), AC-R-13 (live launch leg), AC-R-27 (cron
 * cadence) carry their unit-testable halves here and their live halves in the
 * tester's window.
 *
 * NO network call is performed anywhere in this suite — globalThis.fetch is
 * stubbed in every networked test; the fail-close tests assert ZERO calls.
 *
 * Run: deno test --allow-env --allow-read \
 *   supabase/functions/_shared/__tests__/reddit.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type AdConnectionRow,
  AdApiError,
  AdNotConnectedError,
  getAdapter,
  REDDIT_CTA_MAP,
} from "../adChannel.ts";
import {
  buildRedditAdBody,
  buildRedditAdGroupBody,
  buildRedditCampaignBody,
  buildRedditReviewDetail,
  buildRedditStructuredPostJobBody,
  extractRedditPostId,
  formatRedditInvalidMediaMessage,
  mintRedditAccessToken,
  normalizeRedditObjective,
  parseRedditRateLimitHeader,
  peekRedditTokenExpiryForTests,
  REDDIT_AD_ACCOUNT_ID_REGEX,
  REDDIT_CPC_BID_MAX_MICRO,
  REDDIT_CPC_BID_MIN_MICRO,
  REDDIT_CTA_ENUM,
  REDDIT_JOB_POLL_CAP_MS,
  REDDIT_TARGETING_ALLOWLIST,
  REDDIT_USER_AGENT,
  redditAdapter,
  redditCapsVerdict,
  redditConnectPreflight,
  redditCreateFullChain,
  RedditPreflightError,
  redditLaunchWarning,
  redditReviewStatusFromEffectiveStatus,
  redditRollbackCreatedEntities,
  redditRunStructuredPostJob,
  redditSearchCommunities,
  resetRedditBackoffForTests,
  resetRedditCommunityCacheForTests,
  resetRedditTokenCacheForTests,
  resolveRedditClient,
  resolveRedditEnvConfig,
  serializeRedditTargeting,
  setRedditSleepForTests,
  toMicro,
  validateRedditCopy,
  validateRedditCpcBidMicro,
  validateRedditCreative,
  validateRedditDestinationPolicy,
} from "../reddit.ts";

// ── Harness ───────────────────────────────────────────────────────────────────

const REDDIT_ENV_NAMES = [
  "REDDIT_ADS_CLIENT_ID",
  "REDDIT_ADS_CLIENT_SECRET",
  "REDDIT_ADS_REFRESH_TOKEN",
  "REDDIT_ADS_BUSINESS_ID",
  "REDDIT_ADS_ACCOUNT_ID",
  "REDDIT_ADS_PROFILE_ID",
  "REDDIT_ADS_PIXEL_ID",
  "REDDIT_ADS_FUNDING_INSTRUMENT_ID",
  "REDDIT_ADS_API_BASE",
  "REDDIT_ADS_TOKEN_URL",
];

async function withRedditEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const name of REDDIT_ENV_NAMES) {
    saved.set(name, Deno.env.get(name));
    Deno.env.delete(name);
  }
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) Deno.env.set(name, value);
  }
  resetRedditTokenCacheForTests();
  resetRedditBackoffForTests();
  resetRedditCommunityCacheForTests();
  try {
    await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value !== undefined) Deno.env.set(name, value);
      else Deno.env.delete(name);
    }
    resetRedditTokenCacheForTests();
    resetRedditBackoffForTests();
    resetRedditCommunityCacheForTests();
    setRedditSleepForTests(null);
  }
}

const BASE_ENV = {
  REDDIT_ADS_CLIENT_ID: "client-id",
  REDDIT_ADS_CLIENT_SECRET: "client-secret",
  REDDIT_ADS_REFRESH_TOKEN: "refresh-token",
};

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const MINT_OK = {
  access_token: "minted-token",
  token_type: "bearer",
  expires_in: 86_400,
  scope: "adsread adsedit",
};

/** Narrow init view — avoids fetch-overload Parameters<> lib quirks. */
interface MockFetchInit {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

function installFetchMock(
  handler: (req: CapturedRequest, calls: CapturedRequest[]) => Response | Promise<Response>,
): { calls: CapturedRequest[]; restore: () => void } {
  const calls: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: Request | URL | string,
    init?: MockFetchInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const captured: CapturedRequest = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(captured);
    return await handler(captured, calls);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

/** Routes the mint to MINT_OK and everything else to `handler`. */
function installApiMock(
  handler: (req: CapturedRequest, calls: CapturedRequest[]) => Response | Promise<Response>,
): { calls: CapturedRequest[]; restore: () => void } {
  return installFetchMock((req, calls) => {
    if (req.url.includes("/api/v1/access_token")) return jsonResponse(MINT_OK);
    return handler(req, calls);
  });
}

function recordSleeps(): number[] {
  const sleeps: number[] = [];
  setRedditSleepForTests((ms) => {
    sleeps.push(ms);
    return Promise.resolve();
  });
  return sleeps;
}

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-000000000916",
  platform: "reddit",
  lane: "consumer",
  display_name: "Reddit · Consumer (Mingla Ad Account 0)",
  external_account_id: "a2_jcfwvnfcfqcs",
  external_org_id: "950c8eac-da26-45e6-942e-645ed657e43f",
  auth_kind: "refresh_token",
  token_env_var: "REDDIT_ADS_REFRESH_TOKEN",
  extra: {
    reddit_profile_id: "t2_2ikkjswp3a",
    reddit_funding_instrument_id: "1889187",
    reddit_pixel_id: "a2_jcfwvnfcfqcs",
  },
  status: "connected",
  currency: "USD",
  timezone: null,
  min_daily_budget_cents: null,
  account_status: null,
  token_last_verified_at: null,
  connected: true,
};

const CANONICAL_URL = "https://usemingla.com/e/mingla/rooftop-party";

// ── AC-R-4 / fail-close: secrets absent → 424 shape, ZERO network calls ───────

Deno.test("AC-R-4: missing REDDIT secrets → AdNotConnectedError with zero fetches", async () => {
  await withRedditEnv({}, async () => {
    const { calls, restore } = installFetchMock(() => jsonResponse({}));
    try {
      assertThrows(() => resolveRedditEnvConfig(null, "consumer"), AdNotConnectedError);
      await assertRejects(() => resolveRedditClient(CONN), AdNotConnectedError);
      await assertRejects(
        () => redditAdapter.createCampaign(CONN, { name: "x", objective: "CLICKS" }),
        AdNotConnectedError,
      );
      await assertRejects(() => redditAdapter.connect(CONN), AdNotConnectedError);
      assertEquals(calls.length, 0, "fail-close must fire BEFORE any network call");
    } finally {
      restore();
    }
  });
});

Deno.test("AC-R-4 (lane-correct): the business lane never falls back to consumer secrets", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    const { calls, restore } = installFetchMock(() => jsonResponse(MINT_OK));
    try {
      // Consumer secrets are set; the business lane must still fail-close.
      assertThrows(
        () => resolveRedditEnvConfig(null, "business"),
        AdNotConnectedError,
      );
      assertEquals(calls.length, 0);
    } finally {
      restore();
    }
  });
});

// ── AC-R-2: token TTL is read from expires_in — never hardcoded ───────────────

Deno.test("AC-R-2: mint caches for expires_in − 300s (86400 → ~86100s; 3600 → ~3300s)", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    const env = resolveRedditEnvConfig(null, "consumer");
    // 86400 (our proven account value — R-P1).
    let mock = installFetchMock(() => jsonResponse(MINT_OK));
    try {
      const before = Date.now();
      await mintRedditAccessToken(env);
      const expiry = peekRedditTokenExpiryForTests(env.refreshTokenEnvVar);
      assert(expiry !== null);
      const ttlSeconds = (expiry - before) / 1000;
      assert(
        ttlSeconds > 86_090 && ttlSeconds < 86_105,
        `86400 mint must cache ~86100s; got ${ttlSeconds}`,
      );
      assertEquals(mock.calls.length, 1);
      // A second call inside the window reuses the cache — no second mint.
      await mintRedditAccessToken(env);
      assertEquals(mock.calls.length, 1);
    } finally {
      mock.restore();
    }
    // A 1-hour account (R-2: accept either — never assume 86400 OR hardcode).
    resetRedditTokenCacheForTests();
    mock = installFetchMock(() =>
      jsonResponse({ ...MINT_OK, expires_in: 3600 })
    );
    try {
      const before = Date.now();
      await mintRedditAccessToken(env);
      const expiry = peekRedditTokenExpiryForTests(env.refreshTokenEnvVar);
      assert(expiry !== null);
      const ttlSeconds = (expiry - before) / 1000;
      assert(
        ttlSeconds > 3_290 && ttlSeconds < 3_305,
        `3600 mint must cache ~3300s; got ${ttlSeconds}`,
      );
    } finally {
      mock.restore();
    }
  });
});

Deno.test("AC-R-2 (source trap): no 3600 TTL literal exists in reddit.ts", async () => {
  const source = await Deno.readTextFile(
    new URL("../reddit.ts", import.meta.url),
  );
  assert(!source.includes("3600"), "reddit.ts must not carry a hardcoded 3600 TTL");
});

// ── AC-R-3: the descriptive User-Agent on EVERY request incl. the mint ────────

Deno.test("AC-R-3: User-Agent rides on the mint AND every API call", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    const { calls, restore } = installApiMock(() =>
      jsonResponse({ data: { id: "t2_2ikkjswp3a" } })
    );
    try {
      const client = await resolveRedditClient(CONN);
      await redditAdapter.getStatus(
        { ...CONN },
        "campaign",
        "1684291704682361243",
      );
      await redditSearchCommunities(client, "london");
      assert(calls.length >= 3, "mint + GET + search expected");
      for (const call of calls) {
        assertEquals(
          call.headers.get("User-Agent"),
          REDDIT_USER_AGENT,
          `UA missing on ${call.url}`,
        );
      }
      // The mint itself is Basic-auth'd + form-encoded [SPEC §1.2].
      const mint = calls.find((c) => c.url.includes("/api/v1/access_token"));
      assert(mint);
      assert(mint.headers.get("Authorization")?.startsWith("Basic "));
      assertEquals(
        mint.headers.get("Content-Type"),
        "application/x-www-form-urlencoded",
      );
      assertStringIncludes(mint.body ?? "", "grant_type=refresh_token");
    } finally {
      restore();
    }
  });
});

// ── AC-R-5: ad-account id pattern accepts BOTH prefixes ───────────────────────

Deno.test("AC-R-5: ^(t2|a2)_ — both prefixes legal; never assume a2_", () => {
  assert(REDDIT_AD_ACCOUNT_ID_REGEX.test("a2_jcfwvnfcfqcs"));
  assert(REDDIT_AD_ACCOUNT_ID_REGEX.test("t2_someaccount"));
  assert(!REDDIT_AD_ACCOUNT_ID_REGEX.test("t3_notanaccount"));
  assert(!REDDIT_AD_ACCOUNT_ID_REGEX.test("jcfwvnfcfqcs"));
});

// ── G-3 / AC-R-10: money ──────────────────────────────────────────────────────

Deno.test("G-3: toMicro is cents × 10,000 ($5.00 → 5,000,000; $20.00 → 20,000,000)", () => {
  assertEquals(toMicro(500), 5_000_000);
  assertEquals(toMicro(2000), 20_000_000);
});

Deno.test("G-3: CPC bid band accepts the edges and rejects ±1", () => {
  assertEquals(validateRedditCpcBidMicro(REDDIT_CPC_BID_MIN_MICRO).ok, true);
  assertEquals(validateRedditCpcBidMicro(REDDIT_CPC_BID_MAX_MICRO).ok, true);
  assertEquals(validateRedditCpcBidMicro(3_499_999).ok, false);
  assertEquals(validateRedditCpcBidMicro(100_000_001).ok, false);
});

Deno.test("G-3: NO daily-budget floor of ours — a $2.00/day ad group builds clean", () => {
  const body = buildRedditAdGroupBody({
    campaignExternalId: "1684291704682361243",
    name: "low-budget group",
    budgetCents: 200, // $2.00/day — the API, not us, owns any floor (GR-59)
    conversionPixelId: "a2_jcfwvnfcfqcs",
    startTime: "2026-07-16T00:00:00Z",
    targeting: {},
  });
  assertEquals(body.goal_value, 2_000_000);
});

Deno.test("AC-R-10: a mocked Reddit 400 on a low budget is surfaced VERBATIM", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { restore } = installApiMock((req) => {
      if (req.method === "POST" && req.url.endsWith("/ad_groups")) {
        return jsonResponse(
          { error: { message: "goal_value is below the minimum for this account" } },
          400,
        );
      }
      return jsonResponse({ data: { id: "1" } });
    });
    try {
      const err = await assertRejects(
        () =>
          redditAdapter.createAdSet(CONN, "1684291704682361243", {
            name: "grp",
            optimizationGoal: "CLICKS",
            billingEvent: "IMPRESSIONS",
            budgetCents: 200,
            targeting: { countries: ["GB"] },
          }),
        AdApiError,
      );
      assertEquals(err.code, 400);
      assertEquals(err.message, "goal_value is below the minimum for this account");
    } finally {
      restore();
    }
  });
});

// ── AC-R-7: campaign body ─────────────────────────────────────────────────────

Deno.test("AC-R-7: non-CBO campaign body — PAUSED explicit, mapped objective, funding attached", () => {
  const body = buildRedditCampaignBody({
    name: "Rooftop party — London",
    objective: "TRAFFIC", // engine vocabulary → REDDIT_OBJECTIVE.TRAFFIC
    fundingInstrumentId: "1889187",
    isCbo: false,
    conversionPixelId: "a2_jcfwvnfcfqcs",
  });
  assertEquals(body.configured_status, "PAUSED"); // G-1 fails-on-revert target
  assertEquals(body.objective, "CLICKS");
  assertEquals(body.funding_instrument_id, "1889187");
  assertEquals(body.is_campaign_budget_optimization, false);
  // Non-CBO: no campaign pixel requirement — the ad group carries it.
  assertEquals("conversion_pixel_id" in body, false);
});

Deno.test("AC-R-7 (transport): create bodies are wrapped { data: … } and POST /campaigns", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { calls, restore } = installApiMock(() =>
      jsonResponse({ data: { id: "1684291704682361243" } }, 201)
    );
    try {
      const created = await redditAdapter.createCampaign(CONN, {
        name: "Rooftop party — London",
        objective: "CLICKS",
      });
      assertEquals(created.externalId, "1684291704682361243");
      assertEquals(created.status, "PAUSED");
      const post = calls.find((c) => c.method === "POST" && c.url.includes("/campaigns"));
      assert(post);
      assertStringIncludes(post.url, "/ad_accounts/a2_jcfwvnfcfqcs/campaigns");
      const parsed = JSON.parse(post.body ?? "{}") as Record<string, unknown>;
      const data = parsed.data as Record<string, unknown>;
      assertEquals(data.configured_status, "PAUSED");
      assertEquals(data.objective, "CLICKS");
    } finally {
      restore();
    }
  });
});

Deno.test("AC-R-7: objective outside the 7-value enum / LEAD_GENERATION / CATALOG_SALES → 422", () => {
  assertEquals(normalizeRedditObjective("REACH").ok, false);
  assertEquals(normalizeRedditObjective("BRAND_AWARENESS").ok, false);
  const leadGen = normalizeRedditObjective("LEAD_GENERATION");
  assertEquals(leadGen.ok, false);
  const catalog = normalizeRedditObjective("CATALOG_SALES");
  assertEquals(catalog.ok, false);
  const clicks = normalizeRedditObjective("CLICKS");
  assert(clicks.ok && clicks.objective === "CLICKS");
});

// ── AC-R-8: conversion_pixel_id is UNCONDITIONAL on every ad-group body ───────

Deno.test("AC-R-8: every ad-group input combination carries conversion_pixel_id (GR-12)", () => {
  const combos: Array<Partial<Parameters<typeof buildRedditAdGroupBody>[0]>> = [
    {},
    { bidValueCents: 500 }, // manual bidding path
    { optimizationGoal: "PAGE_VISIT" },
    { endTime: "2026-08-01T00:00:00Z" },
    { schedule: [{ start_day: 0, end_day: 6, start_hour: 18, end_hour: 23 }] },
  ];
  for (const combo of combos) {
    const body = buildRedditAdGroupBody({
      campaignExternalId: "1684291704682361243",
      name: "combo group",
      budgetCents: 500,
      conversionPixelId: "a2_jcfwvnfcfqcs",
      startTime: "2026-07-16T00:00:00Z",
      targeting: {},
      ...combo,
    });
    // The fails-on-revert target: deleting the injection line fails here.
    assertEquals(body.conversion_pixel_id, "a2_jcfwvnfcfqcs");
    assertEquals(body.configured_status, "PAUSED");
  }
  // No code path can build an ad-group body without a pixel.
  assertThrows(
    () =>
      buildRedditAdGroupBody({
        campaignExternalId: "1684291704682361243",
        name: "no pixel",
        budgetCents: 500,
        conversionPixelId: "",
        startTime: "2026-07-16T00:00:00Z",
        targeting: {},
      }),
    AdApiError,
  );
});

// ── AC-R-9: CBO cross-field pre-flight 422s (before any provider call) ────────

Deno.test("AC-R-9: CBO cross-rules reject bad combinations pre-flight", () => {
  const base = {
    name: "CBO campaign",
    fundingInstrumentId: "1889187",
    conversionPixelId: "a2_jcfwvnfcfqcs",
  };
  // CBO without bid_strategy/bid_type/start_time.
  assertThrows(
    () =>
      buildRedditCampaignBody({
        ...base,
        objective: "CLICKS",
        isCbo: true,
        goalType: "DAILY_SPEND",
        goalValueCents: 500,
      }),
    AdApiError,
  );
  // CBO campaign without a pixel.
  assertThrows(
    () =>
      buildRedditCampaignBody({
        ...base,
        conversionPixelId: "",
        objective: "CLICKS",
        isCbo: true,
        goalType: "DAILY_SPEND",
        goalValueCents: 500,
        bidStrategy: "MAXIMIZE_VOLUME",
        bidType: "CPC",
        startTime: "2026-07-16T00:00:00Z",
      }),
    AdApiError,
  );
  // LIFETIME_SPEND without end_time.
  assertThrows(
    () =>
      buildRedditCampaignBody({
        ...base,
        objective: "CLICKS",
        isCbo: true,
        goalType: "LIFETIME_SPEND",
        goalValueCents: 500,
        bidStrategy: "MAXIMIZE_VOLUME",
        bidType: "CPC",
        startTime: "2026-07-16T00:00:00Z",
      }),
    AdApiError,
  );
  // Campaign bid_value set ⇒ ad-group bid_value must be null.
  assertThrows(
    () =>
      buildRedditAdGroupBody({
        campaignExternalId: "1",
        name: "conflicting bids",
        budgetCents: 500,
        conversionPixelId: "a2_jcfwvnfcfqcs",
        startTime: "2026-07-16T00:00:00Z",
        targeting: {},
        bidValueCents: 500,
        campaignHasBidValue: true,
      }),
    AdApiError,
  );
  // CBO with an ineligible objective.
  for (const objective of ["APP_INSTALLS", "CONVERSIONS"]) {
    assertThrows(
      () =>
        buildRedditCampaignBody({
          ...base,
          objective,
          isCbo: true,
          goalType: "DAILY_SPEND",
          goalValueCents: 500,
          bidStrategy: "MAXIMIZE_VOLUME",
          bidType: "CPC",
          startTime: "2026-07-16T00:00:00Z",
        }),
      AdApiError,
    );
  }
  // spend_cap on CBO + LIFETIME_SPEND.
  assertThrows(
    () =>
      buildRedditCampaignBody({
        ...base,
        objective: "CLICKS",
        isCbo: true,
        goalType: "LIFETIME_SPEND",
        goalValueCents: 500,
        endTime: "2026-08-01T00:00:00Z",
        bidStrategy: "MAXIMIZE_VOLUME",
        bidType: "CPC",
        startTime: "2026-07-16T00:00:00Z",
        spendCapCents: 10_000,
      }),
    AdApiError,
  );
  // The valid CBO shape passes and injects the pixel unconditionally.
  const body = buildRedditCampaignBody({
    ...base,
    objective: "CLICKS",
    isCbo: true,
    goalType: "DAILY_SPEND",
    goalValueCents: 500,
    bidStrategy: "MAXIMIZE_VOLUME",
    bidType: "CPC",
    startTime: "2026-07-16T00:00:00Z",
  });
  assertEquals(body.conversion_pixel_id, "a2_jcfwvnfcfqcs");
  assertEquals(body.goal_value, 5_000_000);
  assertEquals(body.configured_status, "PAUSED");
});

// ── G-2 / AC-R-22: the Title-Case CTA contract ────────────────────────────────

Deno.test("G-2: every offering maps to a verbatim member of the 24-string enum", () => {
  const expected: Record<string, string> = {
    ticketed_event: "Buy Tickets",
    bookable: "Book Now",
    restaurant: "See Menu",
    venue: "Get Directions",
    upcoming_event: "Remind Me",
    default: "Learn More",
  };
  for (const [offering, cta] of Object.entries(expected)) {
    const mapped = REDDIT_CTA_MAP[offering as keyof typeof REDDIT_CTA_MAP];
    assertEquals(mapped, cta);
    assert(REDDIT_CTA_ENUM.includes(mapped), `${mapped} must be in the 24-string enum`);
    // The revert targets: an uppercase or snake normalizer fails all three.
    assert(mapped !== mapped.toUpperCase(), `${mapped} must never be uppercased`);
    assert(!mapped.includes("_"), `${mapped} must never be snake-cased`);
  }
});

Deno.test("G-2: the emitted structured-post call_to_action is byte-identical", () => {
  const body = buildRedditStructuredPostJobBody({
    type: "IMAGE",
    headline: "Rooftop tonight — who's in?",
    destinationUrl: CANONICAL_URL,
    callToAction: REDDIT_CTA_MAP.ticketed_event,
    imageUrl: "https://res.cloudinary.com/mingla/hero.jpg",
  });
  const creative = body.creative as Record<string, unknown>;
  const destination = creative.destination as Record<string, unknown>;
  assertEquals(destination.call_to_action, "Buy Tickets");
  assert(destination.call_to_action !== "BUY_TICKETS");
  assert(destination.call_to_action !== "BUY TICKETS");
});

Deno.test("AC-R-22: a CTA outside the 24-string enum → invalid_cta 422", () => {
  const result = validateRedditCreative({
    type: "IMAGE",
    headline: "ok headline",
    destinationUrl: CANONICAL_URL,
    callToAction: "BUY_TICKETS",
    imageUrl: "https://res.cloudinary.com/mingla/hero.jpg",
  });
  assert(!result.ok);
  assertEquals(result.detail, "invalid_cta");
});

// ── G-4 / AC-R-15…18, 21: targeting allowlist serializer ──────────────────────

Deno.test("G-4: output keys ⊆ allowlist — age and unknown keys are unrepresentable", () => {
  const hostile = serializeRedditTargeting({
    normalized: {
      countries: ["GB", "US"],
      age_min: 21,
      age_max: 35,
      genders: ["female"],
    },
    passthrough: {
      communities: ["r/london", "AskLondon"],
      age_min: 21, // hostile injection via passthrough
      min_age: 18,
      evil_key: "boom",
      __proto__: { hacked: true },
      keywords: ["rooftop bar"],
    },
  });
  assert(hostile.ok);
  for (const key of Object.keys(hostile.targeting)) {
    assert(
      REDDIT_TARGETING_ALLOWLIST.includes(key),
      `serializer emitted non-allowlisted key "${key}"`,
    );
  }
  assertEquals("age_min" in hostile.targeting, false);
  assertEquals("age_max" in hostile.targeting, false);
  assertEquals("min_age" in hostile.targeting, false);
  assertEquals("evil_key" in hostile.targeting, false);
  // The age warning copy is surfaced for the builder (§4.1).
  assert(hostile.warnings.some((w) => w.includes("Reddit can't target by age")));
});

Deno.test("G-4 (property sweep): arbitrary junk keys can never reach the output", () => {
  for (let i = 0; i < 50; i++) {
    const junk: Record<string, unknown> = {
      [`key_${i}`]: i,
      [`AGE_${i}`]: i,
      communities: ["london"],
    };
    const result = serializeRedditTargeting({ normalized: {}, passthrough: junk });
    assert(result.ok);
    for (const key of Object.keys(result.targeting)) {
      assert(REDDIT_TARGETING_ALLOWLIST.includes(key));
    }
  }
});

Deno.test("AC-R-16: gender collapses to FEMALE | MALE | absent(null) — never anything else", () => {
  const female = serializeRedditTargeting({
    normalized: { genders: ["female"] },
    passthrough: {},
  });
  assert(female.ok);
  assertEquals(female.targeting.gender, "FEMALE");

  const unknown = serializeRedditTargeting({
    normalized: { genders: ["nonbinary"] },
    passthrough: {},
  });
  assert(unknown.ok);
  assertEquals("gender" in unknown.targeting, false);
  assert(unknown.warnings.length > 0);

  const multiple = serializeRedditTargeting({
    normalized: { genders: ["male", "female"] },
    passthrough: {},
  });
  assert(multiple.ok);
  assertEquals("gender" in multiple.targeting, false);
});

Deno.test("AC-R-17: communities flow from the passthrough, r/ stripped, politics default", () => {
  const result = serializeRedditTargeting({
    normalized: { countries: ["GB"] },
    passthrough: { communities: ["r/london", "/r/AskLondon", "nyc"] },
  });
  assert(result.ok);
  assertEquals(result.targeting.communities, ["london", "AskLondon", "nyc"]);
  // §4.2 brand-adjacency default applied when the admin sets none.
  assertEquals(result.targeting.excluded_communities, ["politics"]);

  const custom = serializeRedditTargeting({
    normalized: {},
    passthrough: { excluded_communities: ["r/gambling"] },
  });
  assert(custom.ok);
  assertEquals(custom.targeting.excluded_communities, ["gambling"]);
});

Deno.test("AC-R-18: cap 422s name the limit (geos/interests/keywords/excluded/view_modes)", () => {
  const geo = serializeRedditTargeting({
    normalized: { countries: Array.from({ length: 20_001 }, (_, i) => `G${i}`) },
    passthrough: {},
  });
  assert(!geo.ok && geo.message.includes("20000"));

  const interests = serializeRedditTargeting({
    normalized: {},
    passthrough: { interests: Array.from({ length: 201 }, (_, i) => `i${i}`) },
  });
  assert(!interests.ok && interests.message.includes("200"));

  const keywords = serializeRedditTargeting({
    normalized: {},
    passthrough: { keywords: Array.from({ length: 1_001 }, (_, i) => `k${i}`) },
  });
  assert(!keywords.ok && keywords.message.includes("1000"));

  const excluded = serializeRedditTargeting({
    normalized: {},
    passthrough: { excluded_keywords: Array.from({ length: 2_001 }, (_, i) => `x${i}`) },
  });
  assert(!excluded.ok && excluded.message.includes("2000"));

  const viewModes = serializeRedditTargeting({
    normalized: {},
    passthrough: { view_modes: ["ALL", "CARD", "CLASSIC", "COMPACT", "IMMERSIVE", "CARD"] },
  });
  assert(!viewModes.ok && viewModes.message.includes("5"));
});

Deno.test("AC-R-21: defaults locations FEED+COMMENTS_PAGE, view_modes CARD+IMMERSIVE; COMPACT warns", () => {
  const defaults = serializeRedditTargeting({ normalized: {}, passthrough: {} });
  assert(defaults.ok);
  assertEquals(defaults.targeting.locations, ["FEED", "COMMENTS_PAGE"]);
  assertEquals(defaults.targeting.view_modes, ["CARD", "IMMERSIVE"]);
  assertEquals(defaults.targeting.languages, ["EN"]);

  const compact = serializeRedditTargeting({
    normalized: {},
    passthrough: { view_modes: ["COMPACT"] },
  });
  assert(compact.ok);
  assert(compact.warnings.some((w) => w.includes("thumbnail")));

  // excluded_interests is deprecated — warn, never send (§4.2).
  const deprecated = serializeRedditTargeting({
    normalized: {},
    passthrough: { excluded_interests: ["boxing"] },
  });
  assert(deprecated.ok);
  assertEquals("excluded_interests" in deprecated.targeting, false);
  assert(deprecated.warnings.some((w) => w.includes("deprecated")));

  // DESKTOP_LEGACY is stripped with a warning.
  const legacy = serializeRedditTargeting({
    normalized: {},
    passthrough: { platforms: ["DESKTOP_LEGACY", "MOBILE_NATIVE"] },
  });
  assert(legacy.ok);
  assertEquals(legacy.targeting.platforms, ["MOBILE_NATIVE"]);
});

// ── AC-R-19: keyword/geo validations run BEFORE the ad-group create ───────────

Deno.test("AC-R-19: keyword + geo validation calls precede POST /ad_groups; failure blocks", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { calls, restore } = installApiMock((req) => {
      if (req.url.includes("/targeting/keyword_validations")) return jsonResponse({ data: [] });
      if (req.url.includes("/targeting/geolocations_validations")) {
        return jsonResponse({ data: [] });
      }
      if (req.method === "POST" && req.url.endsWith("/ad_groups")) {
        return jsonResponse({ data: { id: "142154364526" } }, 201);
      }
      return jsonResponse({ data: {} });
    });
    try {
      const created = await redditAdapter.createAdSet(CONN, "1684291704682361243", {
        name: "validated group",
        optimizationGoal: "CLICKS",
        billingEvent: "IMPRESSIONS",
        budgetCents: 500,
        targeting: {
          countries: ["GB"],
          passthrough: { reddit: { keywords: ["rooftop bar"], communities: ["london"] } },
        },
      });
      assertEquals(created.externalId, "142154364526");
      const order = calls.map((c) => c.url);
      const keywordIdx = order.findIndex((u) => u.includes("keyword_validations"));
      const geoIdx = order.findIndex((u) => u.includes("geolocations_validations"));
      const createIdx = order.findIndex((u) => u.endsWith("/ad_groups"));
      assert(keywordIdx !== -1 && geoIdx !== -1 && createIdx !== -1);
      assert(keywordIdx < createIdx, "keyword validation must precede the create");
      assert(geoIdx < createIdx, "geo validation must precede the create");
    } finally {
      restore();
    }
  });

  // A validation failure BLOCKS the create — no /ad_groups POST fires.
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { calls, restore } = installApiMock((req) => {
      if (req.url.includes("/targeting/keyword_validations")) {
        return jsonResponse({
          data: [{ keyword: "??", is_valid: false, reason: "invalid characters" }],
        });
      }
      return jsonResponse({ data: { id: "should-not-happen" } });
    });
    try {
      await assertRejects(
        () =>
          redditAdapter.createAdSet(CONN, "1684291704682361243", {
            name: "blocked group",
            optimizationGoal: "CLICKS",
            billingEvent: "IMPRESSIONS",
            budgetCents: 500,
            targeting: {
              countries: ["GB"],
              passthrough: { reddit: { keywords: ["??"] } },
            },
          }),
        AdApiError,
      );
      assertEquals(
        calls.some((c) => c.url.endsWith("/ad_groups")),
        false,
        "a failed keyword validation must block the ad-group create",
      );
    } finally {
      restore();
    }
  });
});

// ── AC-R-20: community search — query= (never q=), cached, backoff on r=0 ─────

Deno.test("G-4/AC-R-20: community search sends query= (NEVER q=) and caches ≥24h", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { calls, restore } = installApiMock(() =>
      jsonResponse({ data: [{ name: "london", subscribers: 1_560_000 }] })
    );
    try {
      const client = await resolveRedditClient(CONN);
      const first = await redditSearchCommunities(client, "london");
      assertEquals(first.fromCache, false);
      const search = calls.find((c) => c.url.includes("/targeting/communities/search"));
      assert(search);
      const url = new URL(search.url);
      assertEquals(url.searchParams.get("query"), "london"); // the R-P6 param
      assertEquals(url.searchParams.has("q"), false, "q= silently no-ops — never send it");

      // Repeat query is served from the cache — no second search call.
      const callCountAfterFirst = calls.length;
      const second = await redditSearchCommunities(client, "LONDON");
      assertEquals(second.fromCache, true);
      assertEquals(calls.length, callCountAfterFirst);
    } finally {
      restore();
    }
  });
});

Deno.test("AC-R-20: a RateLimit r=0 header makes the NEXT call back off to the reset window", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    const sleeps = recordSleeps();
    const { restore } = installApiMock((req) => {
      if (req.url.includes("/targeting/communities/search")) {
        return jsonResponse(
          { data: [] },
          200,
          { RateLimit: '"ads-targeting-taxonomy";r=0;t=30' },
        );
      }
      return jsonResponse({ data: {} });
    });
    try {
      const client = await resolveRedditClient(CONN);
      await redditSearchCommunities(client, "lagos");
      await redditSearchCommunities(client, "manchester"); // different key → real call
      const backoff = sleeps.find((ms) => ms > 25_000 && ms <= 30_000);
      assert(
        backoff !== undefined,
        `expected a ~30s backoff sleep before the next call; got ${JSON.stringify(sleeps)}`,
      );
    } finally {
      restore();
    }
  });
});

Deno.test("rate-limit header parser: minimum remaining wins", () => {
  const parsed = parseRedditRateLimitHeader(
    '"ads-campaign-management-read";r=399;t=42, "ads-targeting-taxonomy";r=3;t=17',
  );
  assertEquals(parsed.remaining, 3);
  assertEquals(parsed.resetSeconds, 17);
  assertEquals(parseRedditRateLimitHeader(null).remaining, null);
});

// ── AC-R-11: the structured-post job state machine ────────────────────────────

Deno.test("AC-R-11: SUCCESS → { postId: t3_, profileId } with capped backoff polling", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    const sleeps = recordSleeps();
    let polls = 0;
    const { calls, restore } = installApiMock((req) => {
      if (req.method === "POST" && req.url.includes("/structured_posts/jobs")) {
        return jsonResponse({ data: { job_id: "job-1", status: "QUEUED" } }, 201);
      }
      if (req.url.includes("/structured_posts/jobs/job-1")) {
        polls++;
        if (polls < 7) return jsonResponse({ data: { status: polls < 3 ? "QUEUED" : "PROCESSING" } });
        return jsonResponse({ data: { status: "SUCCESS", post_id: "t3_abc123" } });
      }
      return jsonResponse({ data: {} });
    });
    try {
      const client = await resolveRedditClient(CONN);
      const result = await redditRunStructuredPostJob(client, "t2_2ikkjswp3a", {
        allow_comments: true,
        creative: { type: "IMAGE" },
      });
      assertEquals(result, { postId: "t3_abc123", profileId: "t2_2ikkjswp3a" });
      // ONE job submission only.
      const submissions = calls.filter(
        (c) => c.method === "POST" && c.url.includes("/structured_posts/jobs"),
      );
      assertEquals(submissions.length, 1);
      // Bounded exponential backoff: 2s → 4s → 8s → 16s → 30s cap.
      const pollSleeps = sleeps.filter((ms) => ms >= 2_000);
      assertEquals(pollSleeps.slice(0, 5), [2_000, 4_000, 8_000, 16_000, 30_000]);
      assert(pollSleeps.every((ms) => ms <= REDDIT_JOB_POLL_CAP_MS));
    } finally {
      restore();
    }
  });
});

Deno.test("AC-R-11: CLIENT_ERROR fails verbatim and the SAME job is never re-submitted", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const providerProse = "The image you provided is too small.";
    const { calls, restore } = installApiMock((req) => {
      if (req.method === "POST" && req.url.includes("/structured_posts/jobs")) {
        return jsonResponse({ data: { job_id: "job-2", status: "QUEUED" } }, 201);
      }
      if (req.url.includes("/structured_posts/jobs/job-2")) {
        return jsonResponse({
          data: {
            status: "CLIENT_ERROR",
            errors: [{ field: "media", message: providerProse }],
          },
        });
      }
      return jsonResponse({ data: {} });
    });
    try {
      const client = await resolveRedditClient(CONN);
      const err = await assertRejects(
        () =>
          redditRunStructuredPostJob(client, "t2_2ikkjswp3a", {
            allow_comments: true,
            creative: { type: "IMAGE" },
          }),
        AdApiError,
      );
      // Verbatim prose, character for character — never regexed or mapped.
      assertStringIncludes(err.message, providerProse);
      const submissions = calls.filter(
        (c) => c.method === "POST" && c.url.includes("/structured_posts/jobs"),
      );
      assertEquals(submissions.length, 1, "CLIENT_ERROR must NEVER resubmit the same job");
    } finally {
      restore();
    }
  });
});

Deno.test("AC-R-11: SERVER_ERROR retries as a NEW job (same config), bounded, then fails", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    let submissionCount = 0;
    const { restore } = installApiMock((req) => {
      if (req.method === "POST" && req.url.includes("/structured_posts/jobs")) {
        submissionCount++;
        return jsonResponse(
          { data: { job_id: `job-${submissionCount}`, status: "QUEUED" } },
          201,
        );
      }
      if (req.url.includes("/structured_posts/jobs/")) {
        return jsonResponse({ data: { status: "SERVER_ERROR" } });
      }
      return jsonResponse({ data: {} });
    });
    try {
      const client = await resolveRedditClient(CONN);
      await assertRejects(
        () =>
          redditRunStructuredPostJob(client, "t2_2ikkjswp3a", {
            allow_comments: true,
            creative: { type: "IMAGE" },
          }),
        AdApiError,
      );
      assertEquals(submissionCount, 3, "1 initial + 2 bounded SERVER_ERROR resubmissions");
    } finally {
      restore();
    }
  });
});

Deno.test("AC-R-11: a SUCCESS payload with no t3_ id fails close (no fabricated ids)", () => {
  assertEquals(extractRedditPostId({ data: { status: "SUCCESS" } }), null);
  assertEquals(extractRedditPostId({ data: { post_id: "not-a-post" } }), null);
  assertEquals(extractRedditPostId({ data: { post_id: "t3_ok" } }), "t3_ok");
  assertEquals(
    extractRedditPostId({ data: { structured_post: { id: "t3_nested" } } }),
    "t3_nested",
  );
});

// ── AC-R-12: the ad body ──────────────────────────────────────────────────────

Deno.test("AC-R-12: ad body — t3_/t2_ patterns enforced; canonical click_url + {{AD_ID}}", () => {
  const body = buildRedditAdBody({
    adGroupExternalId: "142154364526",
    name: "Rooftop party — ad",
    postId: "t3_abc123",
    profileId: "t2_2ikkjswp3a",
    clickUrl: CANONICAL_URL,
    utmCampaign: "11111111-2222-3333-4444-555555555555",
  });
  assertEquals(body.configured_status, "PAUSED"); // G-1 target, third level
  assertEquals(body.post_id, "t3_abc123");
  assertEquals(body.profile_id, "t2_2ikkjswp3a");
  assertEquals(body.click_url, CANONICAL_URL);
  const params = body.click_url_query_parameters as { name: string; value: string }[];
  assert(params.length <= 14);
  assert(params.some((p) => p.name === "utm_source" && p.value === "reddit"));
  assert(params.some((p) => p.name === "utm_content" && p.value === "{{AD_ID}}"));

  // An ad without a resolved t3_ post id is unrepresentable.
  assertThrows(
    () =>
      buildRedditAdBody({
        adGroupExternalId: "142154364526",
        name: "no post",
        postId: "creative-123",
        profileId: "t2_2ikkjswp3a",
        clickUrl: CANONICAL_URL,
      }),
    AdApiError,
  );
  // 15 params → hard block.
  assertThrows(
    () =>
      buildRedditAdBody({
        adGroupExternalId: "142154364526",
        name: "too many params",
        postId: "t3_abc123",
        profileId: "t2_2ikkjswp3a",
        clickUrl: CANONICAL_URL,
        utmCampaign: "c",
        extraQueryParameters: Array.from({ length: 12 }, (_, i) => ({
          name: `p${i}`,
          value: String(i),
        })),
      }),
    AdApiError,
  );
});

// ── AC-R-13 (unit half): launch warning while review gates delivery ───────────

Deno.test("AC-R-13: PENDING/REJECTED/billing states produce a 200-with-warning message", () => {
  assert(redditLaunchWarning("PENDING_APPROVAL")?.includes("review"));
  assert(redditLaunchWarning("REJECTED")?.includes("REJECTED"));
  assert(redditLaunchWarning("PENDING_BILLING_INFO")?.includes("billing"));
  assertEquals(redditLaunchWarning("ACTIVE"), null);
  assertEquals(redditLaunchWarning(null), null);
});

Deno.test("AC-R-13 (unit half): setStatus PATCHes configured_status ACTIVE per level", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { calls, restore } = installApiMock(() => jsonResponse({ data: {} }));
    try {
      await redditAdapter.setStatus(CONN, "campaign", "1684291704682361243", "ACTIVE");
      await redditAdapter.setStatus(CONN, "ad_set", "142154364526", "ACTIVE");
      await redditAdapter.setStatus(CONN, "ad", "987654", "ACTIVE");
      const patches = calls.filter((c) => c.method === "PATCH");
      assertEquals(patches.length, 3);
      assertStringIncludes(patches[0].url, "/campaigns/1684291704682361243");
      assertStringIncludes(patches[1].url, "/ad_groups/142154364526");
      assertStringIncludes(patches[2].url, "/ads/987654");
      for (const patch of patches) {
        const parsed = JSON.parse(patch.body ?? "{}") as { data: Record<string, unknown> };
        assertEquals(parsed.data.configured_status, "ACTIVE");
      }
    } finally {
      restore();
    }
  });
});

// ── AC-R-14: reverse-order PATCH-DELETED rollback + the orphaned post ─────────

Deno.test("AC-R-14: mid-chain failure rolls back ad→ad_group→campaign via PATCH DELETED; orphaned t3_ recorded; NO DELETE verb", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { calls, restore } = installApiMock((req) => {
      if (req.method === "POST" && req.url.endsWith("/campaigns")) {
        return jsonResponse({ data: { id: "1684291704682361243" } }, 201);
      }
      if (req.method === "POST" && req.url.endsWith("/ad_groups")) {
        return jsonResponse({ data: { id: "142154364526" } }, 201);
      }
      if (req.method === "POST" && req.url.includes("/structured_posts/jobs")) {
        return jsonResponse({ data: { job_id: "job-9", status: "QUEUED" } }, 201);
      }
      if (req.url.includes("/structured_posts/jobs/job-9")) {
        return jsonResponse({ data: { status: "SUCCESS", post_id: "t3_orphan" } });
      }
      if (req.method === "POST" && req.url.endsWith("/ads")) {
        return jsonResponse({ error: { message: "ad create exploded" } }, 400);
      }
      if (req.url.includes("/targeting/")) return jsonResponse({ data: [] });
      return jsonResponse({ data: {} });
    });
    try {
      const err = await assertRejects(
        () =>
          redditCreateFullChain(CONN, {
            campaign: { name: "chain campaign", objective: "CLICKS", isCbo: false },
            adGroup: {
              name: "chain group",
              budgetCents: 500,
              startTime: "2026-07-16T00:00:00Z",
              redditPassthrough: { communities: ["london"] },
              normalizedTargeting: { countries: ["GB"] },
            },
            creative: {
              type: "IMAGE",
              headline: "Rooftop tonight",
              destinationUrl: CANONICAL_URL,
              callToAction: "Buy Tickets",
              imageUrl: "https://res.cloudinary.com/mingla/hero.jpg",
            },
            ad: { name: "chain ad", clickUrl: CANONICAL_URL },
          }),
      );
      const failure = (err as { failure: Record<string, unknown> }).failure;
      assertEquals(failure.step, "ad");
      const externalIds = failure.partialExternalIds as Record<string, string>;
      // §7.2: the orphaned post is RECORDED — it cannot be deleted via the ads tree.
      assertEquals(externalIds.orphaned_post_id, "t3_orphan");
      assertEquals(externalIds.profile_id, "t2_2ikkjswp3a");

      // Reverse creation order: ad (nothing created) → ad_group → campaign.
      const deletePatches = calls.filter(
        (c) => c.method === "PATCH" && (c.body ?? "").includes('"DELETED"'),
      );
      assertEquals(deletePatches.length, 2);
      assertStringIncludes(deletePatches[0].url, "/ad_groups/142154364526");
      assertStringIncludes(deletePatches[1].url, "/campaigns/1684291704682361243");

      // R-5: the string DELETE never appears as an HTTP verb.
      assert(calls.every((c) => c.method !== "DELETE"));
    } finally {
      restore();
    }
  });
});

Deno.test("AC-R-14: redditRollbackCreatedEntities is strictly ad → ad_group → campaign", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { calls, restore } = installApiMock(() => jsonResponse({ data: {} }));
    try {
      const client = await resolveRedditClient(CONN);
      const outcome = await redditRollbackCreatedEntities(client, {
        adId: "987654",
        adGroupId: "142154364526",
        campaignId: "1684291704682361243",
      });
      assertEquals(outcome.attempted, ["ad", "ad_set", "campaign"]);
      assertEquals(outcome.failed, []);
      const patches = calls.filter((c) => c.method === "PATCH");
      assertStringIncludes(patches[0].url, "/ads/987654");
      assertStringIncludes(patches[1].url, "/ad_groups/142154364526");
      assertStringIncludes(patches[2].url, "/campaigns/1684291704682361243");
    } finally {
      restore();
    }
  });
});

// ── AC-R-23: copy validator boundaries ────────────────────────────────────────

Deno.test("AC-R-23: headline 301 blocks; 101 and 81 produce the two distinct warns", () => {
  const over300 = validateRedditCopy({ headline: "a".repeat(301) });
  assert(!over300.ok && over300.blocks.some((b) => b.rule === "headline_over_300"));

  const at101 = validateRedditCopy({ headline: "a".repeat(101) });
  assert(at101.ok);
  assert(at101.warnings.some((w) => w.rule === "headline_over_100"));

  const at81 = validateRedditCopy({ headline: "a".repeat(81) });
  assert(at81.ok);
  assert(at81.warnings.some((w) => w.rule === "headline_over_80"));
});

Deno.test("AC-R-23: ALL-CAPS headline blocks (CAPITALIZATION is a literal rejection reason)", () => {
  const shouted = validateRedditCopy({ headline: "THE BEST NIGHT OF YOUR LIFE" });
  assert(!shouted.ok && shouted.blocks.some((b) => b.rule === "headline_all_caps"));
  // A short acronym is fine; a single long shouted word warns but doesn't block.
  assertEquals(redditCapsVerdict("Rooftop party in NYC tonight"), "ok");
  assertEquals(redditCapsVerdict("Party at LOFT tonight with friends"), "warn");
});

Deno.test("AC-R-23: caption 181 / body 40,001 / name 2 & 501 / click_url 5,001 / 15 params block", () => {
  assert(!validateRedditCopy({ caption: "a".repeat(181) }).ok);
  assert(!validateRedditCopy({ body: "a".repeat(40_001) }).ok);
  assert(!validateRedditCopy({ name: "ab" }).ok);
  assert(!validateRedditCopy({ name: "a".repeat(501) }).ok);
  assert(!validateRedditCopy({ clickUrl: `https://usemingla.com/e/${"a".repeat(4_980)}` }).ok);
  assert(!validateRedditCopy({ queryParamCount: 15 }).ok);
  assert(validateRedditCopy({ queryParamCount: 14 }).ok);
});

// ── AC-R-24: destination policy — canonical page, never the OneLink ───────────

Deno.test("AC-R-24: OneLink hosts are blocked with the bridge-page explanation", () => {
  const oneLink = validateRedditDestinationPolicy("https://go.usemingla.com/w36m?pid=reddit");
  assert(!oneLink.ok);
  assertEquals(oneLink.detail, "destination_bridge_page");
  assertStringIncludes(oneLink.message, "BRIDGE_PAGE");

  const bizOneLink = validateRedditDestinationPolicy("https://minglabiz.onelink.me/ZSCW");
  assert(!bizOneLink.ok);
  assertEquals(bizOneLink.detail, "destination_bridge_page");

  const canonical = validateRedditDestinationPolicy(CANONICAL_URL, "usemingla.com");
  assert(canonical.ok);
});

Deno.test("AC-R-24: display_url domain ≠ destination domain → 422", () => {
  const mismatch = validateRedditDestinationPolicy(CANONICAL_URL, "usemingla.co");
  assert(!mismatch.ok);
  assertEquals(mismatch.detail, "display_url_domain_mismatch");
});

Deno.test("AC-R-24: no OneLink can reach a create body (creative + ad builders both reject)", () => {
  assertThrows(
    () =>
      buildRedditStructuredPostJobBody({
        type: "IMAGE",
        headline: "ok",
        destinationUrl: "https://go.usemingla.com/w36m",
        imageUrl: "https://res.cloudinary.com/mingla/hero.jpg",
      }),
    AdApiError,
  );
  assertThrows(
    () =>
      buildRedditAdBody({
        adGroupExternalId: "142154364526",
        name: "onelink ad",
        postId: "t3_abc123",
        profileId: "t2_2ikkjswp3a",
        clickUrl: "https://minglabiz.onelink.me/ZSCW",
      }),
    AdApiError,
  );
});

// ── AC-R-25: creative variant rules ───────────────────────────────────────────

Deno.test("AC-R-25: VIDEO without thumbnail → 422; carousel 0/7 cards → 422 (1–6 [SPEC])", () => {
  const noThumb = validateRedditCreative({
    type: "VIDEO",
    headline: "video ad",
    destinationUrl: CANONICAL_URL,
    videoUrl: "https://res.cloudinary.com/mingla/clip.mp4",
  });
  assert(!noThumb.ok);
  assertEquals(noThumb.detail, "video_thumbnail_required");

  const zeroCards = validateRedditCreative({
    type: "CAROUSEL",
    headline: "carousel",
    destinationUrl: CANONICAL_URL,
    carousel: [],
  });
  assert(!zeroCards.ok && zeroCards.detail === "carousel_card_count");

  const sevenCards = validateRedditCreative({
    type: "CAROUSEL",
    headline: "carousel",
    destinationUrl: CANONICAL_URL,
    carousel: Array.from({ length: 7 }, (_, i) => ({
      imageUrl: `https://res.cloudinary.com/mingla/${i}.jpg`,
    })),
  });
  assert(!sevenCards.ok && sevenCards.detail === "carousel_card_count");

  const oneCard = validateRedditCreative({
    type: "CAROUSEL",
    headline: "carousel",
    destinationUrl: CANONICAL_URL,
    carousel: [{ imageUrl: "https://res.cloudinary.com/mingla/0.jpg" }],
  });
  assert(oneCard.ok, "1 card is valid — the guide's 2–7 is a documented conflict (R-10)");
});

Deno.test("AC-R-25: a [3P] media number produces a WARN, never a block (GR-22)", () => {
  const bigImage = validateRedditCreative({
    type: "IMAGE",
    headline: "big image",
    destinationUrl: CANONICAL_URL,
    imageUrl: "https://res.cloudinary.com/mingla/huge.jpg",
    imageBytes: 10 * 1024 * 1024,
  });
  assert(bigImage.ok, "[3P] limits are warn-only — hard-blocks come only from [SPEC] rows");
  assert(bigImage.warnings.some((w) => w.includes("INVALID_MEDIA")));
});

Deno.test("AC-R-25: INVALID_MEDIA admin copy carries the provider prose character-for-character", () => {
  const prose = "The image you provided is too small.";
  const copy = formatRedditInvalidMediaMessage(prose);
  assertStringIncludes(copy, `'${prose}'`);
  assertStringIncludes(copy, "plain English");
});

// ── AC-R-26: review mapping + verbatim rejection persistence ──────────────────

Deno.test("AC-R-26: effective_status → review_status per §6.1 (unmapped states = unchanged)", () => {
  assertEquals(redditReviewStatusFromEffectiveStatus("PENDING_APPROVAL"), "PENDING");
  assertEquals(redditReviewStatusFromEffectiveStatus("PROCESSING"), "PENDING");
  assertEquals(redditReviewStatusFromEffectiveStatus("REJECTED"), "REJECTED");
  assertEquals(redditReviewStatusFromEffectiveStatus("ACTIVE"), "APPROVED");
  // Billing/identity/permission/paused states leave review_status UNCHANGED.
  for (
    const unchanged of [
      "PENDING_BILLING_INFO",
      "PENDING_ID_VERIFICATION",
      "MISSING_PERMISSIONS",
      "INVALID_DATA_SOURCE",
      "AD_GROUP_PAUSED",
      "CAMPAIGN_PAUSED",
      "PAUSED",
      "COMPLETED",
      "ARCHIVED",
      "DELETED",
    ]
  ) {
    assertEquals(redditReviewStatusFromEffectiveStatus(unchanged), null);
  }
});

Deno.test("AC-R-26: rejection_reason persists VERBATIM — including Reddit's own FACILIATE typo", () => {
  const typo = "FACILIATE_ILLEGAL_FRAUDULENT_OR_MISLEADING_BEHAVIOR";
  const detail = buildRedditReviewDetail({
    issuesInfo: ["NOT_DELIVERING"],
    adReviewFeedback: { rejection_reason: typo, effective_status: "REJECTED" },
  });
  assert(detail !== null);
  // The typo is preserved character for character — never "fixed" (§6.2).
  assertEquals(detail.rejection_reason, typo);
  assertEquals(detail.effective_status, "REJECTED");
  assertEquals(detail.delivery_status, ["NOT_DELIVERING"]);
});

// ── Connect pre-flight (mocked halves of AC-R-1/AC-R-4/AC-R-6) ────────────────

function connectRoutes(overrides: {
  profiles?: unknown[];
  fundingInstruments?: unknown[];
  pixels?: unknown[];
  currency?: string;
} = {}): (req: CapturedRequest) => Response {
  return (req) => {
    if (req.url.endsWith("/me")) return jsonResponse({ data: { id: "t2_2ikkjswp3a" } });
    if (req.url.endsWith("/me/businesses")) {
      return jsonResponse({
        data: [{ id: "950c8eac-da26-45e6-942e-645ed657e43f", name: "Mingla" }],
      });
    }
    if (req.url.includes("/ad_accounts") && req.url.includes("/businesses/")) {
      return jsonResponse({
        data: [{
          id: "a2_jcfwvnfcfqcs",
          name: "Mingla Ad Account 0",
          currency: overrides.currency ?? "USD",
        }],
      });
    }
    if (req.url.endsWith("/profiles")) {
      return jsonResponse({
        data: overrides.profiles ?? [{ id: "t2_2ikkjswp3a", name: "usemingla" }],
      });
    }
    if (req.url.endsWith("/funding_instruments")) {
      return jsonResponse({
        data: overrides.fundingInstruments ??
          [{ id: "1889187", is_servable: true, reasons_not_servable: [] }],
      });
    }
    if (req.url.endsWith("/pixels")) {
      return jsonResponse({ data: overrides.pixels ?? [{ id: "a2_jcfwvnfcfqcs" }] });
    }
    return jsonResponse({ data: {} });
  };
}

Deno.test("connect pre-flight: the 7-step happy path captures profile/funding/pixel (AC-R-1 shape)", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { restore } = installApiMock(connectRoutes());
    try {
      const snapshot = await redditConnectPreflight(null, "consumer");
      assertEquals(snapshot.businessId, "950c8eac-da26-45e6-942e-645ed657e43f");
      assertEquals(snapshot.account.id, "a2_jcfwvnfcfqcs");
      assertEquals(snapshot.profileId, "t2_2ikkjswp3a");
      assertEquals(snapshot.fundingInstrumentId, "1889187");
      assertEquals(snapshot.pixelId, "a2_jcfwvnfcfqcs");
      assertEquals(snapshot.scope, "adsread adsedit");
    } finally {
      restore();
    }
  });
});

Deno.test("AC-R-4: zero profiles → reddit_profile_missing (step-5 fail-close)", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { restore } = installApiMock(connectRoutes({ profiles: [] }));
    try {
      const err = await assertRejects(
        () => redditConnectPreflight(null, "consumer"),
        RedditPreflightError,
      );
      assertEquals(err.errorCode, "reddit_profile_missing");
    } finally {
      restore();
    }
  });
});

Deno.test("AC-R-4: no servable funding → reddit_funding_not_servable with VERBATIM reasons", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { restore } = installApiMock(connectRoutes({
      fundingInstruments: [{
        id: "1889187",
        is_servable: false,
        // The real pre-fix probe values (R-P5).
        reasons_not_servable: ["CREDIT_CARD_NOT_APPROVED", "CREDIT_LINE_EXHAUSTED"],
      }],
    }));
    try {
      const err = await assertRejects(
        () => redditConnectPreflight(null, "consumer"),
        RedditPreflightError,
      );
      assertEquals(err.errorCode, "reddit_funding_not_servable");
      assertEquals(err.reasons, ["CREDIT_CARD_NOT_APPROVED", "CREDIT_LINE_EXHAUSTED"]);
      assertStringIncludes(err.message, "CREDIT_CARD_NOT_APPROVED");
    } finally {
      restore();
    }
  });
});

Deno.test("AC-R-6: a non-8-enum currency (NGN) fails the connection with a named reason", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { restore } = installApiMock(connectRoutes({ currency: "NGN" }));
    try {
      const err = await assertRejects(
        () => redditConnectPreflight(null, "consumer"),
        RedditPreflightError,
      );
      assertEquals(err.errorCode, "reddit_currency_unsupported");
      assertStringIncludes(err.message, "NGN");
    } finally {
      restore();
    }
  });
});

// ── Registry + 401/429 transport behavior ─────────────────────────────────────

Deno.test("registry: getAdapter('reddit') is the live adapter (stub replaced)", () => {
  const adapter = getAdapter("reddit");
  assertEquals(adapter.platform, "reddit");
  assert(typeof adapter.createCreative === "function");
  assert(typeof adapter.rollbackCampaign === "function");
  // §7.2: rollbackCreative is DELIBERATELY absent — a t3_ post is
  // profile-scoped residue the ads tree cannot delete.
  assertEquals(adapter.rollbackCreative, undefined);
});

Deno.test("transport: a 401 re-mints ONCE then fails close 424", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    let mints = 0;
    const { restore } = installFetchMock((req) => {
      if (req.url.includes("/api/v1/access_token")) {
        mints++;
        return jsonResponse(MINT_OK);
      }
      return jsonResponse({ message: "Unauthorized" }, 401);
    });
    try {
      await assertRejects(
        () => redditAdapter.getStatus(CONN, "campaign", "123"),
        AdNotConnectedError,
      );
      assertEquals(mints, 2, "initial mint + exactly one re-mint on 401");
    } finally {
      restore();
    }
  });
});

Deno.test("transport: a 429 backs off to the header reset window and retries once", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    const sleeps = recordSleeps();
    let apiCalls = 0;
    const { restore } = installApiMock(() => {
      apiCalls++;
      if (apiCalls === 1) {
        return jsonResponse({ message: "rate limited" }, 429, {
          RateLimit: '"ads-campaign-management-read";r=0;t=12',
        });
      }
      return jsonResponse({ data: { configured_status: "PAUSED" } });
    });
    try {
      const status = await redditAdapter.getStatus(CONN, "campaign", "123");
      assertEquals(status.status, "PAUSED");
      assert(sleeps.some((ms) => ms > 10_000 && ms <= 12_000), `sleeps: ${sleeps}`);
      assertEquals(apiCalls, 2);
    } finally {
      restore();
    }
  });
});

// ── getStatus / setBudget shapes ──────────────────────────────────────────────

Deno.test("getStatus(ad): raw effective_status + rejection_reason + delivery_status surfaced", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { restore } = installApiMock(() =>
      jsonResponse({
        data: {
          configured_status: "ACTIVE",
          effective_status: "REJECTED",
          rejection_reason: "DATING",
          delivery_status: ["NOT_DELIVERING"],
          preview_url: "https://reddit.com/preview/xyz",
        },
      })
    );
    try {
      const status = await redditAdapter.getStatus(CONN, "ad", "987654");
      assertEquals(status.status, "ACTIVE");
      assertEquals(status.effectiveStatus, "REJECTED");
      assertEquals(status.issuesInfo, ["NOT_DELIVERING"]);
      const feedback = status.adReviewFeedback as Record<string, unknown>;
      assertEquals(feedback.rejection_reason, "DATING");
      assertEquals(feedback.preview_url, "https://reddit.com/preview/xyz");
    } finally {
      restore();
    }
  });
});

Deno.test("setBudget: ad-group PATCH carries goal_value in micro; ad level is unsupported", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    recordSleeps();
    const { calls, restore } = installApiMock(() => jsonResponse({ data: {} }));
    try {
      await redditAdapter.setBudget(CONN, "ad_set", "142154364526", 2000);
      const patch = calls.find((c) => c.method === "PATCH");
      assert(patch);
      const parsed = JSON.parse(patch.body ?? "{}") as { data: Record<string, unknown> };
      assertEquals(parsed.data.goal_value, 20_000_000); // $20.00 → micro
      await assertRejects(
        () => redditAdapter.setBudget(CONN, "ad", "987654", 2000),
        AdApiError,
      );
    } finally {
      restore();
    }
  });
});

// ── Source traps (house pattern — needs --allow-read) ─────────────────────────

Deno.test("source trap: reddit.ts never uses a DELETE verb or a q= search param", async () => {
  const source = await Deno.readTextFile(new URL("../reddit.ts", import.meta.url));
  assert(
    !/method\s*:\s*["'`]DELETE["'`]/.test(source),
    "no DELETE verb exists on Reddit Ads v3 — rollback is PATCH configured_status DELETED (R-5)",
  );
  assert(
    !/[?&"']q=/.test(source),
    "community search must use query= — q= silently no-ops (R-P6)",
  );
});
