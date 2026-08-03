/**
 * ISSUE-867 WP2 — google flow + GR-52 destination re-checker tests.
 *
 * Covers:
 *   - googleCreateFullCampaign end-to-end against a mocked network: OAuth mint
 *     then ONE `googleAds:mutate` POST carrying Authorization Bearer,
 *     developer-token, and login-customer-id (digits) headers with
 *     partialFailure:false; the parsed result carries the numeric campaign /
 *     ad-group ids and the `{ad_group_id}~{ad_id}` composite ad id.
 *   - validateOnly passthrough: same wire body with validateOnly:true, result
 *     `validated:true`, NO ids fabricated (Constitution #9).
 *   - GR-52 destinationStillPublicLive: the exact view names + status filter
 *     the create gate uses (business_public_events_view, scheduled|live;
 *     business_public_brands_view), event/brand/unknown page types, fail-close
 *     on unknown types.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/issue867_wp2_google_flow.test.ts
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type AdConnectionRow,
  type DestinationQueryClient,
  destinationStillPublicLive,
} from "../adChannel.ts";
import {
  googleCreateFullCampaign,
  type GoogleCreateFullCampaignInput,
  resetGoogleTokenCacheForTests,
} from "../google.ts";

// ── Shared fixtures ───────────────────────────────────────────────────────────

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

const CREATE_INPUT: GoogleCreateFullCampaignInput = {
  name: "Flow Test Campaign",
  dailyBudgetCents: 2000,
  finalUrl: "https://usemingla.com/e/test-brand/test-event",
  trackingUrlTemplate:
    "https://go.usemingla.com/w36m?pid=google_ads&af_c_id={campaignid}&af_r={lpurl}",
  headlines: ["Book Test Event", "Live in London", "Reserve Your Spot"],
  descriptions: ["A real Mingla event.", "Reserve now."],
  keywords: [{ text: "events in london", matchType: "PHRASE" }],
  geoTargetCriterionIds: ["1006886"],
};

const GOOGLE_ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "test-dev-token",
  GOOGLE_ADS_REFRESH_TOKEN: "test-refresh-token",
  GOOGLE_ADS_OAUTH_CLIENT_ID: "test-client-id",
  GOOGLE_ADS_OAUTH_CLIENT_SECRET: "test-client-secret",
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: "8284700017",
  GOOGLE_ADS_CUSTOMER_ID: "3623860476",
} as const;

function withEnvAndFetch(
  handler: (url: string, init: RequestInit | undefined, calls: RecordedCall[]) => Response,
  fn: (calls: RecordedCall[]) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const prior = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(GOOGLE_ENV)) {
      prior.set(name, Deno.env.get(name));
      Deno.env.set(name, value);
    }
    resetGoogleTokenCacheForTests();
    const calls: RecordedCall[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, init });
      return Promise.resolve(handler(url, init, calls));
    }) as typeof fetch;
    try {
      await fn(calls);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [name, value] of prior) {
        if (value !== undefined) Deno.env.set(name, value);
        else Deno.env.delete(name);
      }
      resetGoogleTokenCacheForTests();
    }
  };
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function mintResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: "ya29.flow-test", expires_in: 3600 }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function mutateResponse(): Response {
  return new Response(
    JSON.stringify({
      mutateOperationResponses: [
        { campaignBudgetResult: { resourceName: "customers/3623860476/campaignBudgets/111" } },
        { campaignResult: { resourceName: "customers/3623860476/campaigns/222" } },
        { campaignCriterionResult: { resourceName: "customers/3623860476/campaignCriteria/222~301" } },
        { adGroupResult: { resourceName: "customers/3623860476/adGroups/333" } },
        { adGroupAdResult: { resourceName: "customers/3623860476/adGroupAds/333~444" } },
        { adGroupCriterionResult: { resourceName: "customers/3623860476/adGroupCriteria/333~501" } },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json", "request-id": "req-flow-1" } },
  );
}

// ── googleCreateFullCampaign — the atomic create against a mocked wire ────────

Deno.test(
  "atomic create: ONE mutate POST with the G-P3 headers; ids parsed incl. the ~composite",
  withEnvAndFetch(
    (url) => url.includes("oauth2.googleapis.com") ? mintResponse() : mutateResponse(),
    async (calls) => {
      const result = await googleCreateFullCampaign(CONN, CREATE_INPUT);
      // Exactly two wire calls: the OAuth mint, then ONE atomic mutate.
      assertEquals(calls.length, 2);
      const mutateCall = calls[1];
      assert(
        mutateCall.url.endsWith("/v24/customers/3623860476/googleAds:mutate"),
        `mutate went to ${mutateCall.url}`,
      );
      const headers = mutateCall.init?.headers as Record<string, string>;
      assertEquals(headers["developer-token"], "test-dev-token");
      assertEquals(headers["login-customer-id"], "8284700017"); // digits only
      assert(String(headers.Authorization).startsWith("Bearer "));
      const body = JSON.parse(String(mutateCall.init?.body)) as Record<string, unknown>;
      assertEquals(body.partialFailure, false); // native atomicity — A1.1(4)
      assertEquals(body.validateOnly, false);
      assertEquals(result.validated, false);
      assertEquals(result.externalCampaignId, "222");
      assertEquals(result.externalAdSetId, "333");
      assertEquals(result.externalAdId, "333~444"); // the {ad_group_id}~{ad_id} composite
      assertEquals(result.budgetResourceName, "customers/3623860476/campaignBudgets/111");
      assertEquals(result.requestId, "req-flow-1"); // audit-row bound (A1.1(4))
    },
  ),
);

Deno.test(
  "validateOnly passthrough: same wire body with validateOnly:true; validated:true; NO ids fabricated",
  withEnvAndFetch(
    (url) =>
      url.includes("oauth2.googleapis.com")
        ? mintResponse()
        : new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json", "request-id": "req-validate-1" },
        }),
    async (calls) => {
      const result = await googleCreateFullCampaign(CONN, {
        ...CREATE_INPUT,
        validateOnly: true,
      });
      const body = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown>;
      assertEquals(body.validateOnly, true);
      assertEquals(body.partialFailure, false);
      assertEquals(result.validated, true);
      // Constitution #9: a validate-only run created NOTHING — no fabricated ids.
      assertEquals(result.externalCampaignId, "");
      assertEquals(result.externalAdSetId, "");
      assertEquals(result.externalAdId, "");
      assertEquals(result.requestId, "req-validate-1");
    },
  ),
);

// ── GR-52: destinationStillPublicLive — the sync re-checker's gate ────────────

interface RecordedQuery {
  table: string;
  filters: Record<string, unknown>;
}

/** Stub client that records the exact table + filters and returns `row`. */
function stubDestinationClient(
  row: unknown,
  queries: RecordedQuery[],
): DestinationQueryClient {
  return {
    from(table: string) {
      const query: RecordedQuery = { table, filters: {} };
      queries.push(query);
      const chain = {
        eq(column: string, value: string) {
          query.filters[column] = value;
          return chain;
        },
        in(column: string, values: string[]) {
          query.filters[column] = values;
          return {
            maybeSingle: () => Promise.resolve({ data: row }),
          };
        },
        maybeSingle: () => Promise.resolve({ data: row }),
      };
      return { select: () => chain };
    },
  };
}

