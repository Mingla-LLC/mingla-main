import { handleEventCoverVideoUploadIntent } from "./index.ts";

const OP = "33a18413-bfbf-4087-9ba7-45f70deba0f3";
const USER = "44a18413-bfbf-4087-9ba7-45f70deba0f3";
const body = {
  applyMode: "published_manual",
  brandId: "22a18413-bfbf-4087-9ba7-45f70deba0f3",
  eventId: "09b4ece6-eabc-4734-8ce3-3a25d90417e4",
  clientOperationId: OP,
  sourceBytes: 1024,
  sourceDurationMs: 12_000,
  sourceFileName: "cover.mp4",
  sourceMimeType: "video/mp4",
  sourceExtension: "mp4",
  sourceSha256: "c".repeat(64),
  trimStartMs: 0,
  trimEndMs: 12_000,
};
const request = () =>
  new Request("https://test/intent", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

Deno.test("#2715 concurrent same-operation intents allocate exactly one provider asset and replay its transport", async () => {
  let job: Record<string, unknown> = {
    id: "job-race",
    status: "source_uploading",
    provider: "bunny",
    brand_id: body.brandId,
    event_id: body.eventId,
    target_kind: "event",
    apply_mode: "published_manual",
    source_bytes: 1024,
    source_asset_id: null,
    tus_resource_url: null,
    tus_upload_offset: 0,
    provider_allocation_lease_until: new Date(Date.now() + 60_000)
      .toISOString(),
  };
  let leased = false, creates = 0, tusCreates = 0;
  const claimTokens: Array<string | null> = [];
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "cover_video_create_or_replay_job") {
        return Promise.resolve({
          data: { ...job },
          error: null,
        });
      }
      if (name === "cover_video_claim_provider_allocation") {
        if (leased || job.source_asset_id) {
          claimTokens.push(null);
          return Promise.resolve({
            data: { ...job, provider_allocation_token: null },
            error: null,
          });
        }
        leased = true;
        claimTokens.push("lease");
        return Promise.resolve({
          data: { ...job, provider_allocation_token: "lease" },
          error: null,
        });
      }
      if (name === "cover_video_begin_provider_create") {
        job = {
          ...job,
          provider_allocation_identity: job.id,
          provider_allocation_uncertain_at: new Date().toISOString(),
        };
        return Promise.resolve({
          data: { ...job, provider_allocation_token: "lease" },
          error: null,
        });
      }
      if (name === "cover_video_commit_provider_allocation") {
        job = {
          ...job,
          source_asset_id: args.p_source_asset_id,
          tus_resource_url: args.p_tus_url,
          tus_upload_length: args.p_tus_length,
        };
        leased = false;
        return Promise.resolve({ data: { ...job }, error: null });
      }
      if (name === "cover_video_record_provider_allocation_attempt") {
        job = {
          ...job,
          source_asset_id: args.p_source_asset_id,
          source_public_id: args.p_source_asset_id,
          provider_allocation_uncertain_at: null,
        };
        return Promise.resolve({
          data: { ...job, provider_allocation_token: "lease" },
          error: null,
        });
      }
      if (name === "cover_video_renew_provider_allocation") {
        return Promise
          .resolve({ data: true, error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const deps = {
    bunnyCreateVideo: async () => {
      creates += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { ok: true as const, guid: "one-guid" };
    },
    bunnyFindVideoByTitle: () =>
      Promise.resolve({ ok: true as const, guid: null }),
    bunnyPresignTusUpload: () =>
      Promise.resolve({
        tusEndpoint: "https://tus",
        libraryId: "lib",
        videoId: "one-guid",
        authorizationSignature: "sig",
        authorizationExpire: 2_000_000_000,
      }),
    checkBunnyCapacity: () =>
      Promise.resolve({ blocked: false, reason: "under_cap", usedPercent: 1 }),
    destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
    providerConfigured: () => true,
    reapSupersededBunnyAssets: () => Promise.resolve(),
    requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
    requireUserId: () => Promise.resolve(USER),
    serviceRoleClient: () => client,
  };
  const old = globalThis.fetch;
  globalThis.fetch = (async () => {
    tusCreates += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(null, {
      status: 201,
      headers: { location: "/resource" },
    });
  }) as typeof fetch;
  try {
    const [a, b] = await Promise.all([
      handleEventCoverVideoUploadIntent(request(), deps as never),
      handleEventCoverVideoUploadIntent(request(), deps as never),
    ]);
    assert(
      [a.status, b.status].sort().join(",") === "200,202",
      `delayed allocation must return one descriptor and one active initializing truth, got ${a.status}/${b.status}`,
    );
    assert(
      creates === 1 && tusCreates === 1,
      "concurrent replay allocated more than once",
    );
    const initializing = a.status === 202 ? await a.json() : await b.json();
    assert(
      initializing.initializing === true && initializing.jobId === "job-race" &&
        initializing.status.status === "source_uploading",
      "allocation loser did not receive retryable active canonical truth",
    );
    assert(
      claimTokens.filter((token) => token === "lease").length === 1,
      "exactly one allocator must own the DB lease token",
    );
    assert(
      claimTokens.includes(null),
      "the allocation loser must receive a token-free canonical projection",
    );
    const replay = await handleEventCoverVideoUploadIntent(
      request(),
      deps as never,
    );
    const payload = await replay.json();
    assert(replay.status === 200, "settled replay failed");
    assert(
      payload.jobId === "job-race" &&
        payload.upload.url === "https://tus/resource",
      "replay did not return canonical job transport",
    );
    assert(
      creates === 1 && tusCreates === 1,
      "settled replay reallocated provider resource",
    );
  } finally {
    globalThis.fetch = old;
  }
});

Deno.test("#2715 edge-first rollout returns retryable 503 with zero provider calls before the migration", async () => {
  let providerCalls = 0;
  const client = {
    rpc: (name: string) => {
      assert(
        name === "cover_video_create_or_replay_job",
        "only the contract capability RPC may run",
      );
      return Promise.resolve({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find cover_video_create_or_replay_job",
        },
      });
    },
  };
  const deps = {
    bunnyCreateVideo: async () => {
      providerCalls += 1;
      return { ok: true as const, guid: "forbidden" };
    },
    bunnyPresignTusUpload: async () => {
      providerCalls += 1;
      throw new Error("forbidden");
    },
    checkBunnyCapacity: async () => {
      providerCalls += 1;
      return { blocked: false, reason: "under_cap", usedPercent: 1 };
    },
    destroyCoverVideoAsset: async () => {
      providerCalls += 1;
      return { ok: true as const };
    },
    providerConfigured: () => true,
    reapSupersededBunnyAssets: async () => {
      providerCalls += 1;
    },
    requireCoverVideoTargetManager: async () => ({ target: {} }),
    requireUserId: async () => USER,
    serviceRoleClient: () => client,
  };
  const response = await handleEventCoverVideoUploadIntent(
    request(),
    deps as never,
  );
  const payload = await response.json();
  assert(
    response.status === 503 &&
      payload.error === "upload_temporarily_unavailable",
    "pre-migration bridge must fail closed and retryably",
  );
  assert(
    providerCalls === 0,
    "pre-migration capability failure reached provider I/O",
  );
});

Deno.test("#2715 a PostgREST all-null composite means no replay and proceeds to one allocation", async () => {
  const canonical: Record<string, unknown> = {
    id: "77777777-7777-4777-8777-777777777777",
    status: "source_uploading",
    provider: "bunny",
    brand_id: body.brandId,
    event_id: body.eventId,
    target_kind: "event",
    apply_mode: "published_manual",
    source_bytes: body.sourceBytes,
    source_asset_id: null,
    tus_resource_url: null,
    tus_upload_offset: 0,
  };
  let accepted = 0, creates = 0;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "cover_video_create_or_replay_job") {
        if (args.p_accept_new === false) {
          return {
            data: {
              id: null,
              status: null,
              provider: null,
              brand_id: null,
              event_id: null,
              target_kind: null,
            },
            error: null,
          };
        }
        accepted += 1;
        return { data: { ...canonical }, error: null };
      }
      if (name === "cover_video_claim_provider_allocation") {
        return {
          data: { ...canonical, provider_allocation_token: "lease" },
          error: null,
        };
      }
      if (name === "cover_video_begin_provider_create") {
        return {
          data: {
            ...canonical,
            provider_allocation_token: "lease",
            provider_allocation_identity: canonical.id,
          },
          error: null,
        };
      }
      if (name === "cover_video_record_provider_allocation_attempt") {
        canonical.source_asset_id = args.p_source_asset_id;
        return {
          data: { ...canonical, provider_allocation_token: "lease" },
          error: null,
        };
      }
      if (name === "cover_video_renew_provider_allocation") {
        return { data: true, error: null };
      }
      if (name === "cover_video_commit_provider_allocation") {
        canonical.tus_resource_url = args.p_tus_url;
        return { data: { ...canonical }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: canonical, error: null }) }),
      }),
    }),
  };
  const deps = {
    bunnyCreateVideo: async () => {
      creates += 1;
      return { ok: true as const, guid: "null-composite-guid" };
    },
    bunnyFindVideoByTitle: () => Promise.resolve({ ok: true as const, guid: null }),
    bunnyPresignTusUpload: () => Promise.resolve({
      tusEndpoint: "https://tus",
      libraryId: "lib",
      videoId: "null-composite-guid",
      authorizationSignature: "sig",
      authorizationExpire: 2_000_000_000,
    }),
    checkBunnyCapacity: () => Promise.resolve({ blocked: false, reason: "under_cap", usedPercent: 1 }),
    destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
    providerConfigured: () => true,
    reapSupersededBunnyAssets: () => Promise.resolve(),
    requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
    requireUserId: () => Promise.resolve(USER),
    serviceRoleClient: () => client,
  };
  const old = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(null, {
    status: 201,
    headers: { location: "/resource" },
  }))) as typeof fetch;
  try {
    const response = await handleEventCoverVideoUploadIntent(request(), deps as never);
    const payload = await response.json();
    assert(response.status === 200, `all-null composite crashed or failed: ${response.status}`);
    assert(payload.jobId === canonical.id && payload.upload?.protocol === "tus", "new canonical descriptor missing");
    assert(accepted === 1 && creates === 1, "all-null composite did not allocate exactly once");
  } finally {
    globalThis.fetch = old;
  }
});

