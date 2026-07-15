/**
 * ISSUE-867 WP2 — TESTER adversarial suite (mingla-tester, 2026-07-15).
 *
 * Attacks angles the implementor's 41 tests (google.test.ts +
 * issue867_wp2_google_flow.test.ts) do NOT cover:
 *
 *   T-1  Header trio (Authorization Bearer + developer-token +
 *        login-customer-id) present on EVERY googleAdsRequest surface — not
 *        just the atomic mutate: GAQL customer read, geo suggest, setStatus,
 *        getStatus (ad level), setBudget (both wire calls).
 *        fails-on-revert target: deleting the `"login-customer-id"` header
 *        line in googleAdsRequest (google.ts) fails T-1.
 *   T-2  Mixed-lane env resolution: the business lane NEVER falls back to the
 *        consumer credential — with ONLY consumer secrets set, business
 *        resolution fail-closes with google_not_provisioned and zero wire
 *        calls; the business default token env NAME is the MINGLABIZ_ name.
 *   T-3  Micros overflow / money adversarial THROUGH the Google builder:
 *        cents past MAX_BUDGET_CENTS (QA P3-9 integer-precision bound), NaN,
 *        Infinity, non-integer, zero, negative — all throw; the boundary
 *        value converts exactly with int64-string encoding.
 *   T-4  finalUrls/tracking-template swap + URL injection: the OneLink can
 *        never reach the ad object; byte-cap boundary (2,084 exact) measured
 *        in BYTES (multi-byte UTF-8 counted correctly); hostile schemes
 *        rejected. Source trap: the edge fn assigns finalUrl ONLY from the
 *        view-resolved dest_url and never reads a caller-supplied final_urls/
 *        tracking_url_template.
 *   T-5  REMOVED-never, deeper: hostile strings (platform vocabulary
 *        "ENABLED"/"REMOVED", lowercase, "DELETED") through the status writer
 *        AND the per-level operation builder; adapter.setStatus with a
 *        hostile cast performs ZERO status-mutate wire calls; an atomic
 *        create request contains ONLY `create` operations (no update/remove
 *        op keys anywhere).
 *   T-6  GR-52 checker adversarial: DB-read exceptions PROPAGATE (the
 *        fail-open policy lives in the sync fn, where the next sweep
 *        retries — the checker itself never swallows); page-type matching is
 *        exact (case variants fail closed). Source trap: the sync fn's GR-52
 *        block is channel-generic — no platform conditional gates the
 *        destination re-check (Meta campaigns are re-checked too).
 *   T-7  RSA validator adversarial: non-string/whitespace entries; exact
 *        boundary PASSES (30-char headline, 90-char description, 15/4
 *        counts); trailing-whitespace trimming.
 *   T-8  Keyword adversarial: exact 80-char / 10-word boundaries PASS;
 *        hostile entry shapes rejected; camelCase matchType accepted.
 *   T-9  Zero-fabrication: a mutate 200 whose response is missing the
 *        adGroupAd resource name REFUSES to return ids (no unverifiable
 *        persist); hostile composite ids are rejected (GAQL injection via
 *        the ~composite).
 *   T-10 normalizeGoogleError resilience: null/garbage payloads never throw;
 *        requestId recovered from a later detail; secrets scrubbed from
 *        detail messages.
 *
 * Append-only: no existing test file is modified.
 * Run: deno test --allow-env --allow-read supabase/functions/_shared/__tests__/issue867_wp2_tester_adversarial.test.ts
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
  type DestinationQueryClient,
  destinationStillPublicLive,
  MAX_BUDGET_CENTS,
} from "../adChannel.ts";
import {
  buildGoogleMutateOperations,
  buildGoogleMutateRequest,
  buildGoogleStatusUpdateOperation,
  gaqlForStatus,
  googleAdapter,
  type GoogleCreateFullCampaignInput,
  googleCreateFullCampaign,
  googleDefaultTokenEnvVar,
  googleFetchCustomer,
  googleStatusForAdvertiserStatus,
  normalizeGoogleError,
  normalizeGoogleKeywords,
  resetGoogleTokenCacheForTests,
  resolveGoogleClient,
  resolveGoogleEnvConfig,
  suggestGeoTargetConstants,
  validateGoogleFinalUrl,
  validateGoogleRsa,
} from "../google.ts";

const CONSUMER_ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "test-dev-token",
  GOOGLE_ADS_REFRESH_TOKEN: "test-refresh-token",
  GOOGLE_ADS_OAUTH_CLIENT_ID: "test-client-id",
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: "test-client-secret",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "8284700017",
  GOOGLE_ADS_CUSTOMER_ID: "3623860476",
} as const;

const BUSINESS_ENV_NAMES = [
  "GOOGLE_ADS_MINGLABIZ_DEVELOPER_TOKEN",
  "GOOGLE_ADS_MINGLABIZ_REFRESH_TOKEN",
  "GOOGLE_ADS_MINGLABIZ_OAUTH_CLIENT_ID",
  "GOOGLE_ADS_MINGLABIZ_OAUTH_CLIENT_SECRET",
  "GOOGLE_ADS_MINGLABIZ_LOGIN_CUSTOMER_ID",
  "GOOGLE_ADS_MINGLABIZ_CUSTOMER_ID",
];

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-000000000002",
  platform: "google",
  lane: "consumer",
  display_name: "Google Ads · Consumer",
  external_account_id: "3623860476",
  external_org_id: "8284700017",
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

const BIZ_CONN: AdConnectionRow = {
  ...CONN,
  id: "00000000-0000-0000-0000-000000000003",
  lane: "business",
  display_name: "Google Ads · Business",
  token_env_var: "GOOGLE_ADS_MINGLABIZ_REFRESH_TOKEN",
};

const CREATE_INPUT: GoogleCreateFullCampaignInput = {
  name: "Adversarial",
  dailyBudgetCents: 2000,
  finalUrl: "https://usemingla.com/e/b/e",
  trackingUrlTemplate: "https://go.usemingla.com/w36m?pid=google_ads&af_r={lpurl}",
  headlines: ["H one", "H two", "H three"],
  descriptions: ["Description one.", "Description two."],
  keywords: [{ text: "events", matchType: "PHRASE" }],
  geoTargetCriterionIds: ["2826"],
};

function withEnv(
  values: Record<string, string>,
  unset: string[],
  fn: () => void | Promise<void>,
): () => Promise<void> {
  return async () => {
    const touched = [...Object.keys(values), ...unset];
    const prior = new Map<string, string | undefined>();
    for (const name of touched) prior.set(name, Deno.env.get(name));
    for (const name of unset) Deno.env.delete(name);
    for (const [name, value] of Object.entries(values)) Deno.env.set(name, value);
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

interface WireCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function withMockWire(
  handler: (url: string) => Response,
  fn: (calls: WireCall[]) => Promise<void>,
): (calls?: WireCall[]) => Promise<void> {
  return async () => {
    const calls: WireCall[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({
        url,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(String(init.body).startsWith("{") ? String(init.body) : "null") : null,
      });
      return Promise.resolve(handler(url));
    }) as typeof fetch;
    try {
      await fn(calls);
    } finally {
      globalThis.fetch = originalFetch;
      resetGoogleTokenCacheForTests();
    }
  };
}

const ok = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json", "request-id": "adv-req" },
  });

function wireHandler(url: string): Response {
  if (url.includes("oauth2.googleapis.com")) {
    return ok({ access_token: "ya29.adversarial", expires_in: 3600 });
  }
  if (url.endsWith("geoTargetConstants:suggest")) {
    return ok({
      geoTargetConstantSuggestions: [{
        geoTargetConstant: {
          resourceName: "geoTargetConstants/1006886",
          id: "1006886",
          name: "London",
          countryCode: "GB",
          targetType: "City",
          status: "ENABLED",
          canonicalName: "London,England,United Kingdom",
        },
      }],
    });
  }
  if (url.endsWith("googleAds:search")) {
    return ok({
      results: [{
        customer: { id: "3623860476", status: "ENABLED", currencyCode: "USD", testAccount: false },
        campaign: { id: "222", status: "PAUSED", campaignBudget: "customers/3623860476/campaignBudgets/111" },
        adGroupAd: { status: "PAUSED", policySummary: { approvalStatus: "APPROVED", reviewStatus: "REVIEWED" } },
      }],
    });
  }
  return ok({ results: [{ resourceName: "mock" }] });
}

/** Asserts the G-P3 header trio on one recorded wire call. */
function assertHeaderTrio(call: WireCall, label: string): void {
  assert(
    String(call.headers.Authorization ?? "").startsWith("Bearer "),
    `${label}: Authorization Bearer header missing (${call.url})`,
  );
  assertEquals(
    call.headers["developer-token"],
    "test-dev-token",
    `${label}: developer-token header missing (${call.url})`,
  );
  // login-customer-id MUST be the MCC, digits only, on EVERY Google Ads API
  // call — a missing header is AuthorizationError.USER_PERMISSION_DENIED on
  // the live API (SPEC §4.0b). fails-on-revert: deleting the header line in
  // googleAdsRequest fails here.
  assertEquals(
    call.headers["login-customer-id"],
    "8284700017",
    `${label}: login-customer-id header missing/wrong (${call.url})`,
  );
}

