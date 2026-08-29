import {
  assertProcessedDerivative,
  type EventCoverVideoJobStatus,
  mapEventCoverVideoStatus,
} from "./eventCoverVideo.ts";
import { bunnyFindVideoByTitle } from "./bunnyStream.ts";
import {
  handleReaper,
  type ReapCandidate,
} from "../event-cover-video-reaper/index.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const withProvider = async (
  responses: Array<Record<string, unknown>>,
  run: (urls: URL[]) => Promise<void>,
): Promise<void> => {
  const oldFetch = globalThis.fetch;
  const oldLibrary = Deno.env.get("BUNNY_STREAM_LIBRARY_ID");
  const oldKey = Deno.env.get("BUNNY_STREAM_API_KEY");
  const urls: URL[] = [];
  Deno.env.set("BUNNY_STREAM_LIBRARY_ID", "library-2715");
  Deno.env.set("BUNNY_STREAM_API_KEY", "secret-2715");
  globalThis.fetch = ((input: string | URL | Request) => {
    urls.push(new URL(input instanceof Request ? input.url : input));
    const body = responses.shift();
    if (body === undefined) throw new Error("unexpected provider page");
    return Promise.resolve(Response.json(body));
  }) as typeof fetch;
  try {
    await run(urls);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldLibrary === undefined) Deno.env.delete("BUNNY_STREAM_LIBRARY_ID");
    else Deno.env.set("BUNNY_STREAM_LIBRARY_ID", oldLibrary);
    if (oldKey === undefined) Deno.env.delete("BUNNY_STREAM_API_KEY");
    else Deno.env.set("BUNNY_STREAM_API_KEY", oldKey);
  }
};

const REAPER_SERVICE_KEY = "issue-2715-reaper-key";
const reaperRequest = (): Request =>
  new Request("https://test/event-cover-video-reaper", {
    method: "POST",
    headers: { Authorization: `Bearer ${REAPER_SERVICE_KEY}` },
  });
const withServiceKey = async (run: () => Promise<void>): Promise<void> => {
  const previous = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", REAPER_SERVICE_KEY);
  try {
    await run();
  } finally {
    if (previous === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previous);
  }
};
const emptyCandidateQuery = {
  select() {
    return this;
  },
  is() {
    return this;
  },
  not() {
    return this;
  },
  limit() {
    return this;
  },
  then(resolve: (value: { data: ReapCandidate[]; error: null }) => unknown) {
    return Promise.resolve({ data: [], error: null }).then(resolve);
  },
};

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  event_id: null,
  brand_id: "22222222-2222-4222-8222-222222222222",
  target_kind: "venue_draft",
  venue_id: null,
  draft_owner_key: "draft-owner-a",
  client_operation_id: "33333333-3333-4333-8333-333333333333",
  apply_mode: "published_manual",
  provider_progress: null,
  processed_url: null,
  processed_poster_url: null,
  processed_mime_type: null,
  processed_bytes: null,
  processed_duration_ms: null,
  failure_code: null,
  failure_message: "raw provider detail must not render",
  created_at: "2026-08-27T00:00:00.000Z",
  updated_at: "2026-08-27T00:00:00.000Z",
  applied_at: null,
  cancelled_at: null,
  application_version: 0,
  application_receipt: null,
};

Deno.test("#2715 status mapping preserves exact target and honest indeterminate progress", () => {
  const mapped = mapEventCoverVideoStatus(
    { ...base, status: "processing" } as never,
  );
  assert(
    mapped.targetKind === "venue_draft",
    "venue-draft identity must survive",
  );
  assert(mapped.draftOwnerKey === "draft-owner-a", "draft key must survive");
  assert(
    mapped.progressKind === "indeterminate",
    "unknown provider progress is indeterminate",
  );
  assert(mapped.progressPercent === null, "unknown progress has no percentage");
  assert(
    mapped.failureMessage === null,
    "raw provider detail must not be exposed",
  );
});

Deno.test("#2715 only provider progress is determinate and ready remains distinct from terminal", () => {
  const processing = mapEventCoverVideoStatus(
    { ...base, status: "processing", provider_progress: 63 } as never,
  );
  assert(
    processing.progressKind === "determinate" &&
      processing.progressPercent === 63,
    "real provider progress maps exactly",
  );
  for (
    const status of [
      "applied",
      "failed",
      "cancelled",
      "superseded",
    ] as EventCoverVideoJobStatus[]
  ) {
    const mapped = mapEventCoverVideoStatus({ ...base, status } as never);
    assert(mapped.isTerminal, `${status} must be terminal`);
  }
  assert(
    !mapEventCoverVideoStatus({ ...base, status: "ready" } as never).isTerminal,
    "ready awaits durable apply and is not terminal",
  );
});

Deno.test("#2715 accepts exact avc/x264/h264 provider codec spellings", () => {
  for (const videoCodec of ["avc", "avc1", "x264", "h264"]) {
    const result = assertProcessedDerivative({
      url: "https://cdn.example.test/video.mp4",
      mimeType: "video/mp4",
      bytes: 1_024,
      durationMs: 15_000,
      videoCodec,
    });
    assert(result.ok, `${videoCodec} should be accepted`);
  }
});

