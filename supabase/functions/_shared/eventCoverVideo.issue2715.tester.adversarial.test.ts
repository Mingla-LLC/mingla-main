import {
  assertProcessedDerivative,
  mapEventCoverVideoStatus,
} from "./eventCoverVideo.ts";
import { hmacSha256Hex } from "./bunnyStream.ts";
import { handleEventCoverVideoUploadIntent } from "../event-cover-video-upload-intent/index.ts";
import { handleReaper } from "../event-cover-video-reaper/index.ts";
import { handleEventCoverVideoWebhook } from "../event-cover-video-webhook/index.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const USER = "27150000-0000-4000-8000-000000000001";
const BRAND = "27150000-0000-4000-8000-000000000002";
const OPERATION = "27150000-0000-4000-8000-000000000003";
const JOB = "27150000-0000-4000-8000-000000000004";
const GUID = "provider-guid-2715";
const SECRET = "issue-2715-tester-webhook-secret";

const intentBody = {
  applyMode: "published_manual",
  brandId: BRAND,
  clientOperationId: OPERATION,
  draftOwnerKey: "draft-cloud-a",
  sourceBytes: 716_949,
  sourceDurationMs: 4_867,
  sourceExtension: "mov",
  sourceFileName: "cloud.mov",
  sourceMimeType: "video/quicktime",
  sourceSha256: "a".repeat(64),
  target: "venue_draft",
  trimEndMs: 4_867,
  trimStartMs: 0,
};

const intentRequest = (): Request =>
  new Request("https://test/intent", {
    body: JSON.stringify(intentBody),
    headers: {
      Authorization: "Bearer tester-token",
      "Content-Type": "application/json",
    },
    method: "POST",
  });

const job = (status: string, operationId = OPERATION) => ({
  apply_mode: "published_manual",
  brand_id: BRAND,
  client_operation_id: operationId,
  draft_owner_key: "draft-cloud-a",
  event_id: null,
  id: JOB,
  provider_allocation_token: null,
  requested_by: USER,
  source_asset_id: null,
  source_bytes: 716_949,
  status,
  target_kind: "venue_draft",
  tus_resource_url: null,
  venue_id: null,
});

const commonIntentDeps = {
  bunnyCreateVideo: () => Promise.resolve({ ok: true as const, guid: GUID }),
  bunnyPresignTusUpload: () =>
    Promise.resolve({
      authorizationExpire: 2_000_000_000,
      authorizationSignature: "signature",
      libraryId: "library",
      tusEndpoint: "https://tus.example.test/files/",
      videoId: GUID,
    }),
  destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
  providerConfigured: () => true,
  reapSupersededBunnyAssets: () => Promise.resolve(),
  requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
  requireUserId: () => Promise.resolve(USER),
  sleep: () => Promise.resolve(),
};

Deno.test("#2715 exact Bunny derivative truth accepts avc and rejects missing duration", () => {
  const avc = assertProcessedDerivative({
    bytes: 551_059,
    durationMs: 4_867,
    mimeType: "video/mp4",
    url: "https://cdn.example.test/final.mp4",
    videoCodec: "avc",
  });
  assert(avc.ok, "Amendment 11 exact avc output was rejected");

  const missingDuration = assertProcessedDerivative({
    bytes: 551_059,
    durationMs: null,
    mimeType: "video/mp4",
    url: "https://cdn.example.test/final.mp4",
    videoCodec: "x264",
  });
  assert(!missingDuration.ok, "missing provider duration was fabricated");
  if (!missingDuration.ok) {
    assert(
      missingDuration.code === "processed_duration_missing",
      `unexpected missing-duration code ${missingDuration.code}`,
    );
  }
});

Deno.test("#2715 ready is durable apply-pending truth, not a terminal success", () => {
  const mapped = mapEventCoverVideoStatus({
    ...job("ready"),
    application_receipt: null,
    application_version: 0,
    failure_message: "raw provider text",
    processed_bytes: 551_059,
    processed_duration_ms: 4_867,
    processed_mime_type: "video/mp4",
    processed_poster_url: "https://cdn.example.test/poster.jpg",
    processed_url: "https://cdn.example.test/final.mp4",
  } as never);
  assert(mapped.status === "ready", "ready status was not preserved");
  assert(!mapped.isTerminal, "ready was falsely exposed as terminal success");
  assert(mapped.failureMessage === null, "raw provider text crossed the API");
});

