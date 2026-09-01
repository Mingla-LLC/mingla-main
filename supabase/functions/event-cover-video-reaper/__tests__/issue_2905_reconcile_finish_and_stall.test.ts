// #2905 — implementor regression test: the reconciler must promote a FINISHED
// Bunny asset, and a non-terminal job must eventually die visibly.
//
// This drives the REAL handleReaper against the REAL handleBunnyWebhook (the
// reaper imports it directly), so the enum seam is crossed end to end: a real
// Bunny API video object with `status: 4` goes in on one side and a
// `cover_video_transition_job(p_to_status: "ready")` comes out the other. The
// pre-#2905 code synthesised `Status: 4` into the webhook body, which
// `mapBunnyStatus` read as "processing", so the reconciler wrote "still
// processing, 100% complete" forever and the job was immortal.
//
// FAILS ON REVERT: restore
//   const rawBody = JSON.stringify({ VideoGuid: guid, Status: provider.video.status });
// in ../index.ts and the first test throws — no ready transition is ever issued.
// Delete evaluateCoverVideoStall's deadline (or widen it past the fixture age)
// and the stall tests throw — the job stays non-terminal with failure_code NULL.
//
// Run: deno test --allow-env --allow-read --allow-net --no-check
//   supabase/functions/event-cover-video-reaper/__tests__/issue_2905_reconcile_finish_and_stall.test.ts

import {
  COVER_VIDEO_STALL_MS,
  evaluateCoverVideoStall,
  handleReaper,
} from "../index.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const SERVICE_ROLE_KEY = "service-role-key-2905";
const WEBHOOK_KEY = "bunny-webhook-signing-key-2905";
const CDN_HOST = "vz-a16fce08-6c6.b-cdn.net";
// The real production job and asset from issue #2905.
const JOB_ID = "e055c562-ca7d-4680-a3b4-15671683e165";
const EVENT_ID = "74aa0f76-34b5-4e7e-a239-cda439d5e2fb";
const GUID = "fb9b25b7-df25-4e75-b41c-be8cd890e4bb";
const SOURCE_SHA256 = "a".repeat(64);

// The exact Bunny API video object for the wedged asset: status 4 (Finished)
// with encodeProgress 100 and a storageSize far larger than the 3,050,776-byte
// source. 720p genuinely 404s for this asset on the CDN, so the rendition list
// tops out at 480p — the fixture is faithful, not idealised.
const FINISHED_API_VIDEO = {
  guid: GUID,
  status: 4,
  length: 15,
  storageSize: 14808154,
  availableResolutions: "480p,360p,240p",
  encodeProgress: 100,
  outputCodecs: "x264",
  originalHash: SOURCE_SHA256,
} as const;

type Rpc = { name: string; args: Record<string, unknown> };

const jobRow = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: JOB_ID,
  status: "processing",
  provider: "bunny",
  event_id: EVENT_ID,
  target_kind: "event",
  apply_mode: "published_manual",
  trim_start_ms: 0,
  trim_end_ms: 15_000,
  source_public_id: GUID,
  source_asset_id: GUID,
  source_sha256: SOURCE_SHA256,
  provider_payload: {},
  processed_poster_url: null,
  applied_at: null,
  reaped_at: null,
  created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  ...overrides,
});

// One stub serving BOTH callers: the reaper's candidate scan
// (.select().is().not().limit()) and the webhook's job lookup
// (.select().eq().maybeSingle()), plus the reap stamp (.update().eq()).
const makeClient = (job: Record<string, unknown>) => {
  const rpcs: Rpc[] = [];
  let current = job;
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      if (name === "cover_video_claim_reconcile_jobs") {
        return Promise.resolve({ data: [current], error: null });
      }
      if (name === "cover_video_transition_job") {
        const from = args.p_from_statuses as string[];
        const to = String(args.p_to_status);
        // Faithful CAS: the transition only applies when the row is currently in
        // one of the p_from_statuses. cover_video_transition_job returns the
        // UNCHANGED row when it does not — never an error.
        if (from.includes(String(current.status))) {
          current = {
            ...current,
            ...(args.p_patch as Record<string, unknown>),
            status: to,
          };
        }
        return Promise.resolve({ data: current, error: null });
      }
      if (name === "cover_video_apply_once") {
        return Promise.resolve({ data: { status: "applied" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (_table: string) => ({
      select: (_columns?: string) => {
        const scan = {
          is: () => scan,
          not: () => scan,
          limit: () => Promise.resolve({ data: [current], error: null }),
        };
        return {
          ...scan,
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: current, error: null }),
          }),
        };
      },
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    }),
  };
  return { client, rpcs, snapshot: () => current };
};

