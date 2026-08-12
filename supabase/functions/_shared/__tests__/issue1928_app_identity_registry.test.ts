import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  AdApiError,
  type AdConnectionRow,
  AdNotConnectedError,
} from "../adChannel.ts";
import {
  type AdAppProviderIdentityRow,
  parseAdvertisingApp,
  parseProviderIdentity,
  resolvePayerConnection,
  selectExactTikTokIdentity,
} from "../adAppIdentityRegistry.ts";
import {
  metaCheckPageAdvertiseTaskForIdentity,
  type MetaClient,
  metaFetchIgBusinessAccountForIdentity,
  metaValidateOnlyCreativeProbeForIdentity,
} from "../meta.ts";
import {
  type TikTokClient,
  tiktokFetchIdentities,
  type TikTokIdentitySnapshot,
} from "../tiktok.ts";

const CONNECTIONS: AdConnectionRow[] = ["meta", "tiktok"].map((
  platform,
  index,
) => ({
  id: `00000000-0000-0000-0000-00000000000${index + 1}`,
  platform: platform as "meta" | "tiktok",
  lane: "consumer",
  display_name: `shared ${platform}`,
  external_account_id: platform === "meta"
    ? "2393570861066813"
    : "7627974536397766673",
  external_org_id: null,
  auth_kind: "system_user_token",
  token_env_var: "TEST_TOKEN",
  extra: {},
  status: "connected",
  currency: "USD",
  timezone: null,
  min_daily_budget_cents: null,
  account_status: "ACTIVE",
  token_last_verified_at: null,
  connected: true,
}));

// Import adChannel as the runtime entry point before its provider adapters. This
// mirrors production initialization and protects the adapter registry cycle.
assert(AdNotConnectedError.prototype instanceof Error);

const ROWS: AdAppProviderIdentityRow[] = [
  {
    id: "1",
    app_key: "explorer",
    provider: "meta",
    payer_lane: "consumer",
    expected_username: "usemingla",
    meta_page_id: "797406353459597",
    meta_instagram_user_id: "17841477287060530",
    tiktok_identity_id: null,
    tiktok_identity_type: null,
    active: true,
  },
  {
    id: "2",
    app_key: "business",
    provider: "meta",
    payer_lane: "consumer",
    expected_username: "minglahost",
    meta_page_id: "1223994124127087",
    meta_instagram_user_id: "17841422359567322",
    tiktok_identity_id: null,
    tiktok_identity_type: null,
    active: true,
  },
  {
    id: "3",
    app_key: "explorer",
    provider: "tiktok",
    payer_lane: "consumer",
    expected_username: "usemingla",
    meta_page_id: null,
    meta_instagram_user_id: null,
    tiktok_identity_id: "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5",
    tiktok_identity_type: "TT_USER",
    active: true,
  },
  {
    id: "4",
    app_key: "business",
    provider: "tiktok",
    payer_lane: "consumer",
    expected_username: "minglahost",
    meta_page_id: null,
    meta_instagram_user_id: null,
    tiktok_identity_id: "5ee9bdcb-7520-554d-8452-b32e2f9f43ea",
    tiktok_identity_type: "BC_AUTH_TT",
    active: true,
  },
];

const HOSTILE_IDENTITIES: TikTokIdentitySnapshot[] = [
  {
    identityId: "decoy",
    identityType: "TT_USER",
    username: "usemingla",
    displayName: null,
    availableStatus: "AVAILABLE",
  },
  {
    identityId: "5ee9bdcb-7520-554d-8452-b32e2f9f43ea",
    identityType: "BC_AUTH_TT",
    username: "minglahost",
    displayName: null,
    availableStatus: "AVAILABLE",
  },
  {
    identityId: "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5",
    identityType: "TT_USER",
    username: "usemingla",
    displayName: null,
    availableStatus: "AVAILABLE",
  },
];

Deno.test("#1928 exact app key selects each TikTok identity regardless of hostile list order", () => {
  for (const appKey of ["explorer", "business"] as const) {
    const parsed = parseProviderIdentity(ROWS, appKey, "tiktok");
    assert(parsed.identity?.provider === "tiktok");
    const selected = selectExactTikTokIdentity(
      HOSTILE_IDENTITIES,
      parsed.identity,
    );
    assertEquals(selected.reason, null);
    assertEquals(
      selected.identity?.identityId,
      parsed.identity.tiktok_identity_id,
    );
    assertEquals(
      selected.identity?.identityType,
      parsed.identity.tiktok_identity_type,
    );
    const payer = resolvePayerConnection(CONNECTIONS, parsed.identity);
    assertEquals(payer.connection?.id, CONNECTIONS[1].id);
  }
});