// ── T-1: header trio on EVERY googleAdsRequest surface ────────────────────────

Deno.test(
  "T-1: Bearer + developer-token + login-customer-id ride on EVERY Google Ads call (GAQL, suggest, setStatus, getStatus, setBudget)",
  withEnv({ ...CONSUMER_ENV }, [], async () => {
    await withMockWire(wireHandler, async (calls) => {
      const client = await resolveGoogleClient(CONN);
      await googleFetchCustomer(client);
      await suggestGeoTargetConstants(client, { name: "London", countryCode: "GB" });
      await googleAdapter.setStatus(CONN, "campaign", "222", "PAUSED");
      await googleAdapter.getStatus(CONN, "ad", "333~444");
      await googleAdapter.setBudget(CONN, "campaign", "222", 2000);
      const apiCalls = calls.filter((c) => !c.url.includes("oauth2.googleapis.com"));
      // customer GAQL + suggest + campaigns:mutate + ad GAQL + budget GAQL + campaignBudgets:mutate
      assertEquals(apiCalls.length, 6, `expected 6 Google Ads API calls, got ${apiCalls.length}`);
      for (const call of apiCalls) assertHeaderTrio(call, "T-1");
      // The OAuth mint must NOT leak the ads headers (the token endpoint is not Google Ads).
      const mint = calls.find((c) => c.url.includes("oauth2.googleapis.com"));
      assert(mint && !("developer-token" in mint.headers), "mint call must not carry the developer token");
    })();
  }),
);