Deno.test("GR-52: a live event destination passes and queries the EXACT create-time gate", async () => {
  const queries: RecordedQuery[] = [];
  const ok = await destinationStillPublicLive(stubDestinationClient({ id: "e1" }, queries), {
    dest_page_type: "event",
    dest_brand_slug: "test-brand",
    dest_entity_slug: "test-event",
  });
  assertEquals(ok, true);
  assertEquals(queries.length, 1);
  assertEquals(queries[0].table, "business_public_events_view");
  assertEquals(queries[0].filters.brand_slug, "test-brand");
  assertEquals(queries[0].filters.slug, "test-event");
  // QA P3-6: the view also exposes ended/cancelled — paid traffic must never
  // point at one; the status filter IS the "live + future" assertion.
  assertEquals(queries[0].filters.status, ["scheduled", "live"]);
});

Deno.test("GR-52: an unpublished/ended event destination fails the re-check", async () => {
  const queries: RecordedQuery[] = [];
  const ok = await destinationStillPublicLive(stubDestinationClient(null, queries), {
    dest_page_type: "event",
    dest_brand_slug: "test-brand",
    dest_entity_slug: "test-event",
  });
  assertEquals(ok, false);
});

Deno.test("GR-52: an event destination with no entity slug fails closed (no query fired)", async () => {
  const queries: RecordedQuery[] = [];
  const ok = await destinationStillPublicLive(stubDestinationClient({ id: "e1" }, queries), {
    dest_page_type: "event",
    dest_brand_slug: "test-brand",
    dest_entity_slug: null,
  });
  assertEquals(ok, false);
  assertEquals(queries.length, 0);
});

Deno.test("GR-52: brand destinations re-check against business_public_brands_view", async () => {
  const queries: RecordedQuery[] = [];
  const ok = await destinationStillPublicLive(stubDestinationClient({ id: "b1" }, queries), {
    dest_page_type: "brand",
    dest_brand_slug: "test-brand",
    dest_entity_slug: null,
  });
  assertEquals(ok, true);
  assertEquals(queries[0].table, "business_public_brands_view");
  assertEquals(queries[0].filters.slug, "test-brand");
  const gone = await destinationStillPublicLive(stubDestinationClient(null, []), {
    dest_page_type: "brand",
    dest_brand_slug: "test-brand",
    dest_entity_slug: null,
  });
  assertEquals(gone, false);
});

Deno.test("GR-52: unknown/uncreatable page types are NOT public (fail-close)", async () => {
  for (const pageType of ["trip", "garbage"]) {
    const ok = await destinationStillPublicLive(stubDestinationClient({ id: "x" }, []), {
      dest_page_type: pageType,
      dest_brand_slug: "test-brand",
      dest_entity_slug: "x",
    });
    assertEquals(ok, false, `${pageType} must fail closed`);
  }
});