Deno.test("#2715 old clients without immutable identity receive 426 before database or provider access", async () => {
  let dbCalls = 0, providerCalls = 0;
  const legacy = {
    ...body,
    clientOperationId: undefined,
    sourceSha256: undefined,
  };
  const legacyRequest = new Request("https://test/intent", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(legacy),
  });
  const deps = {
    bunnyCreateVideo: async () => {
      providerCalls += 1;
      return { ok: true as const, guid: "forbidden" };
    },
    bunnyPresignTusUpload: async () => {
      providerCalls += 1;
      throw new Error("forbidden");
    },
    checkBunnyCapacity: async () => {
      providerCalls += 1;
      return { blocked: false, reason: "under_cap", usedPercent: 1 };
    },
    destroyCoverVideoAsset: async () => {
      providerCalls += 1;
      return { ok: true as const };
    },
    providerConfigured: () => true,
    reapSupersededBunnyAssets: async () => {
      providerCalls += 1;
    },
    requireCoverVideoTargetManager: async () => ({ target: {} }),
    requireUserId: async () => USER,
    serviceRoleClient: () => ({
      rpc: () => {
        dbCalls += 1;
        throw new Error("forbidden");
      },
    }),
  };
  const response = await handleEventCoverVideoUploadIntent(
    legacyRequest,
    deps as never,
  );
  const payload = await response.json();
  assert(
    response.status === 426 && payload.error === "client_version_required",
    "legacy client must receive an upgrade response",
  );
  assert(
    dbCalls === 0 && providerCalls === 0,
    "legacy request reached database/provider allocation",
  );
});

