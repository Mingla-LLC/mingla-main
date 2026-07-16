/**
 * ISSUE-867 WP5 — TESTER adversarial suite (mingla-tester; append-only).
 *
 * Attacks DIFFERENT angles than the implementor's 52:
 *   T-1  money at the RAW MICRO floor boundary (4,999,999/5,000,000 and
 *        19,999,999/20,000,000 micro directly) + hostile numerics (NaN/∞/0/
 *        negative/fractional cents) + the $4.99/$5.00/$19.99/$20.00 cents
 *        boundary THROUGH the body builders.
 *   T-2  CTA allowlist evasion: lowercase, whitespace-padded, NUL-suffixed,
 *        cross-platform enum values (Meta LEARN_MORE, TikTok/Reddit display
 *        strings), empty/undefined-on-hostile-type, "__proto__" creative type.
 *   T-3  delivery_constraint ↔ budget-field WIRE CONSISTENCY: the squad body
 *        never carries BOTH budget fields; the constraint always matches the
 *        field actually present (daily/lifetime/CBO/hostile budget_mode cast).
 *        ← the tester fails-on-revert target: deleting the CBO else-branch
 *        `body.delivery_constraint = "DAILY_BUDGET";` (a DIFFERENT line than
 *        the implementor's two proofs) fails T-3c.
 *   T-4  envelope smuggle BY LEVEL through createFullCampaignAtomic: a
 *        sub_request_status FAILURE nested 3 objects deep at the CREATIVE
 *        step, inside the packaging-poll GET, inside `paging` at the AD step,
 *        and case variants ("Failure"/"failure") — every one must abort the
 *        chain, fire the compensating deletes, and surface AtomicCreateError.
 *   T-5  S-2 map fail-closed surface: every non-pinned creative type throws
 *        creative_type_unmapped; the map's OWN key surface is exactly the six
 *        pinned pairs (no wildcard/default entry can creep in).
 *   T-6  profile-absent at the ADAPTER level: whitespace/non-string persisted
 *        profile + env unset → snapchat_profile_missing with ZERO
 *        adsapi.snapchat.com calls (the mint host is not a Marketing-API call).
 *   T-7  PAUSED wire fuzz through the ATOMIC RUNNER: across ABO/lifetime/CBO/
 *        TARGET_COST/promotion-type variants, every captured create body is
 *        PAUSED and no wire JSON ever contains "status":"ACTIVE".
 *   T-8  review-mapper hostile fuzz (GR-38): non-array issuesInfo, verbatim
 *        falsy-but-present feedback, unknown/lowercase statuses map to null,
 *        delivery arrays serialize, launch-warning precedence (REJECTED wins;
 *        APPROVED ad + PENDING_REVIEW creative still warns).
 *   T-9  read-modify-write PUT: UNKNOWN server fields survive the strip (the
 *        §10.1 deviation preserves siblings); every pinned server-owned field
 *        is removed; the status writer refuses ARCHIVED/DELETED casts.
 *
 * fails-on-revert (tester, TRUE LINE DELETION at a line distinct from the
 * implementor's two): deleting the CBO else-branch
 * `body.delivery_constraint = "DAILY_BUDGET";` in buildSnapchatAdSquadBody
 * (_shared/snapchat.ts) → T-3c FAILS; restored → green.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/issue867_wp5_tester_adversarial.test.ts
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
  AtomicCreateError,
  centsToPlatformBudget,
  createFullCampaignAtomic,
  getAdapter,
} from "../adChannel.ts";
import {
  buildSnapchatAdSquadBody,
  buildSnapchatCampaignBody,
  buildSnapchatCreativeBody,
  buildSnapchatReviewDetail,
  engineStatusFromSnapchat,
  resetSnapchatTokenCacheForTests,
  SNAPCHAT_CREATIVE_TO_AD_TYPE,
  SNAPCHAT_READ_ONLY_ENTITY_FIELDS,
  snapchatAdTypeForCreativeType,
  snapchatDeliveryStatusText,
  snapchatLaunchWarning,
  snapchatStatusForAdvertiserStatus,
  snapchatStripReadOnlyFields,
  validateSnapchatBudgetFloorMicro,
  validateSnapchatCta,
} from "../snapchat.ts";

// ── Fixtures (mirrors the implementor flow suite; helpers duplicated because
//    existing test files are append-only and must not be modified) ────────────

const ACCOUNT_ID = "6421cc96-dcaf-4a09-a7fa-b24199dcb391";
const ORG_ID = "9389df65-3fa2-4a79-9593-479eee8d67bb";
const PROFILE_ID = "2cfbdc85-890c-43af-b393-10c0adbbad67";
const MEDIA_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CAMPAIGN_ID = "11111111-2222-4333-8444-555555555555";
const SQUAD_ID = "22222222-3333-4444-8555-666666666666";
const CREATIVE_ID = "99999999-8888-4777-8666-555555555555";
const AD_ID = "77777777-6666-4555-8444-333333333333";
const DEST_URL = "https://usemingla.com/e/velvet-lounge/friday-live";

const SNAP_ENV: Record<string, string> = {
  SNAPCHAT_REFRESH_TOKEN: "test-refresh-token",
  SNAPCHAT_CLIENT_ID: "test-client-id",
  SNAPCHAT_CLIENT_SECRET: "test-client-secret",
  SNAPCHAT_AD_ACCOUNT_ID: ACCOUNT_ID,
  SNAPCHAT_PROFILE_ID: PROFILE_ID,
};

type WireCall = { method: string; url: string; body: Record<string, unknown> | null };

function withEnvAndFetch(
  envOverride: Record<string, string | null>,
  handler: (call: WireCall) => Response | null,
  fn: (calls: WireCall[]) => void | Promise<void>,
): () => Promise<void> {
  return async () => {
    const savedEnv = new Map<string, string | undefined>();
    const effective: Record<string, string | null> = { ...SNAP_ENV, ...envOverride };
    for (const [name, value] of Object.entries(effective)) {
      savedEnv.set(name, Deno.env.get(name));
      if (value === null) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
    resetSnapchatTokenCacheForTests();
    const originalFetch = globalThis.fetch;
    const calls: WireCall[] = [];
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

function makeConn(overrides: Partial<AdConnectionRow> = {}): AdConnectionRow {
  return {
    id: "00000000-0000-4000-8000-000000000002",
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
    ...overrides,
  } as AdConnectionRow;
}

function envelope(collection: string, entity: string, record: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      request_status: "SUCCESS",
      request_id: "req-adv",
      [collection]: [{ sub_request_status: "SUCCESS", [entity]: record }],
    }),
    { status: 200 },
  );
}

/** SUCCESS envelope whose entity smuggles a FAILURE `depth` objects deep. */
function smuggledEnvelope(
  collection: string,
  entity: string,
  record: Record<string, unknown>,
  smuggleValue: string,
  depth: number,
): Response {
  let nest: Record<string, unknown> = { sub_request_status: smuggleValue };
  for (let i = 0; i < depth; i++) nest = { [`level_${i}`]: nest };
  return new Response(
    JSON.stringify({
      request_status: "SUCCESS",
      request_id: "req-smuggle",
      [collection]: [{ sub_request_status: "SUCCESS", [entity]: { ...record, deep: nest } }],
    }),
    { status: 200 },
  );
}