const withEnv = async (fn: () => Promise<void>): Promise<void> => {
  const env: Record<string, string> = {
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    BUNNY_STREAM_WEBHOOK_KEY: WEBHOOK_KEY,
    BUNNY_STREAM_CDN_HOSTNAME: CDN_HOST,
  };
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = Deno.env.get(key);
    Deno.env.set(key, env[key]);
  }
  const originalFetch = globalThis.fetch;
  // Every derivative/poster HEAD succeeds — the asset really is live on the CDN.
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 200,
        headers: { "content-length": "1480815" },
      }),
    )) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(env)) {
      const prior = saved[key];
      if (prior === undefined) Deno.env.delete(key);
      else Deno.env.set(key, prior);
    }
  }
};

const cronRequest = (): Request =>
  new Request("https://test/event-cover-video-reaper", {
    method: "POST",
    headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });

Deno.test("#2905 the reconciler promotes a FINISHED (API status 4) Bunny asset to ready", async () => {
  await withEnv(async () => {
    const stub = makeClient(jobRow());
    let destroys = 0;
    const response = await handleReaper(cronRequest(), {
      bunnyFindVideoByTitle: () =>
        Promise.resolve({ ok: true as const, guid: GUID }),
      bunnyGetVideo: () =>
        Promise.resolve({ ok: true as const, video: FINISHED_API_VIDEO }),
      destroyCoverVideoAsset: () => {
        destroys += 1;
        return Promise.resolve({ ok: true as const });
      },
      serviceRoleClient: () => stub.client,
    } as never);
    const body = await response.json() as Record<string, unknown>;
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(body.ok === true, "reaper tick failed");

    const ready = stub.rpcs.find((rpc) =>
      rpc.name === "cover_video_transition_job" &&
      rpc.args.p_to_status === "ready"
    );
    assert(
      ready !== undefined,
      "a FINISHED Bunny asset was not promoted to ready — the enum seam is inverted again",
    );
    assert(
      typeof ready?.args.p_patch === "object" &&
        String(
            (ready?.args.p_patch as Record<string, unknown>).processed_url,
          ) === `https://${CDN_HOST}/${GUID}/play_480p.mp4`,
      "the ready transition did not carry the real delivery MP4",
    );
    assert(
      stub.snapshot().status === "ready",
      `job must end ready, ended ${String(stub.snapshot().status)}`,
    );
    // The self-contradicting write that fingerprinted the bug — "processing" at
    // provider_progress 100 — must never be issued for a finished asset.
    const contradictory = stub.rpcs.find((rpc) =>
      rpc.name === "cover_video_transition_job" &&
      rpc.args.p_to_status === "processing" &&
      rpc.args.p_provider_progress === 100
    );
    assert(
      contradictory === undefined,
      "reconciler wrote 'still processing, 100% complete' for a finished asset",
    );
    assert(destroys === 0, "a live, finished asset was destroyed");
    assert(body.reconciled === 1, `expected reconciled 1, got ${String(body.reconciled)}`);
    assert(body.stalled === 0, "a finished asset must never be stalled");
  });
});

Deno.test("#2905 a mid-encode (API status 3) asset is NOT promoted, even with the CDN answering 200", async () => {
  await withEnv(async () => {
    const stub = makeClient(jobRow());
    const response = await handleReaper(cronRequest(), {
      bunnyFindVideoByTitle: () =>
        Promise.resolve({ ok: true as const, guid: GUID }),
      bunnyGetVideo: () =>
        Promise.resolve({
          ok: true as const,
          video: { ...FINISHED_API_VIDEO, status: 3, encodeProgress: 41 },
        }),
      destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
      serviceRoleClient: () => stub.client,
    } as never);
    assert(response.status === 200, "reaper tick failed");
    // Every HEAD in this test returns 200, so the accidental protection the
    // production code relied on (503 derivative_not_ready) is deliberately
    // removed. Only the correct API mapping can stop the premature publish.
    assert(
      !stub.rpcs.some((rpc) =>
        rpc.name === "cover_video_transition_job" &&
        rpc.args.p_to_status === "ready"
      ),
      "a TRANSCODING asset was promoted to ready — half-encoded video published",
    );
    assert(
      stub.snapshot().status === "processing",
      "a mid-encode job must stay processing",
    );
  });
});