// ── T-2: mixed-lane env resolution ────────────────────────────────────────────

Deno.test(
  "T-2: business lane NEVER falls back to consumer secrets — fail-close with zero wire calls",
  withEnv({ ...CONSUMER_ENV }, BUSINESS_ENV_NAMES, async () => {
    // The business default token env NAME is the MINGLABIZ_ name (house rule).
    assertEquals(googleDefaultTokenEnvVar("business"), "GOOGLE_ADS_MINGLABIZ_REFRESH_TOKEN");
    assertEquals(googleDefaultTokenEnvVar("consumer"), "GOOGLE_ADS_REFRESH_TOKEN");
    // With ONLY consumer secrets set, business resolution must fail-close…
    const err = assertThrows(
      () => resolveGoogleEnvConfig(null, "business"),
      AdNotConnectedError,
    );
    assertEquals(err.detail, "google_not_provisioned");
    // …and a business CONNECTION ROW must fail-close with ZERO network calls.
    const originalFetch = globalThis.fetch;
    let wireCalls = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      wireCalls += 1;
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      await assertRejects(() => googleAdapter.connect(BIZ_CONN), AdNotConnectedError);
      await assertRejects(
        () => googleAdapter.setStatus(BIZ_CONN, "campaign", "222", "PAUSED"),
        AdNotConnectedError,
      );
      assertEquals(wireCalls, 0, "a business row with unprovisioned secrets must never reach the wire");
    } finally {
      globalThis.fetch = originalFetch;
      resetGoogleTokenCacheForTests();
    }
  }),
);