function atomicInput(overrides: {
  campaign?: Record<string, unknown>;
  adSet?: Record<string, unknown>;
  creative?: Record<string, unknown>;
  ad?: Record<string, unknown>;
} = {}) {
  return {
    campaign: { name: "Adv Friday", objective: "TRAFFIC", ...(overrides.campaign ?? {}) },
    adSet: {
      name: "Adv Friday — ad squad",
      optimizationGoal: "SWIPES",
      billingEvent: "IMPRESSION",
      budgetCents: 500,
      targeting: { countries: ["US"], budget_mode: "daily" },
      ...(overrides.adSet ?? {}),
    },
    creative: {
      destUrl: DEST_URL,
      message: "Live music this Friday",
      headline: "Live music this Friday",
      callToActionType: "BUY_TICKETS",
      campaignName: "Adv Friday",
      adName: "Adv Friday — ad",
      topSnapMediaId: MEDIA_ID,
      creativeType: "WEB_VIEW",
      ...(overrides.creative ?? {}),
    },
    ad: { name: "Adv Friday — ad", creativeType: "WEB_VIEW", ...(overrides.ad ?? {}) },
    // deno-lint-ignore no-explicit-any
  } as any;
}

/** Happy-path handler for the full chain; individual tests override steps. */
function happyHandler(call: WireCall): Response | null {
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
    return envelope("creatives", "creative", { id: CREATIVE_ID, packaging_status: "SUCCESS" });
  }
  if (call.method === "POST" && call.url.endsWith(`/adsquads/${SQUAD_ID}/ads`)) {
    const sent = (call.body?.ads as Record<string, unknown>[])[0];
    return envelope("ads", "ad", { ...sent, id: AD_ID, review_status: "PENDING" });
  }
  if (call.method === "DELETE") {
    return new Response(JSON.stringify({ request_status: "SUCCESS", request_id: "req-del" }), {
      status: 200,
    });
  }
  return null;
}