Deno.test("#2715 capacity refusal cannot accept or supersede a replacement operation", async () => {
  const acceptFlags: unknown[] = [];
  let providerCalls = 0;
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name !== "cover_video_create_or_replay_job") {
        throw new Error(`unexpected RPC ${name}`);
      }
      acceptFlags.push(args.p_accept_new);
      return Promise.resolve({ data: null, error: null });
    },
  };
  const response = await handleEventCoverVideoUploadIntent(intentRequest(), {
    ...commonIntentDeps,
    bunnyCreateVideo: () => {
      providerCalls += 1;
      return Promise.resolve({ ok: true as const, guid: GUID });
    },
    checkBunnyCapacity: () =>
      Promise.resolve({
        blocked: true,
        reason: "capacity_reached",
        usedPercent: 99,
      }),
    serviceRoleClient: () => client,
  } as never);
  const payload = await response.json();

  assert(
    response.status === 503,
    `expected capacity 503, got ${response.status}`,
  );
  assert(payload.error === "capacity_reached", "capacity error was not stable");
  assert(
    acceptFlags.length === 1 && acceptFlags[0] === false,
    `replacement was accepted before capacity truth: ${
      JSON.stringify(acceptFlags)
    }`,
  );
  assert(providerCalls === 0, "capacity loser allocated a provider asset");
});

Deno.test("#2715 all-null composite cannot masquerade as replay or bypass capacity", async () => {
  const acceptFlags: unknown[] = [];
  let providerCalls = 0;
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      assert(name === "cover_video_create_or_replay_job", `unexpected RPC ${name}`);
      acceptFlags.push(args.p_accept_new);
      return Promise.resolve({
        data: {
          id: null,
          status: null,
          provider: null,
          brand_id: null,
          event_id: null,
          target_kind: null,
        },
        error: null,
      });
    },
  };
  const response = await handleEventCoverVideoUploadIntent(intentRequest(), {
    ...commonIntentDeps,
    bunnyCreateVideo: () => {
      providerCalls += 1;
      return Promise.resolve({ ok: true as const, guid: GUID });
    },
    checkBunnyCapacity: () =>
      Promise.resolve({
        blocked: true,
        reason: "capacity_reached",
        usedPercent: 99,
      }),
    serviceRoleClient: () => client,
  } as never);
  const payload = await response.json();

  assert(response.status === 503, `all-null projection returned ${response.status}`);
  assert(payload.error === "capacity_reached", "all-null projection bypassed capacity truth");
  assert(
    acceptFlags.length === 1 && acceptFlags[0] === false,
    `all-null projection accepted before capacity: ${JSON.stringify(acceptFlags)}`,
  );
  assert(providerCalls === 0, "all-null projection reached provider allocation");
});

Deno.test("#2715 terminal operation replay returns canonical truth without provider work", async () => {
  let capacityCalls = 0;
  let providerCalls = 0;
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      assert(
        name === "cover_video_create_or_replay_job",
        `unexpected RPC ${name}`,
      );
      assert(
        args.p_accept_new === false,
        "terminal replay was accepted as a new operation",
      );
      return Promise.resolve({ data: job("cancelled"), error: null });
    },
  };
  const response = await handleEventCoverVideoUploadIntent(intentRequest(), {
    ...commonIntentDeps,
    bunnyCreateVideo: () => {
      providerCalls += 1;
      return Promise.resolve({ ok: true as const, guid: GUID });
    },
    checkBunnyCapacity: () => {
      capacityCalls += 1;
      return Promise.resolve({
        blocked: false,
        reason: "under_cap",
        usedPercent: 1,
      });
    },
    serviceRoleClient: () => client,
  } as never);
  const payload = await response.json();

  assert(
    response.status === 200,
    `terminal replay returned ${response.status}`,
  );
  assert(
    payload.jobId === JOB && payload.status?.status === "cancelled",
    "canonical terminal truth was lost",
  );
  assert(
    capacityCalls === 0 && providerCalls === 0,
    "terminal replay performed fresh provider work",
  );
});