Deno.test(
  "T-2b: business secrets set + consumer UNSET — business resolves, consumer still fail-closes (no reverse bleed)",
  withEnv(
    {
      GOOGLE_ADS_MINGLABIZ_DEVELOPER_TOKEN: "biz-dev-token",
      GOOGLE_ADS_MINGLABIZ_REFRESH_TOKEN: "biz-refresh-token",
      GOOGLE_ADS_MINGLABIZ_OAUTH_CLIENT_ID: "biz-client-id",
      GOOGLE_ADS_MINGLABIZ_OAUTH_CLIENT_SECRET: "biz-client-secret",
      GOOGLE_ADS_MINGLABIZ_LOGIN_CUSTOMER_ID: "111-222-3333",
      GOOGLE_ADS_MINGLABIZ_CUSTOMER_ID: "444-555-6666",
    },
    Object.keys(CONSUMER_ENV),
    () => {
      const biz = resolveGoogleEnvConfig(null, "business");
      assertEquals(biz.developerToken, "biz-dev-token");
      assertEquals(biz.loginCustomerId, "1112223333"); // dashes stripped per lane too
      assertEquals(biz.customerId, "4445556666");
      const err = assertThrows(() => resolveGoogleEnvConfig(null, "consumer"), AdNotConnectedError);
      assertEquals(err.detail, "google_not_provisioned");
    },
  ),
);

// ── T-3: micros overflow / money adversarial through the builder ──────────────

Deno.test("T-3: budget cents past MAX_BUDGET_CENTS throws — the ×10,000 conversion may never lose integer precision (QA P3-9)", () => {
  assertThrows(
    () => buildGoogleMutateOperations("3623860476", { ...CREATE_INPUT, dailyBudgetCents: MAX_BUDGET_CENTS + 1 }),
    Error,
    "MAX_BUDGET_CENTS",
  );
  assertThrows(
    () => buildGoogleMutateOperations("3623860476", { ...CREATE_INPUT, cpcBidCents: MAX_BUDGET_CENTS + 1 }),
    Error,
    "MAX_BUDGET_CENTS",
  );
  for (const hostile of [0, -1, 1.5, NaN, Infinity]) {
    assertThrows(
      () => buildGoogleMutateOperations("3623860476", { ...CREATE_INPUT, dailyBudgetCents: hostile }),
      Error,
      undefined,
      `dailyBudgetCents=${hostile} must throw`,
    );
  }
  // The boundary itself converts EXACTLY, as an int64 string.
  const ops = buildGoogleMutateOperations("3623860476", {
    ...CREATE_INPUT,
    dailyBudgetCents: MAX_BUDGET_CENTS,
  });
  const budget = (ops[0].campaignBudgetOperation as Record<string, unknown>)
    .create as Record<string, unknown>;
  assertEquals(budget.amountMicros, String(MAX_BUDGET_CENTS * 10_000));
  assert(Number.isSafeInteger(MAX_BUDGET_CENTS * 10_000), "boundary conversion must be integer-exact");
});

// ── T-4: finalUrls/tracking swap + URL injection ──────────────────────────────

Deno.test("T-4: the OneLink structurally cannot reach the ad object; the canonical URL cannot reach the tracking slot", () => {
  const ops = buildGoogleMutateOperations("3623860476", CREATE_INPUT);
  const adOp = ops.find((op) => "adGroupAdOperation" in op) as Record<string, unknown>;
  const adJson = JSON.stringify(adOp);
  assert(!adJson.includes("go.usemingla.com"), "OneLink leaked into the ad operation");
  assert(!adJson.includes("trackingUrlTemplate"), "tracking template leaked into the ad operation");
  const campaignOp = ops.find((op) => "campaignOperation" in op) as Record<string, unknown>;
  const campaign = (campaignOp.campaignOperation as Record<string, unknown>).create as Record<string, unknown>;
  assertEquals(campaign.trackingUrlTemplate, CREATE_INPUT.trackingUrlTemplate);
  assert(!("finalUrls" in campaign), "finalUrls must never sit on the campaign");
  // With NO tracking template, the key is absent entirely (never an empty string).
  const bare = buildGoogleMutateOperations("3623860476", { ...CREATE_INPUT, trackingUrlTemplate: undefined });
  const bareCampaign = ((bare.find((op) => "campaignOperation" in op) as Record<string, unknown>)
    .campaignOperation as Record<string, unknown>).create as Record<string, unknown>;
  assert(!("trackingUrlTemplate" in bareCampaign));
});