Deno.test("#2715 uncertain allocation commit rereads canonical transport and never deletes it", async () => {
  let destroys = 0;
  const canonical: Record<string, unknown> = {
    id: "job-commit",
    status: "source_uploading",
    provider: "bunny",
    brand_id: body.brandId,
    event_id: body.eventId,
    target_kind: "event",
    apply_mode: "published_manual",
    source_bytes: 1024,
    source_asset_id: null,
    tus_resource_url: null,
    tus_upload_offset: 0,
  };
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "cover_video_create_or_replay_job") {
        return {
          data: { ...canonical },
          error: null,
        };
      }
      if (name === "cover_video_claim_provider_allocation") {
        return {
          data: { ...canonical, provider_allocation_token: "lease" },
          error: null,
        };
      }
      if (name === "cover_video_begin_provider_create") {
        canonical.provider_allocation_identity = canonical.id;
        canonical.provider_allocation_uncertain_at = new Date().toISOString();
        return {
          data: { ...canonical, provider_allocation_token: "lease" },
          error: null,
        };
      }
      if (name === "cover_video_renew_provider_allocation") {
        return {
          data: true,
          error: null,
        };
      }
      if (name === "cover_video_record_provider_allocation_attempt") {
        canonical.source_asset_id = args.p_source_asset_id;
        return {
          data: { ...canonical, provider_allocation_token: "lease" },
          error: null,
        };
      }
      if (name === "cover_video_commit_provider_allocation") {
        canonical.source_asset_id = args.p_source_asset_id;
        canonical.tus_resource_url = args.p_tus_url;
        return { data: null, error: { message: "response lost" } };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { ...canonical }, error: null }),
        }),
      }),
    }),
  };
  const deps = {
    bunnyCreateVideo: () =>
      Promise.resolve({ ok: true as const, guid: "commit-guid" }),
    bunnyFindVideoByTitle: () =>
      Promise.resolve({ ok: true as const, guid: null }),
    bunnyPresignTusUpload: () =>
      Promise.resolve({
        tusEndpoint: "https://tus",
        libraryId: "lib",
        videoId: "commit-guid",
        authorizationSignature: "sig",
        authorizationExpire: 2_000_000_000,
      }),
    checkBunnyCapacity: () =>
      Promise.resolve({ blocked: false, reason: "under_cap", usedPercent: 1 }),
    destroyCoverVideoAsset: () => {
      destroys += 1;
      return Promise.resolve({ ok: true as const });
    },
    providerConfigured: () => true,
    reapSupersededBunnyAssets: () => Promise.resolve(),
    requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
    requireUserId: () => Promise.resolve(USER),
    serviceRoleClient: () => client,
  };
  const old = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 201,
        headers: { location: "/committed" },
      }),
    )) as typeof fetch;
  try {
    const response = await handleEventCoverVideoUploadIntent(
      request(),
      deps as never,
    );
    const payload = await response.json();
    assert(
      response.status === 200 && payload.upload.url === "https://tus/committed",
      "canonical commit was not recovered",
    );
    assert(destroys === 0, "uncertain canonical allocation was deleted");
  } finally {
    globalThis.fetch = old;
  }
});