Deno.test("#2715 concurrent winner and slow loser allocate exactly one provider asset", async () => {
  let providerCalls = 0;
  let claimCalls = 0;
  let winnerClaimed!: () => void;
  const claimed = new Promise<void>((resolve) => {
    winnerClaimed = resolve;
  });
  let finishCreate!: () => void;
  const slowCreate = new Promise<void>((resolve) => {
    finishCreate = resolve;
  });
  const canonical: Record<string, unknown> = {
    ...job("source_uploading"),
    provider_allocation_lease_until: new Date(Date.now() + 60_000)
      .toISOString(),
    source_asset_id: null,
    tus_resource_url: null,
  };
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "cover_video_create_or_replay_job") {
        assert(
          args.p_accept_new === false,
          "concurrent replay skipped schema probe",
        );
        return { data: { ...canonical }, error: null };
      }
      if (name === "cover_video_claim_provider_allocation") {
        claimCalls += 1;
        if (claimCalls === 1) {
          winnerClaimed();
          return {
            data: { ...canonical, provider_allocation_token: "winner-lease" },
            error: null,
          };
        }
        return {
          data: { ...canonical, provider_allocation_token: null },
          error: null,
        };
      }
      if (name === "cover_video_begin_provider_create") {
        Object.assign(canonical, {
          provider_allocation_identity: JOB,
          provider_allocation_uncertain_at: new Date().toISOString(),
        });
        return {
          data: { ...canonical, provider_allocation_token: "winner-lease" },
          error: null,
        };
      }
      if (name === "cover_video_renew_provider_allocation") {
        return { data: true, error: null };
      }
      if (name === "cover_video_record_provider_allocation_attempt") {
        Object.assign(canonical, {
          source_asset_id: args.p_source_asset_id,
          source_public_id: args.p_source_asset_id,
        });
        return {
          data: { ...canonical, provider_allocation_token: "winner-lease" },
          error: null,
        };
      }
      if (name === "cover_video_commit_provider_allocation") {
        Object.assign(canonical, {
          tus_resource_url: args.p_tus_url,
          provider_allocation_token: null,
        });
        return { data: { ...canonical }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const deps = {
    ...commonIntentDeps,
    bunnyCreateVideo: async () => {
      providerCalls += 1;
      await slowCreate;
      return { ok: true as const, guid: GUID };
    },
    bunnyFindVideoByTitle: () =>
      Promise.resolve({ ok: true as const, guid: null }),
    checkBunnyCapacity: () =>
      Promise.resolve({ blocked: false, reason: "under_cap", usedPercent: 1 }),
    serviceRoleClient: () => client,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, { status: 201, headers: { location: "/winner" } }),
    )) as typeof fetch;
  try {
    const winner = handleEventCoverVideoUploadIntent(
      intentRequest(),
      deps as never,
    );
    await claimed;
    const loser = await handleEventCoverVideoUploadIntent(
      intentRequest(),
      deps as never,
    );
    const loserPayload = await loser.json();
    assert(
      loser.status === 202 && loserPayload.initializing === true,
      "slow loser did not receive canonical initializing truth",
    );
    finishCreate();
    const winnerResponse = await winner;
    assert(
      winnerResponse.status === 200,
      `winner returned ${winnerResponse.status}`,
    );
    assert(
      providerCalls === 1,
      `concurrent handlers created ${providerCalls} provider assets`,
    );
    assert(
      claimCalls === 2,
      `concurrent handlers made ${claimCalls} allocation claims`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("#2715 lost Bunny create response is reconciled after lease expiry without a second create", async () => {
  const previousRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "issue-2715-service-role");
  let providerCreates = 0;
  let nowMs = Date.now();
  let leaseToken: string | null = null;
  const canonical: Record<string, unknown> = {
    ...job("source_uploading"),
    provider_allocation_identity: null,
    provider_allocation_uncertain_at: null,
    provider_allocation_lease_until: null,
    source_asset_id: null,
    source_public_id: null,
    tus_resource_url: null,
  };
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { ...canonical }, error: null }),
        }),
        is: () => ({
          not: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "cover_video_create_or_replay_job") {
        return { data: { ...canonical }, error: null };
      }
      if (name === "cover_video_claim_provider_allocation") {
        const leaseUntil = Date.parse(
          String(canonical.provider_allocation_lease_until ?? ""),
        );
        if (leaseToken !== null && leaseUntil > nowMs) {
          return {
            data: { ...canonical, provider_allocation_token: null },
            error: null,
          };
        }
        leaseToken = `lease-${nowMs}`;
        canonical.provider_allocation_lease_until = new Date(nowMs + 60_000)
          .toISOString();
        canonical.provider_allocation_token = leaseToken;
        return { data: { ...canonical }, error: null };
      }
      if (name === "cover_video_begin_provider_create") {
        canonical.provider_allocation_identity = args.p_identity;
        canonical.provider_allocation_uncertain_at = new Date(nowMs)
          .toISOString();
        return { data: { ...canonical }, error: null };
      }
      if (name === "cover_video_renew_provider_allocation") {
        return { data: true, error: null };
      }
      if (name === "cover_video_record_provider_allocation_attempt") {
        canonical.provider_allocation_last_error = args.p_error;
        return { data: { ...canonical }, error: null };
      }
      if (name === "cover_video_claim_reconcile_jobs") {
        return { data: [{ ...canonical }], error: null };
      }
      if (name === "cover_video_resolve_provider_allocation") {
        canonical.source_asset_id = args.p_source_asset_id;
        canonical.source_public_id = args.p_source_asset_id;
        canonical.provider_allocation_uncertain_at = null;
        return { data: { ...canonical }, error: null };
      }
      if (name === "cover_video_commit_provider_allocation") {
        canonical.tus_resource_url = args.p_tus_url;
        canonical.provider_allocation_token = null;
        return { data: { ...canonical }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const intentDeps = {
    ...commonIntentDeps,
    bunnyCreateVideo: () => {
      providerCreates += 1;
      // The provider committed GUID, but the response was lost.
      return Promise.resolve({
        ok: false as const,
        reason: "bunny_create_network",
        retryable: true,
      });
    },
    bunnyFindVideoByTitle: () =>
      Promise.resolve({ ok: true as const, guid: GUID }),
    checkBunnyCapacity: () =>
      Promise.resolve({ blocked: false, reason: "under_cap", usedPercent: 1 }),
    serviceRoleClient: () => client,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 201,
        headers: { location: "/reconciled" },
      }),
    )) as typeof fetch;
  try {
    const uncertain = await handleEventCoverVideoUploadIntent(
      intentRequest(),
      intentDeps as never,
    );
    assert(
      uncertain.status === 202,
      `ambiguous create returned ${uncertain.status}`,
    );
    assert(
      providerCreates === 1 && canonical.source_asset_id === null,
      "ambiguous create was not modeled faithfully",
    );

    nowMs += 61_000;
    canonical.provider_allocation_lease_until = new Date(nowMs - 1)
      .toISOString();
    leaseToken = null;
    const reaped = await handleReaper(
      new Request("https://test/reaper", {
        headers: { Authorization: "Bearer issue-2715-service-role" },
        method: "POST",
      }),
      {
        bunnyFindVideoByTitle: () =>
          Promise.resolve({ ok: true as const, guid: GUID }),
        bunnyGetVideo: () =>
          Promise.resolve({
            ok: false as const,
            reason: "must_not_read_before_binding",
          }),
        destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
        serviceRoleClient: () => client,
      } as never,
    );
    assert(
      reaped.status === 200 && canonical.source_asset_id === GUID,
      "reaper did not bind exact-title provider truth",
    );

    nowMs += 61_000;
    canonical.provider_allocation_lease_until = new Date(nowMs - 1)
      .toISOString();
    leaseToken = null;
    const replay = await handleEventCoverVideoUploadIntent(
      intentRequest(),
      intentDeps as never,
    );
    assert(
      replay.status === 200,
      `reconciled replay returned ${replay.status}`,
    );
    assert(
      providerCreates === 1,
      `post-lease replay created ${providerCreates} provider assets`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    previousRole === undefined
      ? Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY")
      : Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previousRole);
  }
});

