// #2905 — implementor regression test: a dropped webhook must never look like a
// successful one.
//
// FORENSIC BASIS. The wedged production job took NINE real Bunny callbacks
// between 2026-08-30 03:11:23 and 03:11:39 (function_edge_logs). All nine
// returned HTTP 200, none returned 503, and the webhook emitted ZERO function
// logs — so the gateway record was indistinguishable from nine promotions. The
// job's `provider_checked_at` proves what actually happened: it reads
// 2026-08-30 06:00:04, the FIRST reaper tick, not 03:11:39. Because
// cover_video_transition_job stamps provider_checked_at inside its UPDATE, a
// webhook that had won its CAS would have stamped 03:11:xx. None did — every
// one of the nine landed while the job was still `source_uploading`, and the
// RPC's transition matrix has no source_uploading→processing or
// source_uploading→ready edge. It returns the UNCHANGED row rather than an
// error, the handler never looked at the returned status, and the signal was
// discarded under a 200.
//
// FAILS ON REVERT: drop the `processingJob.status !== "processing"` /
// `readyJob.status !== "ready"` checks (or the unknown_guid warn) and these
// assertions throw — the responses collapse back into indistinguishable 200s.
//
// Run: deno test --allow-env --allow-net --no-check
//   supabase/functions/event-cover-video-webhook/index.issue2905.silent200.test.ts

import { handleEventCoverVideoWebhook } from "./index.ts";
import { hmacSha256Hex } from "../_shared/bunnyStream.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const SECRET = "webhook-secret-2905";
const GUID = "fb9b25b7-df25-4e75-b41c-be8cd890e4bb";
const JOB_ID = "e055c562-ca7d-4680-a3b4-15671683e165";
const SOURCE_SHA256 = "a".repeat(64);

const signed = async (status: number): Promise<Request> => {
  const body = JSON.stringify({
    VideoLibraryId: 696626,
    VideoGuid: GUID,
    Status: status,
  });
  return new Request("https://test/event-cover-video-webhook", {
    method: "POST",
    body,
    headers: {
      "x-bunnystream-signature": await hmacSha256Hex(SECRET, body),
      "x-bunnystream-signature-version": "v1",
      "x-bunnystream-signature-algorithm": "hmac-sha256",
    },
  });
};

const row = (status: string): Record<string, unknown> => ({
  id: JOB_ID,
  status,
  event_id: "74aa0f76-34b5-4e7e-a239-cda439d5e2fb",
  target_kind: "event",
  apply_mode: "published_manual",
  trim_start_ms: 0,
  trim_end_ms: 15_000,
  provider: "bunny",
  source_public_id: GUID,
  source_asset_id: GUID,
  source_sha256: SOURCE_SHA256,
  provider_payload: {},
  processed_poster_url: null,
});

// A faithful cover_video_transition_job: the CAS applies only when the current
// status is in p_from_statuses AND the (status → p_to_status) edge exists in the
// RPC's transition matrix; otherwise the UNCHANGED row is returned, never an
// error. source_uploading has edges only to source_uploaded/failed/cancelled/
// superseded — that is the production matrix, read back from pg_get_functiondef.
const EDGES: Record<string, string[]> = {
  source_uploading: ["source_uploaded", "failed", "cancelled", "superseded"],
  source_uploaded: [
    "processing_queued",
    "processing",
    "ready",
    "failed",
    "cancelled",
    "superseded",
  ],
  processing_queued: ["processing", "ready", "failed", "cancelled", "superseded"],
  processing: ["ready", "failed", "cancelled", "superseded"],
  ready: ["ready"],
};

const makeClient = (job: Record<string, unknown> | null) => {
  let current = job;
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    rpcs,
    snapshot: () => current,
    client: {
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, args });
        if (name === "cover_video_transition_job" && current) {
          const from = args.p_from_statuses as string[];
          const to = String(args.p_to_status);
          const status = String(current.status);
          if (from.includes(status) && (EDGES[status] ?? []).includes(to)) {
            current = { ...current, status: to };
          }
          return Promise.resolve({ data: current, error: null });
        }
        return Promise.resolve({ data: current, error: null });
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: current, error: null }),
          }),
        }),
      }),
    },
  };
};

const captureLogs = async (
  fn: () => Promise<void>,
): Promise<{ info: string[]; warn: string[] }> => {
  const info: string[] = [];
  const warn: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...parts: unknown[]) => info.push(parts.map(String).join(" "));
  console.warn = (...parts: unknown[]) => warn.push(parts.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
  return { info, warn };
};

const withEnv = async (fn: () => Promise<void>): Promise<void> => {
  const env: Record<string, string> = {
    BUNNY_STREAM_WEBHOOK_KEY: SECRET,
    BUNNY_STREAM_CDN_HOSTNAME: "vz-a16fce08-6c6.b-cdn.net",
  };
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = Deno.env.get(key);
    Deno.env.set(key, env[key]);
  }
  const originalFetch = globalThis.fetch;
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

