// ISSUE-1184 implementor regression — no live provider calls or objects.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { AdConnectionRow } from "../adChannel.ts";
import {
  boundedRetryAfterSeconds,
  capabilityFor,
  CreativeTrustError,
  md5Hex,
  PREPARE_PROVIDER_ADAPTERS,
  ProviderRateLimitError,
} from "../adCreativePrepare.ts";
import { AdDestinationError, resolveAdDestination } from "../adDestination.ts";

Deno.test("ISSUE-1184 MD5 uses known vectors and capabilities stay narrow", () => {
  assertEquals(
    md5Hex(new TextEncoder().encode("")),
    "d41d8cd98f00b204e9800998ecf8427e",
  );
  assertEquals(
    md5Hex(new TextEncoder().encode("abc")),
    "900150983cd24fb0d6963f7d28e17f72",
  );
  assertEquals(capabilityFor("meta"), "create_and_real_preview");
  assertEquals(capabilityFor("snapchat"), "create_and_approx_preview");
  assertEquals(capabilityFor("tiktok"), "preview_only");
});

function fakeDb(
  row: Record<string, unknown> | null,
  error: { message: string } | null = null,
) {
  const query: Record<string, unknown> = {};
  query.eq = () => query;
  query.in = () => query;
  query.maybeSingle = () => Promise.resolve({ data: row, error });
  return { from: () => ({ select: () => query }) };
}

Deno.test("ISSUE-1184 shared destination emits the canonical public event URL", async () => {
  Deno.env.set("BUSINESS_WEB_ORIGIN", "https://business.usemingla.com");
  const resolved = await resolveAdDestination(fakeDb({ id: "event-1" }), {
    page_type: "event",
    brand_slug: "mingla-house",
    entity_slug: "friday-night",
  });
  assertEquals(
    resolved.canonical_url,
    "https://business.usemingla.com/e/mingla-house/friday-night",
  );
  assertEquals(resolved.event_id, "event-1");
});

Deno.test("ISSUE-1184 destination rejects arbitrary/unknown URL fields", async () => {
  await assertRejects(
    () =>
      resolveAdDestination(fakeDb({ id: "event-1" }), {
        page_type: "brand",
        brand_slug: "mingla",
        destination_url: "https://attacker.invalid/",
      }),
    AdDestinationError,
    "Destination field",
  );
});