Deno.test("#2715 lost Bunny Create response is reconciled by deterministic title before another Create", async () => {
  let failedTransitions = 0,
    destroys = 0,
    creates = 0,
    lookups = 0,
    tusCreates = 0;
  let assetExists = false;
  let job: Record<string, unknown> = {
    id: "job-create-uncertain",
    status: "source_uploading",
    provider: "bunny",
    brand_id: body.brandId,
    event_id: body.eventId,
    target_kind: "event",
    apply_mode: "published_manual",
    source_bytes: 1024,
    source_asset_id: null,
    tus_resource_url: null,
    tus_upload_offset: 0,
    provider_allocation_lease_until: new Date(Date.now() + 60_000)
      .toISOString(),
    provider_allocation_token: null,
    provider_allocation_identity: null,
    provider_allocation_uncertain_at: null,
  };
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "cover_video_create_or_replay_job") {
        return {
          data: { ...job },
          error: null,
        };
      }
      if (name === "cover_video_claim_provider_allocation") {
        job = {
          ...job,
          provider_allocation_token: "lease",
          provider_allocation_lease_until: new Date(Date.now() + 60_000)
            .toISOString(),
        };
        return { data: { ...job }, error: null };
      }
      if (name === "cover_video_renew_provider_allocation") {
        return {
          data: true,
          error: null,
        };
      }
      if (name === "cover_video_begin_provider_create") {
        job = {
          ...job,
          provider_allocation_identity: job.id,
          provider_allocation_uncertain_at: new Date().toISOString(),
        };
        return { data: { ...job }, error: null };
      }
      if (name === "cover_video_resolve_provider_allocation") {
        job = {
          ...job,
          source_asset_id: args.p_source_asset_id,
          provider_allocation_uncertain_at: null,
        };
        return { data: { ...job }, error: null };
      }
      if (name === "cover_video_record_provider_allocation_attempt") {
        job = { ...job, provider_allocation_last_error: args.p_error };
        return { data: { ...job }, error: null };
      }
      if (name === "cover_video_commit_provider_allocation") {
        job = {
          ...job,
          source_asset_id: args.p_source_asset_id,
          tus_resource_url: args.p_tus_url,
          provider_allocation_token: null,
        };
        return { data: { ...job }, error: null };
      }
      if (name === "cover_video_transition_job") {
        failedTransitions += 1;
        return { data: { ...job, status: "failed" }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  const deps = {
    bunnyCreateVideo: () => {
      creates += 1;
      assetExists = true;
      return Promise.resolve({
        ok: false as const,
        reason: "bunny_create_network",
        retryable: true,
      });
    },
    bunnyFindVideoByTitle: () => {
      lookups += 1;
      return Promise.resolve({
        ok: true as const,
        guid: assetExists ? "lost-response-guid" : null,
      });
    },
    bunnyPresignTusUpload: () =>
      Promise.resolve({
        tusEndpoint: "https://tus",
        libraryId: "lib",
        videoId: "lost-response-guid",
        authorizationSignature: "sig",
        authorizationExpire: 2_000_000_000,
      }),
    checkBunnyCapacity: () =>
      Promise.resolve({ blocked: false, reason: "under_cap", usedPercent: 1 }),
    destroyCoverVideoAsset: () => {
      destroys += 1;
      return Promise.resolve({ ok: true as const });
    },
    providerConfigured: () => true,
    reapSupersededBunnyAssets: () => Promise.resolve(),
    requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
    requireUserId: () => Promise.resolve(USER),
    serviceRoleClient: () => client,
  };
  const old = globalThis.fetch;
  globalThis.fetch = (() => {
    tusCreates += 1;
    return Promise.resolve(
      new Response(null, { status: 201, headers: { location: "/recovered" } }),
    );
  }) as typeof fetch;
  try {
    const first = await handleEventCoverVideoUploadIntent(
      request(),
      deps as never,
    );
    const firstPayload = await first.json();
    assert(
      first.status === 202 && firstPayload.initializing === true,
      "lost Create response did not remain active",
    );
    const second = await handleEventCoverVideoUploadIntent(
      request(),
      deps as never,
    );
    const secondPayload = await second.json();
    assert(
      second.status === 200 &&
        secondPayload.upload.videoId === "lost-response-guid",
      "same-operation retry did not bind provider lookup result",
    );
    assert(
      creates === 1 && lookups === 1 && tusCreates === 1,
      "lost response created more than one provider asset or skipped exact lookup",
    );
    assert(
      failedTransitions === 0 && destroys === 0,
      "transient provider uncertainty terminally failed or deleted",
    );
  } finally {
    globalThis.fetch = old;
  }
});

Deno.test("#2715 lost provider-allocation record response is recovered without a second Bunny asset", async () => {
  let creates = 0, recordCalls = 0, lookups = 0;
  let job: Record<string, unknown> = {
    id: "job-record-uncertain",
    status: "source_uploading",
    provider: "bunny",
    brand_id: body.brandId,
    event_id: body.eventId,
    target_kind: "event",
    apply_mode: "published_manual",
    source_bytes: 1024,
    source_asset_id: null,
    tus_resource_url: null,
    tus_upload_offset: 0,
    provider_allocation_token: null,
    provider_allocation_identity: null,
    provider_allocation_uncertain_at: null,
  };
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "cover_video_create_or_replay_job") {
        return {
          data: { ...job },
          error: null,
        };
      }
      if (name === "cover_video_claim_provider_allocation") {
        job = {
          ...job,
          provider_allocation_token: "lease",
          provider_allocation_lease_until: new Date(Date.now() + 60_000)
            .toISOString(),
        };
        return { data: { ...job }, error: null };
      }
      if (name === "cover_video_renew_provider_allocation") {
        return {
          data: true,
          error: null,
        };
      }
      if (name === "cover_video_begin_provider_create") {
        job = {
          ...job,
          provider_allocation_identity: job.id,
          provider_allocation_uncertain_at: new Date().toISOString(),
        };
        return { data: { ...job }, error: null };
      }
      if (name === "cover_video_record_provider_allocation_attempt") {
        recordCalls += 1;
        return { data: null, error: { message: "response lost" } };
      }
      if (name === "cover_video_resolve_provider_allocation") {
        job = {
          ...job,
          source_asset_id: args.p_source_asset_id,
          provider_allocation_uncertain_at: null,
        };
        return { data: { ...job }, error: null };
      }
      if (name === "cover_video_commit_provider_allocation") {
        job = {
          ...job,
          tus_resource_url: args.p_tus_url,
          provider_allocation_token: null,
        };
        return { data: { ...job }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { ...job }, error: null }),
        }),
      }),
    }),
  };
  const deps = {
    bunnyCreateVideo: () => {
      creates += 1;
      return Promise.resolve({ ok: true as const, guid: "record-lost-guid" });
    },
    bunnyFindVideoByTitle: () => {
      lookups += 1;
      return Promise.resolve({ ok: true as const, guid: "record-lost-guid" });
    },
    bunnyPresignTusUpload: () =>
      Promise.resolve({
        tusEndpoint: "https://tus",
        libraryId: "lib",
        videoId: "record-lost-guid",
        authorizationSignature: "sig",
        authorizationExpire: 2_000_000_000,
      }),
    checkBunnyCapacity: () =>
      Promise.resolve({ blocked: false, reason: "under_cap", usedPercent: 1 }),
    destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
    providerConfigured: () => true,
    reapSupersededBunnyAssets: () => Promise.resolve(),
    requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
    requireUserId: () => Promise.resolve(USER),
    serviceRoleClient: () => client,
  };
  const old = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 201,
        headers: { location: "/record-recovered" },
      }),
    )) as typeof fetch;
  try {
    const first = await handleEventCoverVideoUploadIntent(
      request(),
      deps as never,
    );
    assert(first.status === 202, "lost record response must remain active");
    const second = await handleEventCoverVideoUploadIntent(
      request(),
      deps as never,
    );
    assert(
      second.status === 200,
      "provider-title recovery did not finish allocation",
    );
    assert(
      creates === 1 && recordCalls === 1 && lookups === 1,
      "record-response loss created a duplicate provider asset",
    );
  } finally {
    globalThis.fetch = old;
  }
});