Deno.test("T-4b: final-URL validator — exact 2,084-BYTE boundary, multi-byte counting, hostile schemes", () => {
  const prefix = "https://usemingla.com/";
  const exact = prefix + "x".repeat(2084 - prefix.length);
  assertEquals(new TextEncoder().encode(exact).length, 2084);
  assertEquals(validateGoogleFinalUrl(exact).ok, true, "exactly 2,084 bytes must pass");
  const over = exact + "x";
  assert(!validateGoogleFinalUrl(over).ok, "2,085 bytes must fail");
  // Multi-byte: 600 × '€' (3 bytes each) blows the BYTE cap while the string
  // LENGTH (622) sits far under 2,084 — a char-counting validator passes this.
  const multibyte = prefix + "€".repeat(600) + "x".repeat(400);
  assert(
    !validateGoogleFinalUrl(multibyte).ok,
    "byte cap must be measured in BYTES — multi-byte URL slipped through",
  );
  for (const hostile of ["javascript:alert(1)", "data:text/html,x", "//usemingla.com/e", "http://usemingla.com/e", "ftp://x", ""]) {
    assert(!validateGoogleFinalUrl(hostile).ok, `hostile URL "${hostile}" must fail`);
  }
});

Deno.test("T-4c: source trap — the edge fn's google finalUrl comes ONLY from the view-resolved dest_url; no caller-supplied final/tracking override is read", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assert(source.includes("finalUrl: destUrlG"), "google finalUrl must be assigned from destUrlG (view-resolved)");
  assert(!/body\.final_urls|body\.finalUrls|creative\.final_url|body\.tracking_url_template|body\.trackingUrlTemplate/.test(source),
    "the request body must not be able to supply final URLs or a tracking template");
  assert(source.includes("trackingUrlTemplate = buildGoogleTrackingUrlTemplate("),
    "the tracking template must be server-built, never caller-supplied");
});

// ── T-5: REMOVED-never — deeper hostile paths ─────────────────────────────────

Deno.test("T-5: hostile status strings through the writer AND the per-level operation builder all throw", () => {
  for (const hostile of ["REMOVED", "removed", "ENABLED", "enabled", "DELETED", "ARCHIVED", "", "paused "]) {
    assertThrows(
      () => googleStatusForAdvertiserStatus(hostile as AdvertiserStatus),
      AdApiError,
      undefined,
      `status writer accepted hostile "${hostile}"`,
    );
    assertThrows(
      () => buildGoogleStatusUpdateOperation("3623860476", "campaign", "222", hostile as AdvertiserStatus),
      AdApiError,
      undefined,
      `operation builder accepted hostile "${hostile}"`,
    );
  }
});

Deno.test(
  "T-5b: adapter.setStatus with a hostile cast performs ZERO status-mutate wire calls",
  withEnv({ ...CONSUMER_ENV }, [], async () => {
    await withMockWire(wireHandler, async (calls) => {
      await assertRejects(
        () => googleAdapter.setStatus(CONN, "campaign", "222", "REMOVED" as AdvertiserStatus),
        AdApiError,
      );
      const mutates = calls.filter((c) => c.url.includes(":mutate"));
      assertEquals(mutates.length, 0, "a hostile status must throw BEFORE any mutate reaches the wire");
    })();
  }),
);