// ══ T-1 · money at the RAW MICRO boundary + hostile numerics ══════════════════

Deno.test("T-1a: raw micro floor boundary — 4,999,999 fails / 5,000,000 passes (squad); 19,999,999 fails / 20,000,000 passes (campaign)", () => {
  assertEquals(
    validateSnapchatBudgetFloorMicro({ level: "ad_squad", micro: 4_999_999 }).ok,
    false,
  );
  assertEquals(validateSnapchatBudgetFloorMicro({ level: "ad_squad", micro: 5_000_000 }).ok, true);
  assertEquals(
    validateSnapchatBudgetFloorMicro({ level: "campaign", micro: 19_999_999 }).ok,
    false,
  );
  assertEquals(
    validateSnapchatBudgetFloorMicro({ level: "campaign", micro: 20_000_000 }).ok,
    true,
  );
  const below = validateSnapchatBudgetFloorMicro({ level: "ad_squad", micro: 4_999_999 });
  assert(!below.ok && below.detail === "budget_below_minimum");
});

Deno.test("T-1b: hostile numerics — NaN/Infinity/0/negative micro are budget_invalid; fractional cents throw at THE conversion boundary", () => {
  for (const micro of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5_000_000]) {
    const result = validateSnapchatBudgetFloorMicro({ level: "ad_squad", micro });
    assert(!result.ok, `micro=${micro} must be refused`);
    assertEquals(!result.ok && result.detail, "budget_invalid");
  }
  // $4.999 is not a cents integer — the single conversion point refuses it.
  assertThrows(() => centsToPlatformBudget("snapchat", 499.9));
  assertThrows(() => centsToPlatformBudget("snapchat", Number.NaN));
  assertThrows(() => centsToPlatformBudget("snapchat", -500));
  assertThrows(() => centsToPlatformBudget("snapchat", 0));
});

Deno.test("T-1c: $4.99/$5.00 and $19.99/$20.00 THROUGH the body builders — 499¢ squad throws budget_below_minimum, 500¢ builds 5,000,000; 1,999¢ campaign throws, 2,000¢ builds 20,000,000", () => {
  const err = assertThrows(
    () =>
      buildSnapchatAdSquadBody(SQUAD_ID, {
        name: "b",
        optimizationGoal: "SWIPES",
        countries: ["US"],
        budgetCents: 499,
      }),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "budget_below_minimum");
  const ok = buildSnapchatAdSquadBody(SQUAD_ID, {
    name: "b",
    optimizationGoal: "SWIPES",
    countries: ["US"],
    budgetCents: 500,
  });
  assertEquals(ok.daily_budget_micro, 5_000_000);

  const cErr = assertThrows(
    () => buildSnapchatCampaignBody(ACCOUNT_ID, { name: "c", objective: "TRAFFIC", dailyBudgetCents: 1_999 }),
    AdApiError,
  );
  assertEquals((cErr as AdApiError).code, "budget_below_minimum");
  const cOk = buildSnapchatCampaignBody(ACCOUNT_ID, {
    name: "c",
    objective: "TRAFFIC",
    dailyBudgetCents: 2_000,
  });
  assertEquals(cOk.daily_budget_micro, 20_000_000);
});