Deno.test("ISSUE-1184 Meta saves the provider video id before poster work", async () => {
  Deno.env.set("META_SYSTEM_USER_TOKEN", "test-token");
  Deno.env.set("META_AD_ACCOUNT_ID", "account");
  Deno.env.set("META_PAGE_ID", "page");
  const calls: string[] = [];
  const connection: AdConnectionRow = {
    id: "connection",
    platform: "meta",
    lane: "consumer",
    display_name: "Meta",
    external_account_id: "account",
    external_org_id: null,
    auth_kind: "system_user_token",
    token_env_var: "META_SYSTEM_USER_TOKEN",
    extra: { graph_api_version: "v23.0" },
    status: "connected",
    currency: "USD",
    timezone: "UTC",
    min_daily_budget_cents: 100,
    account_status: "ACTIVE",
    token_last_verified_at: null,
    connected: true,
  };
  const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`fetch:${init?.method}`);
    return Promise.resolve(
      new Response(JSON.stringify({ id: "video-stable-id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  await PREPARE_PROVIDER_ADAPTERS.meta.initiate(
    {
      id: "creative",
      kind: "video",
      name: "video",
      source_url: null,
      storage_bucket: null,
      storage_path: null,
      bunny_video_id: "bunny",
      poster_url: "https://cdn/poster.jpg",
      mp4_master_url: "https://cdn/master.mp4",
      place_id: null,
      brand_id: null,
      width: 1080,
      height: 1920,
      aspect_ratio: 0.5625,
      duration_seconds: 10,
      mime_type: "video/mp4",
      byte_size: 3,
      has_audio: true,
      content_hash: "hash",
      poster_content_hash: "poster-hash",
      ai_generated: false,
      variants: {},
      status: "active",
    },
    connection,
    { video: new Uint8Array([1, 2, 3]), poster: new Uint8Array([4, 5]) },
    {
      saveProviderRef: (ref) => {
        calls.push(`save:${ref}`);
        return Promise.resolve(false); // stale CAS: adapter must stop immediately
      },
      mergeProviderExtra: () => Promise.resolve(true),
      markProcessing: () => Promise.resolve(true),
    },
    { fetchImpl },
  );
  assertEquals(calls, ["fetch:POST", "save:video-stable-id"]);
});

Deno.test("ISSUE-1184 create wiring requires exact READY refs and PAUSED persistence", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assertStringIncludes(source, '.eq("external_kind", "video")');
  assertStringIncludes(source, '.eq("content_hash", libCreative.content_hash)');
  assertStringIncludes(source, '.eq("status", "ready")');
  assertStringIncludes(source, "video_preparation_required");
  assertStringIncludes(source, 'status: "PAUSED"');
  assertStringIncludes(source, "metaCreativeLibraryRowId");
});

Deno.test("ISSUE-1184 TikTok readiness selects the requested video and validates preview truth", async () => {
  Deno.env.set("TIKTOK_TEST_TOKEN", "test-token");
  const connection = {
    id: "connection",
    platform: "tiktok",
    lane: "consumer",
    display_name: "TikTok",
    external_account_id: "advertiser",
    external_org_id: null,
    auth_kind: "dev_token_oauth",
    token_env_var: "TIKTOK_TEST_TOKEN",
    extra: {},
    status: "connected",
    currency: "USD",
    timezone: "UTC",
    min_daily_budget_cents: 100,
    account_status: "ACTIVE",
    token_last_verified_at: null,
    connected: true,
  } satisfies AdConnectionRow;
  const valid = {
    video_id: "requested-video",
    displayable: true,
    preview_url: "https://preview.example/requested",
    preview_url_expire_time: "2030-01-01T00:00:00.000Z",
  };
  const check = (list: Record<string, unknown>[]) =>
    PREPARE_PROVIDER_ADAPTERS.tiktok.check(
      "material",
      { video_id: "requested-video" },
      connection,
      {
        fetchImpl: () =>
          Promise.resolve(
            new Response(JSON.stringify({ code: 0, data: { list } }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
      },
    );

  const exact = await check([
    {
      ...valid,
      video_id: "wrong-video",
      preview_url: "https://preview.example/wrong",
    },
    valid,
  ]);
  assertEquals(exact.state, "ready");
  assertEquals(
    exact.preview?.external_url,
    "https://preview.example/requested",
  );

  for (
    const unready of [
      [{ ...valid, video_id: "wrong-video" }],
      [{ ...valid, displayable: false }],
      [{ ...valid, preview_url: "" }],
      [{ ...valid, preview_url: "http://preview.example/requested" }],
      [{ ...valid, preview_url_expire_time: "not-a-date" }],
    ]
  ) {
    assertEquals((await check(unready)).state, "processing");
  }
});

Deno.test("ISSUE-1184 Snapchat preserves 429 and caps provider Retry-After", async () => {
  Deno.env.set("SNAPCHAT_REFRESH_TOKEN", "refresh");
  Deno.env.set("SNAPCHAT_CLIENT_ID", "client");
  Deno.env.set("SNAPCHAT_CLIENT_SECRET", "secret");
  const connection = {
    id: "connection",
    platform: "snapchat",
    lane: "consumer",
    display_name: "Snapchat",
    external_account_id: "account",
    external_org_id: null,
    auth_kind: "refresh_token",
    token_env_var: "SNAPCHAT_REFRESH_TOKEN",
    extra: {},
    status: "connected",
    currency: "USD",
    timezone: "UTC",
    min_daily_budget_cents: 100,
    account_status: "ACTIVE",
    token_last_verified_at: null,
    connected: true,
  } satisfies AdConnectionRow;
  let calls = 0;
  const error = await assertRejects(
    () =>
      PREPARE_PROVIDER_ADAPTERS.snapchat.check(
        "media-id",
        {},
        connection,
        {
          fetchImpl: () => {
            calls += 1;
            if (calls === 1) {
              return Promise.resolve(
                new Response(JSON.stringify({ access_token: "minted" }), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }),
              );
            }
            return Promise.resolve(
              new Response(
                JSON.stringify({ request_status: "TOO_MANY_REQUESTS" }),
                {
                  status: 429,
                  headers: {
                    "content-type": "application/json",
                    "retry-after": "120",
                  },
                },
              ),
            );
          },
        },
      ),
    ProviderRateLimitError,
  );
  assertEquals(error.retryAfterSeconds, 60);
  assertEquals(calls, 2);
  const now = Date.parse("2026-07-24T12:00:00.000Z");
  assertEquals(
    boundedRetryAfterSeconds("Fri, 24 Jul 2026 12:00:12 GMT", now),
    12,
  );
});

Deno.test("ISSUE-1184 prepare maps rate limits and both CAS audit failures explicitly", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-creative-prepare/index.ts", import.meta.url),
  );
  assertEquals(
    source.match(/error instanceof ProviderRateLimitError/g)?.length,
    2,
  );
  const rateLimitBlocks = [
    ...source.matchAll(
      /if \(error instanceof ProviderRateLimitError\) \{([\s\S]*?)\n      \}/g,
    ),
  ];
  assertEquals(rateLimitBlocks.length, 2);
  for (const block of rateLimitBlocks) {
    assertStringIncludes(block[1], "429");
    assert(!block[1].includes("cas("));
  }
  assertStringIncludes(source, 'errorCode: "provider_rate_limited"');
  assertStringIncludes(source, 'initiateStopResult === "audit_failed"');
  assertStringIncludes(source, 'resumeStopResult === "audit_failed"');
  assert(!source.includes('row.current_error_code === "audit_write_failed"'));
});