const finishedVideo = {
  guid: GUID,
  status: 4,
  length: 15,
  storageSize: 14808154,
  availableResolutions: "480p,360p,240p",
  encodeProgress: 100,
  outputCodecs: "x264",
  originalHash: SOURCE_SHA256,
};

Deno.test("#2905 an unknown_guid miss is distinguishable in the log from a genuine promotion", async () => {
  await withEnv(async () => {
    const stub = makeClient(null);
    let response: Response | null = null;
    const logs = await captureLogs(async () => {
      response = await handleEventCoverVideoWebhook(await signed(3), {
        bunnyGetVideo: () =>
          Promise.resolve({ ok: true as const, video: finishedVideo }),
        destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
        serviceRoleClient: () => stub.client,
      } as never);
    });
    const body = await (response as unknown as Response).json();
    // Still 200 + idempotent (a foreign library video is not our problem)…
    assert(
      (response as unknown as Response).status === 200,
      "a foreign guid must stay idempotent",
    );
    assert(body.ignored === "unknown_guid", "expected the unknown_guid ignore");
    // …but it can no longer hide. Before #2905 this emitted nothing at all.
    assert(
      logs.warn.some((line) =>
        line.includes('"stage":"unknown_guid"') && line.includes(GUID)
      ),
      `a dropped webhook must warn with its guid; captured warns: ${
        JSON.stringify(logs.warn)
      }`,
    );
  });
});

Deno.test("#2905 a Finished webhook that loses the CAS returns a retryable 503, not a silent 200", async () => {
  await withEnv(async () => {
    // The exact production situation: Bunny's finish callback arrives while our
    // own source-acknowledgement has not landed yet, so the row is still
    // source_uploading and the RPC has no edge to `ready`.
    const stub = makeClient(row("source_uploading"));
    let response: Response | null = null;
    const logs = await captureLogs(async () => {
      response = await handleEventCoverVideoWebhook(await signed(3), {
        bunnyGetVideo: () =>
          Promise.resolve({ ok: true as const, video: finishedVideo }),
        destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
        serviceRoleClient: () => stub.client,
      } as never);
    });
    const res = response as unknown as Response;
    const body = await res.json();
    assert(
      res.status === 503,
      `a lost finish transition must be retryable, got ${res.status}`,
    );
    assert(
      body.error === "ready_transition_lost",
      `expected ready_transition_lost, got ${JSON.stringify(body)}`,
    );
    assert(
      body.detail === "source_uploading",
      "the response must name the state that refused the transition",
    );
    assert(
      logs.warn.some((line) =>
        line.includes('"stage":"ready_transition_lost"')
      ),
      `a lost finish must warn; captured warns: ${JSON.stringify(logs.warn)}`,
    );
    assert(
      String(stub.snapshot()?.status) === "source_uploading",
      "the job must not be corrupted by the refused transition",
    );
  });
});

Deno.test("#2905 a progress webhook that loses the CAS names itself instead of reporting success", async () => {
  await withEnv(async () => {
    const stub = makeClient(row("source_uploading"));
    let response: Response | null = null;
    const logs = await captureLogs(async () => {
      // Webhook Status 2 = Encoding → the `processing` branch.
      response = await handleEventCoverVideoWebhook(await signed(2), {
        bunnyGetVideo: () =>
          Promise.resolve({
            ok: true as const,
            video: { ...finishedVideo, status: 2, encodeProgress: 30 },
          }),
        destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
        serviceRoleClient: () => stub.client,
      } as never);
    });
    const res = response as unknown as Response;
    const body = await res.json();
    // A lost progress update is genuinely not load-bearing (the reconciler
    // re-reads provider truth), so it stays 200 — but it is now named.
    assert(res.status === 200, "a lost progress update stays idempotent");
    assert(
      body.ignored === "transition_lost" && body.from === "source_uploading",
      `expected a named transition_lost, got ${JSON.stringify(body)}`,
    );
    assert(
      logs.warn.some((line) => line.includes('"stage":"transition_lost"')),
      `a lost progress update must warn; captured warns: ${
        JSON.stringify(logs.warn)
      }`,
    );
  });
});

Deno.test("#2905 a Finished webhook that WINS its CAS still returns a plain 200 ok", async () => {
  await withEnv(async () => {
    // The control case: from `processing`, the ready edge exists, so nothing
    // about the happy path changed. Without this, the two assertions above
    // could be satisfied by a handler that 503s on every finish.
    const stub = makeClient(row("processing"));
    const response = await handleEventCoverVideoWebhook(await signed(3), {
      bunnyGetVideo: () =>
        Promise.resolve({ ok: true as const, video: finishedVideo }),
      destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
      serviceRoleClient: () => stub.client,
    } as never);
    const body = await response.json();
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(body.ok === true && body.ignored === undefined, "expected a clean ok");
    assert(
      String(stub.snapshot()?.status) === "ready",
      "the winning finish must land the job on ready",
    );
  });
});