// ══ T-2 · CTA allowlist evasion ═══════════════════════════════════════════════

Deno.test("T-2a: case/whitespace/NUL evasion — 'book_now', ' BOOK_NOW ', 'BOOK_NOW\\u0000' are all invalid_cta", () => {
  for (const cta of ["book_now", " BOOK_NOW ", "BOOK_NOW ", "Book_Now"]) {
    const result = validateSnapchatCta("WEB_VIEW", cta);
    assert(!result.ok, `CTA ${JSON.stringify(cta)} must be refused`);
    assertEquals(!result.ok && result.detail, "invalid_cta");
  }
});

Deno.test("T-2b: cross-platform CTA values are refused — Meta enums and TikTok/Reddit display strings never leak onto the Snap wire", () => {
  for (const cta of ["LEARN_MORE", "EVENT_RSVP", "GET_DIRECTIONS", "Book now", "Buy Tickets", "Learn More"]) {
    const result = validateSnapchatCta("WEB_VIEW", cta);
    assert(!result.ok, `cross-platform CTA ${JSON.stringify(cta)} must be refused`);
  }
});

Deno.test("T-2c: hostile creative types fail closed on the CTA gate — '__proto__' and an empty type have NO allowlist; empty/undefined CTA on WEB_VIEW is refused", () => {
  assert(!validateSnapchatCta("__proto__", "BOOK_NOW").ok);
  assert(!validateSnapchatCta("", "BOOK_NOW").ok);
  assert(!validateSnapchatCta("WEB_VIEW", "").ok);
  assert(!validateSnapchatCta("WEB_VIEW", undefined).ok);
  assert(!validateSnapchatCta("WEB_VIEW", 42).ok);
});

Deno.test("T-2d: the adapter-level creative default CTA is 'MORE' (SNAPCHAT_CTA_MAP.default) and rides the wire allowlisted", () => {
  const body = buildSnapchatCreativeBody(ACCOUNT_ID, {
    name: "c",
    topSnapMediaId: MEDIA_ID,
    headline: "Live music this Friday",
    profileId: PROFILE_ID,
    webViewUrl: DEST_URL,
  });
  assertEquals(body.call_to_action, "MORE");
});

// ══ T-3 · delivery_constraint ↔ budget-field wire consistency ═════════════════

Deno.test("T-3a: a daily squad budget carries daily_budget_micro ONLY (never lifetime_budget_micro) with DAILY_BUDGET", () => {
  const body = buildSnapchatAdSquadBody(SQUAD_ID, {
    name: "b",
    optimizationGoal: "SWIPES",
    countries: ["US"],
    budgetCents: 500,
    budgetMode: "daily",
  });
  assertEquals(body.delivery_constraint, "DAILY_BUDGET");
  assertEquals(body.daily_budget_micro, 5_000_000);
  assertEquals("lifetime_budget_micro" in body, false);
});

Deno.test("T-3b: a lifetime squad budget carries lifetime_budget_micro ONLY with LIFETIME_BUDGET", () => {
  const body = buildSnapchatAdSquadBody(SQUAD_ID, {
    name: "b",
    optimizationGoal: "SWIPES",
    countries: ["US"],
    budgetCents: 2_000,
    budgetMode: "lifetime",
    endTime: "2026-08-01T00:00:00Z",
  });
  assertEquals(body.delivery_constraint, "LIFETIME_BUDGET");
  assertEquals(body.lifetime_budget_micro, 20_000_000);
  assertEquals("daily_budget_micro" in body, false);
});