Deno.test("#2715 provider lookup exhausts pages and binds only an exact deterministic title", async () => {
  await withProvider([
    {
      items: [{ guid: "partial-guid", title: "job-2715-copy" }],
      currentPage: 1,
      itemsPerPage: 1,
      totalItems: 2,
    },
    {
      items: [{ guid: "exact-guid", title: "job-2715" }],
      currentPage: 2,
      itemsPerPage: 1,
      totalItems: 2,
    },
  ], async (urls) => {
    const result = await bunnyFindVideoByTitle("job-2715");
    assert(
      result.ok && result.guid === "exact-guid",
      "exact title was not recovered",
    );
    assert(urls.length === 2, "provider result pages were not exhausted");
    assert(
      urls.every((url) => url.searchParams.get("search") === "job-2715"),
      "lookup was not deterministic",
    );
  });
});

Deno.test("#2715 duplicate exact provider identities remain ambiguous", async () => {
  await withProvider([{
    items: [
      { guid: "first-guid", title: "job-2715" },
      { guid: "second-guid", title: "job-2715" },
    ],
    currentPage: 1,
    itemsPerPage: 100,
    totalItems: 2,
  }], async () => {
    const result = await bunnyFindVideoByTitle("job-2715");
    assert(
      !result.ok && result.reason === "bunny_lookup_duplicate_identity",
      "duplicate title was treated as canonical",
    );
  });
});

Deno.test("#2715 malformed pagination cannot prove provider absence", async () => {
  await withProvider([{ items: [] }], async () => {
    const result = await bunnyFindVideoByTitle("job-2715");
    assert(
      !result.ok && result.reason === "bunny_lookup_malformed",
      "partial provider evidence cleared uncertainty",
    );
  });
});

Deno.test("#2715 reaper binds a null-GUID uncertain allocation by exact provider title", async () => {
  await withServiceKey(async () => {
    const candidate: ReapCandidate = {
      id: "27150000-0000-4000-8000-000000000099",
      status: "source_uploading",
      provider: "bunny",
      source_asset_id: null,
      provider_allocation_identity: "27150000-0000-4000-8000-000000000099",
      provider_allocation_uncertain_at: new Date().toISOString(),
    };
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      from: () => ({
        select: () => emptyCandidateQuery,
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "cover_video_claim_reconcile_jobs") {
          return Promise.resolve({ data: [candidate], error: null });
        }
        if (name === "cover_video_claim_provider_allocation") {
          return Promise.resolve({
            data: { ...candidate, provider_allocation_token: "lease-2715" },
            error: null,
          });
        }
        if (name === "cover_video_resolve_provider_allocation") {
          return Promise.resolve({
            data: { ...candidate, source_asset_id: args.p_source_asset_id },
            error: null,
          });
        }
        throw new Error(`unexpected rpc ${name}`);
      },
    };
    let lookups = 0;
    let destroys = 0;
    const response = await handleReaper(reaperRequest(), {
      bunnyFindVideoByTitle: (title: string) => {
        lookups += 1;
        assert(
          title === candidate.id,
          "lookup title must be the deterministic job id",
        );
        return Promise.resolve({
          ok: true as const,
          guid: "provider-guid-2715",
        });
      },
      bunnyGetVideo: () =>
        Promise.reject(new Error("GUID read must wait for binding")),
      destroyCoverVideoAsset: () => {
        destroys += 1;
        return Promise.resolve({ ok: true as const });
      },
      serviceRoleClient: () => client as never,
    });
    const payload = await response.json();
    assert(
      response.status === 200 && payload.reconciled === 1,
      "uncertain row was not reconciled",
    );
    assert(
      lookups === 1 && destroys === 0,
      "uncertain active asset was deleted or not searched",
    );
    const resolution = calls.find((call) =>
      call.name === "cover_video_resolve_provider_allocation"
    );
    assert(
      resolution?.args.p_source_asset_id === "provider-guid-2715",
      "found GUID was not bound",
    );
    assert(
      resolution?.args.p_absent === false,
      "found GUID was misclassified as absent",
    );
  });
});

Deno.test("#2715 transient provider lookup leaves null-GUID uncertainty retryable", async () => {
  await withServiceKey(async () => {
    const candidate: ReapCandidate = {
      id: "27150000-0000-4000-8000-000000000098",
      status: "source_uploading",
      provider: "bunny",
      source_asset_id: null,
      provider_allocation_identity: "27150000-0000-4000-8000-000000000098",
      provider_allocation_uncertain_at: new Date().toISOString(),
    };
    let resolves = 0;
    const client = {
      from: () => ({
        select: () => emptyCandidateQuery,
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
      rpc: (name: string) => {
        if (name === "cover_video_claim_reconcile_jobs") {
          return Promise.resolve({ data: [candidate], error: null });
        }
        if (name === "cover_video_claim_provider_allocation") {
          return Promise.resolve({
            data: { ...candidate, provider_allocation_token: "lease-2715" },
            error: null,
          });
        }
        if (name === "cover_video_resolve_provider_allocation") resolves += 1;
        return Promise.resolve({ data: null, error: null });
      },
    };
    const response = await handleReaper(reaperRequest(), {
      bunnyFindVideoByTitle: () =>
        Promise.resolve({ ok: false as const, reason: "bunny_list_http_503" }),
      bunnyGetVideo: () =>
        Promise.reject(new Error("must not read a missing GUID")),
      destroyCoverVideoAsset: () =>
        Promise.reject(new Error("must not delete active uncertainty")),
      serviceRoleClient: () => client as never,
    });
    const payload = await response.json();
    assert(
      response.status === 200 && payload.reconciled === 0,
      "transient lookup was not deferred",
    );
    assert(resolves === 0, "transient lookup falsely proved provider absence");
  });
});