Deno.test("#2905 a job stuck past the stall deadline becomes a visible, retryable failure", async () => {
  await withEnv(async () => {
    const stub = makeClient(
      jobRow({
        created_at: new Date(Date.now() - COVER_VIDEO_STALL_MS - 60_000)
          .toISOString(),
      }),
    );
    const response = await handleReaper(cronRequest(), {
      bunnyFindVideoByTitle: () =>
        Promise.resolve({ ok: true as const, guid: GUID }),
      // Bunny is reachable and reports the asset is STILL not finished.
      bunnyGetVideo: () =>
        Promise.resolve({
          ok: true as const,
          video: { ...FINISHED_API_VIDEO, status: 2, encodeProgress: 12 },
        }),
      destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
      serviceRoleClient: () => stub.client,
    } as never);
    const body = await response.json() as Record<string, unknown>;
    assert(response.status === 200, "reaper tick failed");
    const failed = stub.rpcs.find((rpc) =>
      rpc.name === "cover_video_transition_job" &&
      rpc.args.p_to_status === "failed"
    );
    assert(
      failed !== undefined,
      "a job past the stall deadline stayed non-terminal — it is immortal again",
    );
    assert(
      (failed?.args.p_patch as Record<string, unknown>).failure_code ===
        "processing_stalled",
      "the stall must carry a real failure_code, never a silent delete",
    );
    assert(
      typeof (failed?.args.p_patch as Record<string, unknown>)
          .failure_message === "string",
      "the stall must carry a user-facing failure message",
    );
    assert(stub.snapshot().status === "failed", "job must end failed");
    assert(body.stalled === 1, `expected stalled 1, got ${String(body.stalled)}`);
    // mapEventCoverVideoStatus sets canRetry for `failed`, so this is the
    // visible + retryable state the host can act on.
  });
});