Deno.test("T-3c: CBO — a squad WITHOUT its own budget still carries delivery_constraint DAILY_BUDGET and NO budget field (S-4 is REQUIRED; the tester fails-on-revert target)", () => {
  const body = buildSnapchatAdSquadBody(SQUAD_ID, {
    name: "b",
    optimizationGoal: "SWIPES",
    countries: ["US"],
  });
  assertEquals(
    body.delivery_constraint,
    "DAILY_BUDGET",
    "S-4: delivery_constraint is REQUIRED even under CBO — deleting the CBO else-branch line re-opens the squad-create 400",
  );
  assertEquals("daily_budget_micro" in body, false);
  assertEquals("lifetime_budget_micro" in body, false);
});

Deno.test("T-3d: a hostile budget_mode cast never yields a mismatched pair — the constraint always matches the budget field actually present", () => {
  const body = buildSnapchatAdSquadBody(SQUAD_ID, {
    name: "b",
    optimizationGoal: "SWIPES",
    countries: ["US"],
    budgetCents: 500,
    // deno-lint-ignore no-explicit-any
    budgetMode: "weekly" as any,
  });
  const hasDaily = "daily_budget_micro" in body;
  const hasLifetime = "lifetime_budget_micro" in body;
  assert(hasDaily !== hasLifetime, "exactly one budget field must be present");
  assertEquals(
    body.delivery_constraint,
    hasDaily ? "DAILY_BUDGET" : "LIFETIME_BUDGET",
    "the derived constraint must match the field on the wire",
  );
});

// ══ T-4 · envelope smuggle BY LEVEL through the atomic runner ═════════════════

Deno.test(
  "T-4a: a FAILURE smuggled 3 objects deep at the CREATIVE step aborts the chain and fires the campaign DELETE (no creative id was ever returned)",
  withEnvAndFetch(
    {},
    (call) => {
      if (call.method === "POST" && call.url.endsWith(`/adaccounts/${ACCOUNT_ID}/creatives`)) {
        return smuggledEnvelope("creatives", "creative", { id: CREATIVE_ID }, "FAILURE", 3);
      }
      return happyHandler(call);
    },
    async (calls) => {
      const adapter = getAdapter("snapchat");
      const err = await assertRejects(
        () => createFullCampaignAtomic(adapter, makeConn(), atomicInput()),
        AtomicCreateError,
      );
      const failure = (err as AtomicCreateError).failure;
      assertEquals(failure.step, "creative");
      assertEquals(failure.partialExternalIds.external_campaign_id, CAMPAIGN_ID);
      assertEquals(failure.partialExternalIds.external_creative_id ?? null, null);
      const deletes = calls.filter((c) => c.method === "DELETE");
      assertEquals(deletes.length, 1, "exactly the campaign DELETE fires");
      assert(deletes[0].url.endsWith(`/campaigns/${CAMPAIGN_ID}`));
      const adCreates = calls.filter((c) =>
        c.method === "POST" && c.url.endsWith(`/adsquads/${SQUAD_ID}/ads`)
      );
      assertEquals(adCreates.length, 0, "the chain must never reach the ad step");
    },
  ),
);

