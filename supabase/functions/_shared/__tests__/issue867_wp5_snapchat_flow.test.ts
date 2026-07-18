/**
 * ISSUE-867 WP5 — snapchat mocked-wire flow tests (implementor suite #2).
 *
 * Drives the LIVE adapter through createFullCampaignAtomic with a stubbed
 * fetch and asserts the EXACT wire behavior:
 *   - the full atomic create fires exactly ONE mint + the four creates (+ the
 *     packaging poll), in order, with the A1.2-corrected bodies ON THE WIRE:
 *     S-1 objective_v2_type · S-4 delivery_constraint · S-3 allowlisted CTA ·
 *     S-2 ad type REMOTE_WEBPAGE (never SNAP_AD) · PAUSED at every level ·
 *     profile_properties.profile_id (trusted config) · web_view_properties.url
 *     = the canonical dest_url (never the OneLink).
 *   - a squad-step failure (sub_request_status FAILURE inside an HTTP 200 —
 *     RT-3) rolls the campaign back via DELETE /campaigns/{id} and writes NO
 *     row (the AtomicCreateError carries the partial ids) — AC-S-6.
 *   - an ad-step failure AFTER the creative also fires the GR-48 explicit
 *     creative delete (campaign delete does NOT cascade ad-account-scoped
 *     creatives).
 *   - getStatus("ad") reads BOTH review vocabularies (ad PENDING|APPROVED|
 *     REJECTED + creative PENDING_REVIEW|APPROVED) + review_status_reasons +
 *     delivery_status (GR-38).
 *   - setStatus is a READ-modify-WRITE PUT to the parent collection with the
 *     server-owned fields stripped (a bare {id,status} PUT would wipe fields).
 *   - creative packaging FAILED / never-SUCCESS fails close (A1.1(2)).
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/issue867_wp5_snapchat_flow.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type AdConnectionRow,
  AdApiError,
  AtomicCreateError,
  createFullCampaignAtomic,
  getAdapter,
} from "../adChannel.ts";
import {
  pollSnapchatCreativePackaging,
  resetSnapchatTokenCacheForTests,
  type SnapchatClient,
} from "../snapchat.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ACCOUNT_ID = "6421cc96-dcaf-4a09-a7fa-b24199dcb391";
const ORG_ID = "9389df65-3fa2-4a79-9593-479eee8d67bb";
const PROFILE_ID = "2cfbdc85-890c-43af-b393-10c0adbbad67";
const MEDIA_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CAMPAIGN_ID = "11111111-2222-4333-8444-555555555555";
const SQUAD_ID = "22222222-3333-4444-8555-666666666666";
const CREATIVE_ID = "99999999-8888-4777-8666-555555555555";
const AD_ID = "77777777-6666-4555-8444-333333333333";
const DEST_URL = "https://usemingla.com/e/velvet-lounge/friday-live";

const SNAP_ENV = {
  SNAPCHAT_REFRESH_TOKEN: "test-refresh-token",
  SNAPCHAT_CLIENT_ID: "test-client-id",
  SNAPCHAT_CLIENT_SECRET: "test-client-secret",
  SNAPCHAT_AD_ACCOUNT_ID: ACCOUNT_ID,
  SNAPCHAT_PROFILE_ID: PROFILE_ID,
} as const;

function withEnvAndFetch(
  handler: (call: { method: string; url: string; body: Record<string, unknown> | null }) =>
    | Response
    | null,
  fn: (calls: { method: string; url: string; body: Record<string, unknown> | null }[]) =>
    | void
    | Promise<void>,
): () => Promise<void> {
  return async () => {
    const savedEnv = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(SNAP_ENV)) {
      savedEnv.set(name, Deno.env.get(name));
      Deno.env.set(name, value);
    }
    resetSnapchatTokenCacheForTests();
    const originalFetch = globalThis.fetch;
    const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
    globalThis.fetch = (async (
      input: Request | URL | string,
      init?: { method?: string; body?: unknown },
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      if (url.includes("accounts.snapchat.com")) {
        calls.push({ method, url, body: null });
        return new Response(
          JSON.stringify({ access_token: "test-access-token", expires_in: 3600 }),
          { status: 200 },
        );
      }
      let body: Record<string, unknown> | null = null;
      if (init?.body && typeof init.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      const call = { method, url, body };
      calls.push(call);
      const response = handler(call);
      if (!response) throw new Error(`unexpected fetch: ${method} ${url}`);
      return response;
    }) as typeof fetch;
    try {
      await fn(calls);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [name, value] of savedEnv) {
        if (value !== undefined) Deno.env.set(name, value);
        else Deno.env.delete(name);
      }
      resetSnapchatTokenCacheForTests();
    }
  };
}

function makeConn(): AdConnectionRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    platform: "snapchat",
    lane: "consumer",
    display_name: "Snapchat · Consumer (Mingla Ads)",
    external_account_id: ACCOUNT_ID,
    external_org_id: ORG_ID,
    auth_kind: "refresh_token",
    token_env_var: "SNAPCHAT_REFRESH_TOKEN",
    extra: { profile_id: PROFILE_ID, pixel_id: "af5f8fc4-1ef6-41e7-81c5-042b7be7df38" },
    status: "connected",
    currency: "USD",
    timezone: "America/New_York",
    min_daily_budget_cents: 500,
    account_status: "ACTIVE",
    token_last_verified_at: null,
    connected: true,
  };
}

function envelope(collection: string, entity: string, record: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      request_status: "SUCCESS",
      request_id: "req-1",
      [collection]: [{ sub_request_status: "SUCCESS", [entity]: record }],
    }),
    { status: 200 },
  );
}

function atomicInput() {
  return {
    campaign: { name: "Friday Live", objective: "TRAFFIC" },
    adSet: {
      name: "Friday Live — ad squad",
      optimizationGoal: "SWIPES",
      billingEvent: "IMPRESSION",
      budgetCents: 500,
      targeting: { countries: ["US"], budget_mode: "daily" },
    },
    creative: {
      destUrl: DEST_URL,
      message: "Live music this Friday",
      headline: "Live music this Friday",
      callToActionType: "BUY_TICKETS",
      campaignName: "Friday Live",
      adName: "Friday Live — ad",
      topSnapMediaId: MEDIA_ID,
      creativeType: "WEB_VIEW",
    },
    ad: { name: "Friday Live — ad", creativeType: "WEB_VIEW" },
  };
}

// ── The full atomic create — exact wire sequence + A1.2 bodies ────────────────

Deno.test(
  "WP5 flow: the atomic create fires ONE mint + campaign → squad → creative → packaging poll → ad, with the A1.2-corrected bodies on the wire",
  withEnvAndFetch(
    (call) => {
      if (call.method === "POST" && call.url.endsWith(`/adaccounts/${ACCOUNT_ID}/campaigns`)) {
        const sent = (call.body?.campaigns as Record<string, unknown>[])[0];
        return envelope("campaigns", "campaign", { ...sent, id: CAMPAIGN_ID });
      }
      if (call.method === "POST" && call.url.endsWith(`/campaigns/${CAMPAIGN_ID}/adsquads`)) {
        const sent = (call.body?.adsquads as Record<string, unknown>[])[0];
        return envelope("adsquads", "adsquad", { ...sent, id: SQUAD_ID });
      }
      if (call.method === "POST" && call.url.endsWith(`/adaccounts/${ACCOUNT_ID}/creatives`)) {
        const sent = (call.body?.creatives as Record<string, unknown>[])[0];
        return envelope("creatives", "creative", { ...sent, id: CREATIVE_ID });
      }
      if (call.method === "GET" && call.url.endsWith(`/creatives/${CREATIVE_ID}`)) {
        return envelope("creatives", "creative", {
          id: CREATIVE_ID,
          packaging_status: "SUCCESS",
          review_status: "PENDING_REVIEW",
        });
      }
      if (call.method === "POST" && call.url.endsWith(`/adsquads/${SQUAD_ID}/ads`)) {
        const sent = (call.body?.ads as Record<string, unknown>[])[0];
        return envelope("ads", "ad", { ...sent, id: AD_ID, review_status: "PENDING" });
      }
      return null;
    },
    async (calls) => {
      const adapter = getAdapter("snapchat");
      const result = await createFullCampaignAtomic(adapter, makeConn(), atomicInput());

      assertEquals(result.externalCampaignId, CAMPAIGN_ID);
      assertEquals(result.externalAdSetId, SQUAD_ID);
      assertEquals(result.externalCreativeId, CREATIVE_ID);
      assertEquals(result.externalAdId, AD_ID);
      assertEquals(result.reviewStatus, "PENDING");

      // Exactly ONE mint across the whole chain (the cache holds — AC-S-8).
      const mints = calls.filter((c) => c.url.includes("accounts.snapchat.com"));
      assertEquals(mints.length, 1, "one mint per window across the whole atomic create");

      // Order: mint → campaign → squad → creative → packaging GET → ad.
      const apiCalls = calls.filter((c) => !c.url.includes("accounts.snapchat.com"));
      assertEquals(apiCalls.length, 5);
      assert(apiCalls[0].url.endsWith(`/adaccounts/${ACCOUNT_ID}/campaigns`));
      assert(apiCalls[1].url.endsWith(`/campaigns/${CAMPAIGN_ID}/adsquads`));
      assert(apiCalls[2].url.endsWith(`/adaccounts/${ACCOUNT_ID}/creatives`));
      assert(apiCalls[3].url.endsWith(`/creatives/${CREATIVE_ID}`));
      assert(apiCalls[4].url.endsWith(`/adsquads/${SQUAD_ID}/ads`));

      // S-1 + S-6 on the wire.
      const campaignSent = (apiCalls[0].body?.campaigns as Record<string, unknown>[])[0];
      const objectiveProps = campaignSent.objective_v2_properties as Record<string, unknown>;
      assertEquals(objectiveProps.objective_v2_type, "TRAFFIC");
      assert(!("objective_v2" in objectiveProps), "S-1: objective_v2 KEY must not ride the wire");
      assert(!("objective" in campaignSent), "S-6: the legacy objective key must not ride the wire");
      assertEquals(campaignSent.status, "PAUSED");
      assertEquals(campaignSent.buy_model, "AUCTION");

      // S-4 + money + GR-39 on the wire.
      const squadSent = (apiCalls[1].body?.adsquads as Record<string, unknown>[])[0];
      assertEquals(squadSent.delivery_constraint, "DAILY_BUDGET");
      assertEquals(squadSent.daily_budget_micro, 5_000_000, "$5.00/500¢ → 5,000,000 micro EXACT");
      assertEquals(squadSent.status, "PAUSED");
      const targeting = squadSent.targeting as Record<string, unknown>;
      assertEquals(targeting.geos, [{ country_code: "us" }]);
      assertEquals(targeting.demographics, [{ min_age: "18" }], "GR-39 default rides the wire");

      // S-3 + A1.2-8 + destination policy v1 on the wire.
      const creativeSent = (apiCalls[2].body?.creatives as Record<string, unknown>[])[0];
      assertEquals(creativeSent.type, "WEB_VIEW");
      assertEquals(creativeSent.call_to_action, "BUY_TICKETS");
      assertEquals(creativeSent.top_snap_media_id, MEDIA_ID);
      assertEquals(
        (creativeSent.profile_properties as Record<string, unknown>).profile_id,
        PROFILE_ID,
      );
      assertEquals(
        (creativeSent.web_view_properties as Record<string, unknown>).url,
        DEST_URL,
        "the ad-visible destination is the canonical page — never the OneLink (D-P1)",
      );

      // S-2 on the wire: REMOTE_WEBPAGE — never the attachment-less SNAP_AD.
      const adSent = (apiCalls[4].body?.ads as Record<string, unknown>[])[0];
      assertEquals(adSent.type, "REMOTE_WEBPAGE");
      assert(adSent.type !== "SNAP_AD");
      assertEquals(adSent.status, "PAUSED");
      assertEquals(adSent.creative_id, CREATIVE_ID);
    },
  ),
);

// ── AC-S-6: squad-step failure → compensating campaign delete, partial ids ────

Deno.test(
  "AC-S-6/RT-2/RT-3: a squad-step sub_request_status FAILURE (inside HTTP 200) rolls the campaign back and surfaces partial ids — no orphans",
  withEnvAndFetch(
    (call) => {
      if (call.method === "POST" && call.url.endsWith(`/adaccounts/${ACCOUNT_ID}/campaigns`)) {
        const sent = (call.body?.campaigns as Record<string, unknown>[])[0];
        return envelope("campaigns", "campaign", { ...sent, id: CAMPAIGN_ID });
      }
      if (call.method === "POST" && call.url.endsWith(`/campaigns/${CAMPAIGN_ID}/adsquads`)) {
        // RT-3: HTTP 200 + request_status SUCCESS + per-entity FAILURE.
        return new Response(
          JSON.stringify({
            request_status: "SUCCESS",
            adsquads: [{
              sub_request_status: "FAILURE",
              adsquad: {},
              debug_message: "delivery_constraint invalid",
            }],
          }),
          { status: 200 },
        );
      }
      if (call.method === "DELETE" && call.url.endsWith(`/campaigns/${CAMPAIGN_ID}`)) {
        return new Response(JSON.stringify({ request_status: "SUCCESS" }), { status: 200 });
      }
      return null;
    },
    async (calls) => {
      const adapter = getAdapter("snapchat");
      const err = await assertRejects(
        () => createFullCampaignAtomic(adapter, makeConn(), atomicInput()),
        AtomicCreateError,
      );
      const failure = (err as AtomicCreateError).failure;
      assertEquals(failure.step, "ad_set");
      assertEquals(failure.partialExternalIds.external_campaign_id, CAMPAIGN_ID);
      assertEquals(failure.rollbackSucceeded, true, "the compensating DELETE ran and succeeded");
      assertEquals(failure.creativeRollbackSucceeded, null, "no creative existed yet — nothing to clean");
      assert(failure.cause instanceof AdApiError);
      assertEquals((failure.cause as AdApiError).code, "snapchat_sub_request_failed");
      const deletes = calls.filter((c) => c.method === "DELETE");
      assertEquals(deletes.length, 1);
      assert(deletes[0].url.endsWith(`/campaigns/${CAMPAIGN_ID}`));
    },
  ),
);

// ── GR-48: ad-step failure after the creative → explicit creative delete ──────

Deno.test(
  "GR-48: an ad-step failure AFTER the creative fires BOTH the explicit creative DELETE and the campaign DELETE (creatives are ad-account-scoped — no cascade)",
  withEnvAndFetch(
    (call) => {
      if (call.method === "POST" && call.url.endsWith(`/adaccounts/${ACCOUNT_ID}/campaigns`)) {
        return envelope("campaigns", "campaign", { id: CAMPAIGN_ID, status: "PAUSED" });
      }
      if (call.method === "POST" && call.url.endsWith(`/campaigns/${CAMPAIGN_ID}/adsquads`)) {
        return envelope("adsquads", "adsquad", { id: SQUAD_ID, status: "PAUSED" });
      }
      if (call.method === "POST" && call.url.endsWith(`/adaccounts/${ACCOUNT_ID}/creatives`)) {
        return envelope("creatives", "creative", { id: CREATIVE_ID });
      }
      if (call.method === "GET" && call.url.endsWith(`/creatives/${CREATIVE_ID}`)) {
        return envelope("creatives", "creative", { id: CREATIVE_ID, packaging_status: "SUCCESS" });
      }
      if (call.method === "POST" && call.url.endsWith(`/adsquads/${SQUAD_ID}/ads`)) {
        return new Response(JSON.stringify({ request_status: "ERROR", debug_message: "review gate" }), {
          status: 200,
        });
      }
      if (call.method === "DELETE") {
        return new Response(JSON.stringify({ request_status: "SUCCESS" }), { status: 200 });
      }
      return null;
    },
    async (calls) => {
      const adapter = getAdapter("snapchat");
      const err = await assertRejects(
        () => createFullCampaignAtomic(adapter, makeConn(), atomicInput()),
        AtomicCreateError,
      );
      const failure = (err as AtomicCreateError).failure;
      assertEquals(failure.step, "ad");
      assertEquals(failure.partialExternalIds.external_creative_id, CREATIVE_ID);
      assertEquals(failure.creativeRollbackSucceeded, true, "the GR-48 explicit creative delete ran");
      assertEquals(failure.rollbackSucceeded, true);
      const deletes = calls.filter((c) => c.method === "DELETE").map((c) => c.url);
      assertEquals(deletes.length, 2);
      assert(deletes[0].endsWith(`/creatives/${CREATIVE_ID}`), "creative FIRST (unreferenced after the failed ad)");
      assert(deletes[1].endsWith(`/campaigns/${CAMPAIGN_ID}`));
    },
  ),
);

// ── GR-38: getStatus('ad') reads BOTH vocabularies + reasons + delivery ───────

Deno.test(
  "GR-38: getStatus('ad') returns the AD enum as the gate, the CREATIVE enum alongside, review_status_reasons verbatim, and delivery_status",
  withEnvAndFetch(
    (call) => {
      if (call.method === "GET" && call.url.endsWith(`/ads/${AD_ID}`)) {
        return envelope("ads", "ad", {
          id: AD_ID,
          status: "PAUSED",
          review_status: "REJECTED",
          review_status_reasons: ["DISALLOWED_CONTENT", "MISSING_DISCLAIMER"],
          delivery_status: ["INVALID"],
          creative_id: CREATIVE_ID,
          ad_squad_id: SQUAD_ID,
        });
      }
      if (call.method === "GET" && call.url.endsWith(`/creatives/${CREATIVE_ID}`)) {
        return envelope("creatives", "creative", {
          id: CREATIVE_ID,
          review_status: "PENDING_REVIEW",
          packaging_status: "SUCCESS",
        });
      }
      return null;
    },
    async () => {
      const adapter = getAdapter("snapchat");
      const status = await adapter.getStatus(makeConn(), "ad", AD_ID);
      assertEquals(status.status, "PAUSED");
      assertEquals(status.effectiveStatus, "REJECTED", "the AD vocabulary is the delivery gate");
      assertEquals(status.issuesInfo, ["DISALLOWED_CONTENT", "MISSING_DISCLAIMER"]);
      assertEquals(status.adReviewFeedback, {
        review_status: "REJECTED",
        creative_review_status: "PENDING_REVIEW",
        delivery_status: ["INVALID"],
      });
    },
  ),
);

// ── setStatus: READ-modify-WRITE PUT to the parent collection ─────────────────

Deno.test(
  "setStatus launches via read-modify-write: GET the entity, strip server-owned fields, PUT the FULL entity (status merged) to the parent collection",
  withEnvAndFetch(
    (call) => {
      if (call.method === "GET" && call.url.endsWith(`/campaigns/${CAMPAIGN_ID}`)) {
        return envelope("campaigns", "campaign", {
          id: CAMPAIGN_ID,
          ad_account_id: ACCOUNT_ID,
          name: "Friday Live",
          status: "PAUSED",
          buy_model: "AUCTION",
          daily_budget_micro: 20_000_000,
          created_at: "2026-07-15T00:00:00Z",
          updated_at: "2026-07-15T00:00:00Z",
          delivery_status: ["VALID"],
        });
      }
      if (call.method === "PUT" && call.url.endsWith(`/adaccounts/${ACCOUNT_ID}/campaigns`)) {
        return envelope("campaigns", "campaign", { id: CAMPAIGN_ID, status: "ACTIVE" });
      }
      return null;
    },
    async (calls) => {
      const adapter = getAdapter("snapchat");
      await adapter.setStatus(makeConn(), "campaign", CAMPAIGN_ID, "ACTIVE");
      const put = calls.find((c) => c.method === "PUT");
      assert(put, "the update must be a PUT to the PARENT collection (§4.0)");
      assert(put.url.endsWith(`/adaccounts/${ACCOUNT_ID}/campaigns`));
      const sent = (put.body?.campaigns as Record<string, unknown>[])[0];
      assertEquals(sent.status, "ACTIVE");
      assertEquals(sent.id, CAMPAIGN_ID);
      // The full entity rides along (a bare {id,status} PUT wipes fields)…
      assertEquals(sent.name, "Friday Live");
      assertEquals(sent.daily_budget_micro, 20_000_000);
      // …but the server-owned fields are stripped.
      assert(!("created_at" in sent) && !("updated_at" in sent) && !("delivery_status" in sent));
    },
  ),
);

// ── A1.1(2): packaging poll fails close ───────────────────────────────────────

// The packaging-poll tests inject fetchImpl DIRECTLY (never globalThis.fetch)
// so they are immune to the known ticketCheckout uncaught-error fallout that
// can poison global state mid-sweep in the full-directory battery.

function packagingClient(): SnapchatClient {
  return {
    platform: "snapchat",
    accessToken: "test-access-token",
    adAccountId: ACCOUNT_ID,
    organizationId: ORG_ID,
    profileId: PROFILE_ID,
    pixelId: null,
    apiBase: "https://adsapi.snapchat.com/v1",
  };
}

function packagingFetch(status: string): typeof fetch {
  return ((input: Request | URL | string): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith(`/creatives/${CREATIVE_ID}`)) {
      return Promise.resolve(
        envelope("creatives", "creative", { id: CREATIVE_ID, packaging_status: status }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  }) as typeof fetch;
}

Deno.test(
  "A1.1(2): a terminal packaging failure fails close (creative_packaging_failed) rather than shipping an unpackaged creative",
  async () => {
    const failed = await assertRejects(
      () =>
        pollSnapchatCreativePackaging(packagingClient(), CREATIVE_ID, {
          sleep: () => Promise.resolve(),
          fetchImpl: packagingFetch("FAILED"),
        }),
      AdApiError,
    );
    assertEquals((failed as AdApiError).code, "creative_packaging_failed");
  },
);

Deno.test(
  "A1.1(2): a poll that never reaches SUCCESS times out fail-close (creative_packaging_timeout)",
  async () => {
    const timedOut = await assertRejects(
      () =>
        pollSnapchatCreativePackaging(packagingClient(), CREATIVE_ID, {
          maxAttempts: 3,
          sleep: () => Promise.resolve(),
          fetchImpl: packagingFetch("IN_PROGRESS"),
        }),
      AdApiError,
    );
    assertEquals((timedOut as AdApiError).code, "creative_packaging_timeout");
  },
);

// ── Media-required guard (the adapter never uploads) ──────────────────────────

Deno.test(
  "createCreative without a top_snap_media_id fails close — media rides in from the #866 library, never uploaded inline",
  withEnvAndFetch(
    () => null,
    async () => {
      const adapter = getAdapter("snapchat");
      assert(adapter.createCreative);
      const err = await assertRejects(
        () =>
          adapter.createCreative!(makeConn(), {
            destUrl: DEST_URL,
            message: "m",
            headline: "Live music this Friday",
            callToActionType: "BUY_TICKETS",
          }),
        AdApiError,
      );
      assertEquals((err as AdApiError).code, "snapchat_media_required");
    },
  ),
);