Deno.test("#2905 a FINISHED asset whose derivative the CDN will not serve still dies at the deadline", async () => {
  await withEnv(async () => {
    // The live hazard, not a hypothetical: play_720p.mp4 404s on the CDN for the
    // wedged production asset while 480/360/240 serve 200. If Bunny's
    // availableResolutions ever advertises that missing rendition, bunnyBestMp4
    // picks it, headWithRetry 503s, and the ready branch can never complete —
    // yet the provider says Finished. Gating the stall deadline on the provider
    // lifecycle alone would leave that job immortal all over again.
    const stub = makeClient(
      jobRow({
        created_at: new Date(Date.now() - COVER_VIDEO_STALL_MS - 60_000)
          .toISOString(),
      }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      // Exactly the production CDN shape: the advertised rendition is absent.
      return Promise.resolve(
        url.includes("play_720p.mp4")
          ? new Response(null, { status: 404 })
          : new Response(null, {
            status: 200,
            headers: { "content-length": "1480815" },
          }),
      );
    }) as typeof fetch;
    try {
      const response = await handleReaper(cronRequest(), {
        bunnyFindVideoByTitle: () =>
          Promise.resolve({ ok: true as const, guid: GUID }),
        bunnyGetVideo: () =>
          Promise.resolve({
            ok: true as const,
            // Bunny says Finished AND advertises a 720p that does not exist.
            video: { ...FINISHED_API_VIDEO, availableResolutions: "720p,480p" },
          }),
        destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
        serviceRoleClient: () => stub.client,
      } as never);
      const body = await response.json() as Record<string, unknown>;
      assert(
        !stub.rpcs.some((rpc) =>
          rpc.name === "cover_video_transition_job" &&
          rpc.args.p_to_status === "ready"
        ),
        "an unfetchable derivative must never be promoted",
      );
      assert(
        stub.snapshot().status === "failed",
        `an unpromotable finished asset must die at the deadline, ended ${
          String(stub.snapshot().status)
        }`,
      );
      assert(body.stalled === 1, `expected stalled 1, got ${String(body.stalled)}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("#2905 an unfetchable derivative INSIDE the stall window is left alone to retry", async () => {
  await withEnv(async () => {
    // The other half of the same rule: derivative propagation lag is retryable
    // (#2715). A fresh job that 503s must keep its asset and its state.
    const stub = makeClient(jobRow());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch;
    let destroys = 0;
    try {
      const response = await handleReaper(cronRequest(), {
        bunnyFindVideoByTitle: () =>
          Promise.resolve({ ok: true as const, guid: GUID }),
        bunnyGetVideo: () =>
          Promise.resolve({ ok: true as const, video: FINISHED_API_VIDEO }),
        destroyCoverVideoAsset: () => {
          destroys += 1;
          return Promise.resolve({ ok: true as const });
        },
        serviceRoleClient: () => stub.client,
      } as never);
      const body = await response.json() as Record<string, unknown>;
      assert(
        stub.snapshot().status === "processing",
        "a fresh job with a lagging derivative must stay retryable",
      );
      assert(body.stalled === 0, "derivative lag inside the window must not stall");
      assert(destroys === 0, "a retryable job's asset must not be destroyed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("#2905 a Bunny outage never converts healthy work into failure", async () => {
  await withEnv(async () => {
    const stub = makeClient(
      jobRow({
        created_at: new Date(Date.now() - COVER_VIDEO_STALL_MS * 4)
          .toISOString(),
      }),
    );
    const response = await handleReaper(cronRequest(), {
      bunnyFindVideoByTitle: () =>
        Promise.resolve({ ok: true as const, guid: GUID }),
      bunnyGetVideo: () =>
        Promise.resolve({
          ok: false as const,
          status: 503,
          reason: "bunny_get_http_503",
        }),
      destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
      serviceRoleClient: () => stub.client,
    } as never);
    const body = await response.json() as Record<string, unknown>;
    assert(response.status === 200, "reaper tick failed");
    assert(
      !stub.rpcs.some((rpc) =>
        rpc.name === "cover_video_transition_job" &&
        rpc.args.p_to_status === "failed"
      ),
      "a provider outage failed a job that may still be healthy",
    );
    assert(body.stalled === 0, "an unreadable provider must never stall a job");
  });
});

Deno.test("#2905 a provider asset that is definitively GONE (404) fails with its own code", async () => {
  await withEnv(async () => {
    const stub = makeClient(
      jobRow({
        created_at: new Date(Date.now() - COVER_VIDEO_STALL_MS - 1)
          .toISOString(),
      }),
    );
    await handleReaper(cronRequest(), {
      bunnyFindVideoByTitle: () =>
        Promise.resolve({ ok: true as const, guid: GUID }),
      bunnyGetVideo: () =>
        Promise.resolve({
          ok: false as const,
          status: 404,
          reason: "bunny_get_http_404",
        }),
      destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
      serviceRoleClient: () => stub.client,
    } as never);
    const failed = stub.rpcs.find((rpc) =>
      rpc.name === "cover_video_transition_job" &&
      rpc.args.p_to_status === "failed"
    );
    assert(failed !== undefined, "a vanished provider asset stayed immortal");
    assert(
      (failed?.args.p_patch as Record<string, unknown>).failure_code ===
        "provider_asset_missing",
      "a vanished asset must be distinguishable from a slow encode",
    );
  });
});

Deno.test("#2905 evaluateCoverVideoStall: the deadline is bounded, ready is exempt, outages never stall", () => {
  const now = Date.UTC(2026, 8, 1, 12, 0, 0);
  const ago = (ms: number) => new Date(now - ms).toISOString();

  // Bunny may legitimately process well beyond 120s (#2715): anything inside the
  // window is healthy work, never a failure.
  assert(
    !evaluateCoverVideoStall({
      status: "processing",
      createdAt: ago(COVER_VIDEO_STALL_MS - 1),
      nowMs: now,
      providerRead: "non_terminal",
    }).stalled,
    "a job inside the stall window must never fail",
  );
  const late = evaluateCoverVideoStall({
    status: "processing",
    createdAt: ago(COVER_VIDEO_STALL_MS),
    nowMs: now,
    providerRead: "non_terminal",
  });
  assert(
    late.stalled && late.failureCode === "processing_stalled",
    "a job at the deadline must become a visible failure",
  );
  // `ready` is authoritative provider truth awaiting its owner, and the
  // transition RPC has no ready→failed edge. It is never stalled.
  assert(
    !evaluateCoverVideoStall({
      status: "ready",
      createdAt: ago(COVER_VIDEO_STALL_MS * 10),
      nowMs: now,
      providerRead: "non_terminal",
    }).stalled,
    "a ready job must never be stalled",
  );
  assert(
    !evaluateCoverVideoStall({
      status: "applied",
      createdAt: ago(COVER_VIDEO_STALL_MS * 10),
      nowMs: now,
      providerRead: "non_terminal",
    }).stalled,
    "an applied job must never be stalled",
  );
  assert(
    !evaluateCoverVideoStall({
      status: "processing",
      createdAt: ago(COVER_VIDEO_STALL_MS * 10),
      nowMs: now,
      providerRead: "unreadable",
    }).stalled,
    "an unreadable provider must never stall a job",
  );
  assert(
    !evaluateCoverVideoStall({
      status: "processing",
      createdAt: null,
      nowMs: now,
      providerRead: "non_terminal",
    }).stalled,
    "an unparseable created_at must fail safe, not fail the job",
  );
  // The window must be long enough for at least two 6h reconciler ticks, and
  // shorter than the 24h abandoned-draft reap so a stalled job surfaces first.
  assert(
    COVER_VIDEO_STALL_MS >= 2 * 6 * 60 * 60 * 1000 &&
      COVER_VIDEO_STALL_MS < 24 * 60 * 60 * 1000,
    "the stall window must span >=2 reconciler ticks and stay under the 24h reap",
  );
});