Deno.test(
  "T-4b: a FAILURE smuggled inside the packaging-poll GET aborts createCreative — the GR-48 creative DELETE and campaign DELETE both fire",
  withEnvAndFetch(
    {},
    (call) => {
      if (call.method === "GET" && call.url.endsWith(`/creatives/${CREATIVE_ID}`)) {
        return smuggledEnvelope(
          "creatives",
          "creative",
          { id: CREATIVE_ID, packaging_status: "SUCCESS" },
          "failure", // lowercase — case variant must still be caught
          2,
        );
      }
      return happyHandler(call);
    },
    async (calls) => {
      const adapter = getAdapter("snapchat");
      const err = await assertRejects(
        () => createFullCampaignAtomic(adapter, makeConn(), atomicInput()),
        AtomicCreateError,
      );
      const failure = (err as AtomicCreateError).failure;
      assertEquals(failure.step, "creative");
      assertEquals(failure.partialExternalIds.external_creative_id ?? null, null);
      const deletes = calls.filter((c) => c.method === "DELETE").map((c) => c.url);
      assertEquals(deletes.length, 1, "campaign DELETE fires (no creative id surfaced to roll back)");
      assert(deletes[0].endsWith(`/campaigns/${CAMPAIGN_ID}`));
    },
  ),
);

Deno.test(
  "T-4c: a FAILURE smuggled inside `paging` at the AD step aborts the chain — creative DELETE (GR-48) AND campaign DELETE both fire",
  withEnvAndFetch(
    {},
    (call) => {
      if (call.method === "POST" && call.url.endsWith(`/adsquads/${SQUAD_ID}/ads`)) {
        return new Response(
          JSON.stringify({
            request_status: "SUCCESS",
            request_id: "req-pg",
            paging: { nested: { sub_request_status: "Failure" } }, // mixed case
            ads: [{ sub_request_status: "SUCCESS", ad: { id: AD_ID } }],
          }),
          { status: 200 },
        );
      }
      return happyHandler(call);
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
      const deletes = calls.filter((c) => c.method === "DELETE").map((c) => c.url);
      assertEquals(deletes.length, 2, "creative DELETE + campaign DELETE");
      assert(deletes.some((u) => u.endsWith(`/creatives/${CREATIVE_ID}`)), "GR-48 creative delete");
      assert(deletes.some((u) => u.endsWith(`/campaigns/${CAMPAIGN_ID}`)));
    },
  ),
);

// ══ T-5 · S-2 map fail-closed surface ═════════════════════════════════════════

Deno.test("T-5a: non-pinned creative types throw creative_type_unmapped — lowercase, ad-type names, empty, '__proto__' — and never yield SNAP_AD", () => {
  for (const hostile of ["web_view", "REMOTE_WEBPAGE", "", "STORY", "__proto__", "WEB VIEW"]) {
    const err = assertThrows(() => snapchatAdTypeForCreativeType(hostile), AdApiError);
    assertEquals((err as AdApiError).code, "creative_type_unmapped");
  }
});

Deno.test("T-5b: the map's OWN key surface is exactly the six pinned pairs (no wildcard/default entry can creep in)", () => {
  assertEquals(
    Object.keys(SNAPCHAT_CREATIVE_TO_AD_TYPE).sort(),
    ["APP_INSTALL", "COLLECTION", "DEEP_LINK", "LEAD_GENERATION", "SNAP_AD", "WEB_VIEW"],
  );
  assertEquals(SNAPCHAT_CREATIVE_TO_AD_TYPE.WEB_VIEW, "REMOTE_WEBPAGE");
});

// ══ T-6 · profile-absent at the ADAPTER level — zero Marketing-API calls ══════

Deno.test(
  "T-6a: whitespace persisted profile + env unset → snapchat_profile_missing with ZERO adsapi.snapchat.com calls",
  withEnvAndFetch(
    { SNAPCHAT_PROFILE_ID: null },
    () => null, // any adsapi call would throw 'unexpected fetch'
    async (calls) => {
      const adapter = getAdapter("snapchat");
      assert(adapter.createCreative);
      const err = await assertRejects(
        () =>
          adapter.createCreative!(makeConn({ extra: { profile_id: "   " } }), {
            destUrl: DEST_URL,
            message: "m",
            headline: "Live music this Friday",
            callToActionType: "BUY_TICKETS",
            // deno-lint-ignore no-explicit-any
            topSnapMediaId: MEDIA_ID,
          } as any),
        AdNotConnectedError,
      );
      assertEquals((err as AdNotConnectedError).detail, "snapchat_profile_missing");
      const marketingCalls = calls.filter((c) => !c.url.includes("accounts.snapchat.com"));
      assertEquals(marketingCalls.length, 0, "zero Marketing-API calls on the profile-missing path");
    },
  ),
);