Deno.test("#1928 exact selector fails closed for wrong type, unavailable, and username mismatch", () => {
  const parsed = parseProviderIdentity(ROWS, "business", "tiktok");
  assert(parsed.identity?.provider === "tiktok");
  const expected = parsed.identity;
  assertEquals(
    selectExactTikTokIdentity([{
      ...HOSTILE_IDENTITIES[1],
      identityType: "TT_USER",
    }], expected).reason,
    "identity_type_mismatch",
  );
  assertEquals(
    selectExactTikTokIdentity([{
      ...HOSTILE_IDENTITIES[1],
      availableStatus: "UNAVAILABLE",
    }], expected).reason,
    "identity_unavailable",
  );
  assertEquals(
    selectExactTikTokIdentity([{
      ...HOSTILE_IDENTITIES[1],
      username: "usemingla",
    }], expected).reason,
    "identity_username_mismatch",
  );
  assertEquals(
    selectExactTikTokIdentity(
      HOSTILE_IDENTITIES.filter((row) =>
        row.identityId !== expected.tiktok_identity_id
      ),
      expected,
    ).reason,
    "identity_not_found",
  );
});

Deno.test("#1928 registry rejects duplicates, inactive apps, and malformed provider shapes before provider access", () => {
  assertEquals(
    parseAdvertisingApp([{
      app_key: "explorer",
      display_name: "Mingla Explorer",
      active: false,
    }], "explorer").reason,
    "app_registry_inactive",
  );
  assertEquals(
    parseAdvertisingApp([{
      app_key: "explorer",
      display_name: "a",
      active: true,
    }, { app_key: "explorer", display_name: "b", active: true }], "explorer")
      .reason,
    "app_registry_missing",
  );
  const malformed = { ...ROWS[0], tiktok_identity_id: "leak" };
  assertEquals(
    parseProviderIdentity([malformed], "explorer", "meta").reason,
    "identity_registry_invalid",
  );
});

Deno.test("#1928 Meta exact probes use only the requested Page/Instagram pair and validate_only", async () => {
  const calls: Array<
    { method: string; url: string; body: Record<string, unknown> | null }
  > = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method: init?.method ?? "GET", url, body });
    if (url.includes("me/accounts")) {
      return Response.json({
        data: [{
          id: "1223994124127087",
          name: "Mingla Business",
          tasks: ["ADVERTISE"],
        }, { id: "797406353459597", tasks: ["ADVERTISE"] }],
      });
    }
    if (url.includes("1223994124127087")) {
      return Response.json({
        instagram_business_account: { id: "17841422359567322" },
      });
    }
    return Response.json({ success: true });
  }) as typeof fetch;
  const client: MetaClient = {
    platform: "meta",
    token: "test-token",
    config: {
      apiVersion: "v25.0",
      graphBase: "https://graph.example",
      adAccountId: "2393570861066813",
      businessId: null,
      pageId: "legacy-page",
      igUserId: null,
      datasetId: null,
    },
  };
  try {
    assert(
      (await metaCheckPageAdvertiseTaskForIdentity(client, "1223994124127087"))
        .ok,
    );
    assertEquals(
      await metaFetchIgBusinessAccountForIdentity(client, "1223994124127087"),
      "17841422359567322",
    );
    const probe = await metaValidateOnlyCreativeProbeForIdentity(client, {
      pageId: "1223994124127087",
      instagramUserId: "17841422359567322",
    });
    assert(probe.ok);
    assertEquals(probe.createdObject, false);
    const post = calls.find((call) => call.method === "POST");
    assertEquals(post?.body?.execution_options, ["validate_only"]);
    const story = post?.body?.object_story_spec as Record<string, unknown>;
    assertEquals(story.page_id, "1223994124127087");
    assertEquals(story.instagram_user_id, "17841422359567322");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("#1928 malformed provider identity responses fail closed", async () => {
  const originalFetch = globalThis.fetch;
  const metaClient: MetaClient = {
    platform: "meta",
    token: "test-token",
    config: {
      apiVersion: "v25.0",
      graphBase: "https://graph.example",
      adAccountId: "2393570861066813",
      businessId: null,
      pageId: "797406353459597",
      igUserId: null,
      datasetId: null,
    },
  };
  const tiktokClient: TikTokClient = {
    platform: "tiktok",
    token: "test-token",
    advertiserId: "7627974536397766673",
    apiVersion: "v1.3",
    apiBase: "https://tiktok.example",
  };
  try {
    globalThis.fetch = (async () => Response.json({})) as typeof fetch;
    await assertRejects(
      () =>
        metaCheckPageAdvertiseTaskForIdentity(
          metaClient,
          "797406353459597",
        ),
      AdApiError,
      "invalid Page authorization response",
    );
    globalThis.fetch = (async () =>
      Response.json({ code: 0, message: "OK", data: {} })) as typeof fetch;
    await assertRejects(
      () =>
        tiktokFetchIdentities(tiktokClient),
      AdApiError,
      "invalid identity discovery response",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