Deno.test("#2715 lost provider-identity record response rereads the committed GUID instead of creating again", async () => {
  let providerCreates = 0;
  const canonical: Record<string, unknown> = {
    ...job("source_uploading"),
    provider_allocation_identity: null,
    provider_allocation_uncertain_at: null,
    provider_allocation_lease_until: new Date(Date.now() + 60_000)
      .toISOString(),
    provider_allocation_token: "record-lease",
    source_asset_id: null,
    source_public_id: null,
    tus_resource_url: null,
  };
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { ...canonical }, error: null }),
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "cover_video_create_or_replay_job") {
        return { data: { ...canonical }, error: null };
      }
      if (name === "cover_video_claim_provider_allocation") {
        return { data: { ...canonical }, error: null };
      }
      if (name === "cover_video_begin_provider_create") {
        canonical.provider_allocation_identity = args.p_identity;
        canonical.provider_allocation_uncertain_at = new Date().toISOString();
        return { data: { ...canonical }, error: null };
      }
      if (name === "cover_video_renew_provider_allocation") {
        return { data: true, error: null };
      }
      if (name === "cover_video_record_provider_allocation_attempt") {
        canonical.source_asset_id = args.p_source_asset_id;
        canonical.source_public_id = args.p_source_asset_id;
        canonical.provider_allocation_uncertain_at = null;
        return {
          data: null,
          error: { message: "record response lost after commit" },
        };
      }
      if (name === "cover_video_commit_provider_allocation") {
        canonical.tus_resource_url = args.p_tus_url;
        canonical.provider_allocation_token = null;
        return { data: { ...canonical }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, { status: 201, headers: { location: "/recorded" } }),
    )) as typeof fetch;
  try {
    const response = await handleEventCoverVideoUploadIntent(intentRequest(), {
      ...commonIntentDeps,
      bunnyCreateVideo: () => {
        providerCreates += 1;
        return Promise.resolve({ ok: true as const, guid: GUID });
      },
      bunnyFindVideoByTitle: () =>
        Promise.resolve({ ok: true as const, guid: GUID }),
      checkBunnyCapacity: () =>
        Promise.resolve({
          blocked: false,
          reason: "under_cap",
          usedPercent: 1,
        }),
      serviceRoleClient: () => client,
    } as never);
    assert(
      response.status === 200,
      `record-response recovery returned ${response.status}`,
    );
    assert(
      canonical.source_asset_id === GUID,
      "committed provider identity was not recovered",
    );
    assert(
      providerCreates === 1,
      `record-response recovery created ${providerCreates} assets`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const signedWebhook = async (providerStatus: number): Promise<Request> => {
  const body = JSON.stringify({ Status: providerStatus, VideoGuid: GUID });
  return new Request("https://test/webhook", {
    body,
    headers: {
      "x-bunnystream-signature": await hmacSha256Hex(SECRET, body),
      "x-bunnystream-signature-algorithm": "hmac-sha256",
      "x-bunnystream-signature-version": "v1",
    },
    method: "POST",
  });
};

for (const terminal of ["cancelled", "superseded"] as const) {
  Deno.test(`#2715 out-of-order Processing/Finished cannot revive ${terminal} work`, async () => {
    const previous = Deno.env.get("BUNNY_STREAM_WEBHOOK_KEY");
    Deno.env.set("BUNNY_STREAM_WEBHOOK_KEY", SECRET);
    let providerReads = 0;
    let mutations = 0;
    let destroys = 0;
    const terminalJob = {
      ...job(terminal),
      apply_mode: "published_manual",
      provider: "bunny",
      provider_payload: {},
      source_asset_id: GUID,
      source_public_id: GUID,
      trim_end_ms: 4_867,
      trim_start_ms: 0,
    };
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: terminalJob, error: null }),
          }),
        }),
      }),
      rpc: () => {
        mutations += 1;
        return Promise.resolve({ data: terminalJob, error: null });
      },
    };
    try {
      for (const providerStatus of [2, 3]) {
        const response = await handleEventCoverVideoWebhook(
          await signedWebhook(providerStatus),
          {
            bunnyGetVideo: () => {
              providerReads += 1;
              return Promise.resolve({ ok: true as const, video: {} });
            },
            destroyCoverVideoAsset: () => {
              destroys += 1;
              return Promise.resolve({ ok: true as const });
            },
            serviceRoleClient: () => client,
          } as never,
        );
        assert(
          response.status === 200,
          `${terminal} replay returned ${response.status}`,
        );
      }
      assert(providerReads === 0, `${terminal} replay queried Bunny`);
      assert(mutations === 0, `${terminal} replay mutated canonical truth`);
      assert(destroys === 0, `${terminal} replay deleted provider work`);
    } finally {
      previous === undefined
        ? Deno.env.delete("BUNNY_STREAM_WEBHOOK_KEY")
        : Deno.env.set("BUNNY_STREAM_WEBHOOK_KEY", previous);
    }
  });
}