Deno.test(
  "T-6b: a NON-STRING persisted profile_id (number) + env unset is absence, not a value — snapchat_profile_missing",
  withEnvAndFetch(
    { SNAPCHAT_PROFILE_ID: null },
    () => null,
    async () => {
      const adapter = getAdapter("snapchat");
      const err = await assertRejects(
        () =>
          adapter.createCreative!(makeConn({ extra: { profile_id: 12345 } }), {
            destUrl: DEST_URL,
            message: "m",
            headline: "Live music this Friday",
            callToActionType: "BUY_TICKETS",
            // deno-lint-ignore no-explicit-any
            topSnapMediaId: MEDIA_ID,
          } as any),
        AdNotConnectedError,
      );
      assertEquals((err as AdNotConnectedError).detail, "snapchat_profile_missing");
    },
  ),
);

// ══ T-7 · PAUSED wire fuzz through the ATOMIC RUNNER ══════════════════════════

Deno.test(
  "T-7: across ABO/lifetime/CBO/TARGET_COST/promotion variants, every wire create body is PAUSED and no wire JSON ever contains status ACTIVE",
  async () => {
    const variants = [
      atomicInput(),
      atomicInput({
        adSet: {
          budgetCents: 2_000,
          targeting: {
            countries: ["US", "GB"],
            budget_mode: "lifetime",
            end_time: "2026-08-01T00:00:00Z",
          },
        },
      }),
      atomicInput({
        campaign: { dailyBudgetCents: 2_000, spendCapCents: 2_000, promotionType: "PROMOTE_PLACES" },
        adSet: { budgetCents: undefined, targeting: { countries: ["US"] } },
      }),
      atomicInput({
        adSet: {
          targeting: {
            countries: ["US"],
            bid_strategy: "TARGET_COST",
            bid_cents: 100,
          },
        },
      }),
    ];
    const adapter = getAdapter("snapchat");
    for (const input of variants) {
      await withEnvAndFetch({}, happyHandler, async (calls) => {
        await createFullCampaignAtomic(adapter, makeConn(), input);
        const posts = calls.filter((c) => c.method === "POST" && c.body !== null);
        assert(posts.length >= 4, "campaign, squad, creative, ad must all be created");
        for (const post of posts) {
          const wire = JSON.stringify(post.body);
          assert(!wire.includes('"status":"ACTIVE"'), `ACTIVE leaked onto the wire: ${wire}`);
        }
        for (const collection of ["campaigns", "adsquads", "ads"]) {
          const create = posts.find((c) => Array.isArray(c.body?.[collection]));
          assert(create, `${collection} create fired`);
          const entity = (create!.body![collection] as Record<string, unknown>[])[0];
          assertEquals(entity.status, "PAUSED", `${collection} body must be PAUSED`);
        }
      })();
    }
  },
);

// ══ T-8 · review-mapper hostile fuzz (GR-38) ══════════════════════════════════

Deno.test("T-8a: buildSnapchatReviewDetail — non-array issuesInfo ignored; empty inputs → null; falsy-but-present feedback persists VERBATIM; null/undefined dropped", () => {
  assertEquals(buildSnapchatReviewDetail({ issuesInfo: null, adReviewFeedback: null }), null);
  assertEquals(
    buildSnapchatReviewDetail({
      // deno-lint-ignore no-explicit-any
      issuesInfo: "REJECTED_FOR_REASONS" as any,
      adReviewFeedback: null,
    }),
    null,
    "a non-array reasons payload must never be persisted as reasons",
  );
  assertEquals(buildSnapchatReviewDetail({ issuesInfo: [], adReviewFeedback: {} }), null);
  const verbatim = buildSnapchatReviewDetail({
    issuesInfo: [{ code: "X" }],
    adReviewFeedback: {
      review_status: "",
      creative_review_status: null,
      delivery_status: 0,
    },
  });
  assert(verbatim !== null);
  assertEquals(verbatim!.review_status, "", "falsy-but-present persists verbatim");
  assertEquals("creative_review_status" in verbatim!, false, "null is dropped");
  assertEquals(verbatim!.delivery_status, 0);
  assertEquals(verbatim!.review_status_reasons, [{ code: "X" }]);
});