Deno.test("T-5c: an atomic create request contains ONLY `create` operations — no update/remove op keys anywhere", () => {
  const request = buildGoogleMutateRequest("3623860476", {
    ...CREATE_INPUT,
    negativeKeywords: [{ text: "free", matchType: "BROAD" }],
  });
  for (const op of request.mutateOperations as Record<string, unknown>[]) {
    const operation = Object.values(op)[0] as Record<string, unknown>;
    assertEquals(Object.keys(operation), ["create"], `op ${Object.keys(op)[0]} must carry ONLY create`);
  }
  const blast = JSON.stringify(request);
  assert(!blast.includes('"remove"'), "no remove op may exist in a create request");
  assert(!blast.includes('"update"'), "no update op may exist in a create request");
  assert(!blast.includes("REMOVED"));
});

// ── T-6: GR-52 checker adversarial ────────────────────────────────────────────

Deno.test("T-6: a throwing DB read PROPAGATES out of destinationStillPublicLive — the checker never swallows (fail-open lives in the sync fn, which retries next sweep)", async () => {
  const throwingDb: DestinationQueryClient = {
    from() {
      throw new Error("transient view error");
    },
  };
  await assertRejects(
    () =>
      destinationStillPublicLive(throwingDb, {
        dest_page_type: "event",
        dest_brand_slug: "b",
        dest_entity_slug: "e",
      }),
    Error,
    "transient view error",
  );
});

Deno.test("T-6b: page-type matching is EXACT — case variants fail closed with zero queries", async () => {
  const queries: string[] = [];
  const db: DestinationQueryClient = {
    from(table: string) {
      queries.push(table);
      const chain = {
        eq: () => chain,
        in: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "x" } }) }),
        maybeSingle: () => Promise.resolve({ data: { id: "x" } }),
      };
      return { select: () => chain };
    },
  };
  for (const hostile of ["Event", "EVENT", "Brand", " brand", "event "]) {
    const okResult = await destinationStillPublicLive(db, {
      dest_page_type: hostile,
      dest_brand_slug: "b",
      dest_entity_slug: "e",
    });
    assertEquals(okResult, false, `page type "${hostile}" must fail closed`);
  }
  assertEquals(queries.length, 0, "hostile page types must never reach the DB");
});

Deno.test("T-6c: source trap — the sync fn's GR-52 re-check is channel-generic (no platform conditional gates it)", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-campaign-sync/index.ts", import.meta.url),
  );
  const start = source.indexOf("GR-52 destination re-checker (channel-generic");
  assert(start > -1, "GR-52 block missing from admin-ad-campaign-sync");
  const end = source.indexOf("synced.push", start);
  assert(end > start, "GR-52 block shape changed — re-verify channel genericity");
  const block = source.slice(start, end);
  assert(block.includes("destinationStillPublicLive("), "the sync must call the shared checker");
  assert(
    !/platform\s*===/.test(block),
    "the GR-52 re-check must NOT be gated on a platform — Meta campaigns are re-checked too",
  );
});

// ── T-7: RSA validator adversarial ────────────────────────────────────────────

Deno.test("T-7: non-string / whitespace-only RSA entries are rejected; exact boundaries PASS", () => {
  for (const hostile of [[1, 2, 3], [null, "a", "b"], [{}, "a", "b"], ["ok", "ok2", "   "]]) {
    const r = validateGoogleRsa(hostile, ["Description one.", "Description two."]);
    assert(!r.ok, `hostile headlines ${JSON.stringify(hostile)} must be rejected`);
  }
  const r2 = validateGoogleRsa(["A", "B", "C"], ["ok.", null]);
  assert(!r2.ok && r2.detail === "rsa_descriptions_invalid");
  // Exact boundary PASSES: 30-char headline, 90-char description, 15 heads, 4 descs.
  const h30 = "x".repeat(30);
  const d90 = "y".repeat(90);
  const pass = validateGoogleRsa(
    [h30, ...Array.from({ length: 14 }, (_, i) => `H ${i}`)],
    [d90, "second description.", "third description.", "fourth description."],
  );
  assertEquals(pass.ok, true, "exact G-4 boundaries (30/90 chars, 15/4 counts) must pass");
  // Trailing whitespace is trimmed before measuring.
  const padded = validateGoogleRsa([`${h30}   `, "B", "C"], [d90, "ok."]);
  assertEquals(padded.ok, true, "trailing whitespace must not overflow the cap");
});