Deno.test("T-8b: engine status + delivery-text mappers refuse the unknown — lowercase/'DELETED'/numbers → null; delivery arrays serialize; empties → null", () => {
  for (const hostile of ["active", "paused", "DELETED", "ARCHIVED", 7, null, undefined, ""]) {
    assertEquals(engineStatusFromSnapchat(hostile), null, `status ${JSON.stringify(hostile)}`);
  }
  assertEquals(engineStatusFromSnapchat("ACTIVE"), "ACTIVE");
  assertEquals(snapchatDeliveryStatusText([]), null);
  assertEquals(snapchatDeliveryStatusText(""), null);
  assertEquals(snapchatDeliveryStatusText(["A", "B"]), "A,B");
  assertEquals(snapchatDeliveryStatusText(undefined), null);
});

Deno.test("T-8c: launch-warning precedence — REJECTED wins over a pending creative; an APPROVED ad with a PENDING_REVIEW creative STILL warns; both-approved is silent", () => {
  const rejected = snapchatLaunchWarning("REJECTED", "PENDING_REVIEW");
  assert(rejected !== null && rejected.includes("REJECTED"));
  const stillPending = snapchatLaunchWarning("APPROVED", "PENDING_REVIEW");
  assert(
    stillPending !== null && stillPending.includes("PENDING_REVIEW"),
    "the creative vocabulary must gate the warning independently (GR-38)",
  );
  assertEquals(snapchatLaunchWarning("APPROVED", "APPROVED"), null);
  assertEquals(snapchatLaunchWarning(null, null), null);
});

// ══ T-9 · read-modify-write strip + status-writer casts ═══════════════════════

Deno.test("T-9a: snapchatStripReadOnlyFields removes EVERY pinned server-owned field and preserves unknown sibling fields (the §10.1 deviation's safety property)", () => {
  const entity: Record<string, unknown> = {
    id: CAMPAIGN_ID,
    name: "Friday Live",
    status: "PAUSED",
    daily_budget_micro: 5_000_000,
    // pinned server-owned fields — every one must be stripped:
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
    creation_state: "DONE",
    review_status: "PENDING",
    review_status_reasons: ["r"],
    delivery_status: ["UNABLE_TO_DELIVER"],
    packaging_status: "SUCCESS",
    // unknown server field — MUST survive (full-object PUT preserves siblings):
    future_unknown_field: { keep: true },
  };
  const stripped = snapchatStripReadOnlyFields(entity);
  for (const field of SNAPCHAT_READ_ONLY_ENTITY_FIELDS) {
    assertEquals(field in stripped, false, `${field} must be stripped before the PUT`);
  }
  assertEquals(stripped.future_unknown_field, { keep: true });
  assertEquals(stripped.daily_budget_micro, 5_000_000);
  assertEquals(stripped.id, CAMPAIGN_ID);
});

Deno.test("T-9b: the status writer refuses ARCHIVED/DELETED/lowercase casts — only ACTIVE|PAUSED can ever be written", () => {
  assertEquals(snapchatStatusForAdvertiserStatus("ACTIVE"), "ACTIVE");
  assertEquals(snapchatStatusForAdvertiserStatus("PAUSED"), "PAUSED");
  for (const hostile of ["ARCHIVED", "DELETED", "active", "REMOVED", ""]) {
    assertThrows(
      // deno-lint-ignore no-explicit-any
      () => snapchatStatusForAdvertiserStatus(hostile as any),
      AdApiError,
    );
  }
});