// ── T-8: keyword adversarial ──────────────────────────────────────────────────

Deno.test("T-8: exact keyword boundaries PASS (80 chars / 10 words); hostile shapes rejected; camelCase matchType accepted", () => {
  const exact80 = "k".repeat(80);
  const r80 = normalizeGoogleKeywords([exact80]);
  assert(r80.ok, "an exactly-80-char keyword must pass");
  const words10 = "a b c d e f g h i j";
  const r10 = normalizeGoogleKeywords([words10]);
  assert(r10.ok, "an exactly-10-word keyword must pass");
  for (const hostile of [[123], [{ text: 123 }], [{ match_type: "PHRASE" }], [""], ["   "]]) {
    const r = normalizeGoogleKeywords(hostile as unknown[]);
    assert(!r.ok, `hostile keyword ${JSON.stringify(hostile)} must be rejected`);
  }
  const camel = normalizeGoogleKeywords([{ text: "ok", matchType: "broad" }]);
  assert(camel.ok);
  assertEquals(camel.keywords[0].matchType, "BROAD");
});

// ── T-9: zero-fabrication + composite-id injection ────────────────────────────

Deno.test(
  "T-9: a 200 mutate response MISSING resource names refuses to fabricate ids (no unverifiable persist)",
  withEnv({ ...CONSUMER_ENV }, [], async () => {
    await withMockWire(
      (url) =>
        url.includes("oauth2.googleapis.com")
          ? ok({ access_token: "ya29.adversarial", expires_in: 3600 })
          : ok({
            mutateOperationResponses: [
              { campaignBudgetResult: { resourceName: "customers/3623860476/campaignBudgets/111" } },
              { campaignResult: { resourceName: "customers/3623860476/campaigns/222" } },
              // adGroupResult + adGroupAdResult MISSING — a lying/partial payload
            ],
          }),
      async () => {
        const err = await assertRejects(
          () => googleCreateFullCampaign(CONN, CREATE_INPUT),
          AdApiError,
        );
        assert(
          String(err.message).includes("refusing to persist"),
          "a partial mutate payload must refuse, not fabricate ids",
        );
      },
    )();
  }),
);

Deno.test("T-9b: hostile composite ids are rejected before any GAQL (injection via the ~composite)", () => {
  for (const hostile of ["333~444~555", "1~1 OR 1=1", "abc~def", "333~", "~444", "333", ""]) {
    assertThrows(
      () => gaqlForStatus("ad", hostile),
      AdApiError,
      undefined,
      `composite "${hostile}" must be rejected`,
    );
  }
  // And a valid composite splits into BOTH GAQL predicates.
  const q = gaqlForStatus("ad", "333~444");
  assert(q.includes("ad_group.id = 333") && q.includes("ad_group_ad.ad.id = 444"));
});

// ── T-10: normalizeGoogleError resilience ─────────────────────────────────────

Deno.test("T-10: garbage payloads never throw; requestId recovered from later details; secrets scrubbed from detail messages", () => {
  for (const garbage of [null, undefined, 42, "x", [], {}, { error: null }, { error: { details: "not-an-array" } }]) {
    const n = normalizeGoogleError(garbage);
    assertEquals(n.message, "Google Ads API error");
  }
  const n = normalizeGoogleError({
    error: {
      status: "PERMISSION_DENIED",
      message: "outer",
      details: [
        { errors: [{ errorCode: { authorizationError: "USER_PERMISSION_DENIED" }, message: "leaky ya29.SECRET-TOKEN-VALUE here" }] },
        { requestId: "later-request-id" },
      ],
    },
  });
  assertEquals(n.request_id, "later-request-id");
  assertEquals(n.subcode, "authorizationError.USER_PERMISSION_DENIED");
  assert(!n.message.includes("ya29."), "detail message must be scrubbed");
  assert(n.message.includes("[redacted]"));
});
