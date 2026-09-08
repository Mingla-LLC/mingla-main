// #3134 — a healthy cover video must not wait on Bunny's retry backoff because
// its hash was a beat late.
//
// FORENSIC BASIS. Real device, production build, 2026-09-08, job 8d38ff2b:
//
//   17:06:15  bytes complete on Bunny (`source_uploaded`, TUS offset == length)
//   17:37:45  the webhook that finally stuck arrives; applied 0.1s later
//
// Compression took ~4s and the upload ~4s; the other 31 minutes were dead time.
// `originalHash` was directly observed still null at 17:09 and 17:11 while the
// video sat at Bunny status 2 — so the first callbacks met the
// `source_identity_pending` 503 and Bunny rescheduled on its own backoff.
//
// Refusing to publish an unverified asset is right. Refusing and then having no
// say in when we are asked again is what cost the half hour. The handler now
// asks Bunny again a few times before giving up, and the reconciler (every
// minute, migration 20270618003134) is the backstop when the hash really is not
// ready.
//
// FAILS ON REVERT: delete the re-poll loop and T-3134-01 gets a 503 with a
// single provider read — the shipped behaviour.
//
// Run: deno test --allow-env --allow-net --no-check
//   supabase/functions/event-cover-video-webhook/index.issue3134.identityRepoll.test.ts

import { handleEventCoverVideoWebhook } from "./index.ts";
import { hmacSha256Hex } from "../_shared/bunnyStream.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const SECRET = "webhook-secret-3134";
const GUID = "4f5c0a46-0f7f-48df-a185-ff312130c48b";
const JOB_ID = "8d38ff2b-d1ca-48fb-a4dd-5bd395629ab0";
const SOURCE_SHA256 = "63a5053879219821637c3f3acebcdd3d52124d9349f972f4bef968820932fd63";

const signedFinished = async (): Promise<Request> => {
  const body = JSON.stringify({
    VideoLibraryId: 696626,
    VideoGuid: GUID,
    Status: 3, // webhook enum: 3 = Finished
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

const EDGES: Record<string, string[]> = {
  source_uploaded: ["processing_queued", "processing", "ready", "failed", "cancelled", "superseded"],
  processing_queued: ["processing", "ready", "failed", "cancelled", "superseded"],
  processing: ["ready", "failed", "cancelled", "superseded"],
  ready: ["ready"],
};

const makeClient = () => {
  let current: Record<string, unknown> | null = {
    id: JOB_ID,
    status: "processing",
    event_id: "4c62028e-2804-41d3-bcd9-56c7ab7f2f2e",
    target_kind: "event",
    apply_mode: "draft_auto",
    trim_start_ms: 0,
    trim_end_ms: 15_000,
    provider: "bunny",
    source_public_id: GUID,
    source_asset_id: GUID,
    source_sha256: SOURCE_SHA256,
    provider_payload: {},
    processed_poster_url: null,
  };
  return {
    snapshot: () => current,
    client: {
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === "cover_video_transition_job" && current) {
          const from = args.p_from_statuses as string[];
          const to = String(args.p_to_status);
          const status = String(current.status);
          if (from.includes(status) && (EDGES[status] ?? []).includes(to)) {
            current = { ...current, status: to };
          }
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

const bunnyVideo = (originalHash: string | null) => ({
  ok: true as const,
  video: {
    guid: GUID,
    status: 4,
    length: 15,
    storageSize: 11_834_862,
    availableResolutions: "240p,360p",
    encodeProgress: 100,
    outputCodecs: "x264",
    originalHash,
  },
});

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
      new Response(null, { status: 200, headers: { "content-length": "1480815" } }),
    )) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(env)) {
      const value = saved[key];
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
};

Deno.test("T-3134-01 a hash that lands one beat late finishes the job, it does not 503", async () => {
  await withEnv(async () => {
    const store = makeClient();
    let reads = 0;
    let slept = 0;
    const request = await signedFinished();
    const response = await handleEventCoverVideoWebhook(request, {
      // Bunny reports Finished before it has published the hash — the exact
      // shape observed on the real device.
      bunnyGetVideo: () => {
        reads += 1;
        return Promise.resolve(bunnyVideo(reads < 3 ? null : SOURCE_SHA256));
      },
      destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
      serviceRoleClient: () => store.client,
      sleep: () => { slept += 1; return Promise.resolve(); },
    } as never);

    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(reads >= 3, `expected the handler to ask Bunny again, saw ${reads} read(s)`);
    assert(slept >= 1, "expected the handler to wait between reads");
    const status = String(store.snapshot()?.status);
    assert(
      status === "ready" || status === "applied",
      `expected the job to finish, left at ${status}`,
    );
  });
});

Deno.test("T-3134-02 a hash that never arrives is still refused, not published", async () => {
  await withEnv(async () => {
    const store = makeClient();
    let reads = 0;
    const request = await signedFinished();
    const response = await handleEventCoverVideoWebhook(request, {
      bunnyGetVideo: () => {
        reads += 1;
        return Promise.resolve(bunnyVideo(null));
      },
      destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
      serviceRoleClient: () => store.client,
      sleep: () => Promise.resolve(),
    } as never);

    // The interlock is the point: an unverified source never becomes a cover.
    assert(response.status === 503, `expected 503, got ${response.status}`);
    assert(reads > 1, "expected the bounded re-poll to have tried more than once");
    assert(
      String(store.snapshot()?.status) === "processing",
      "an unverifiable job must not advance",
    );
  });
});

Deno.test("T-3134-03 a mismatched hash still fails the job", async () => {
  await withEnv(async () => {
    const store = makeClient();
    const request = await signedFinished();
    const response = await handleEventCoverVideoWebhook(request, {
      bunnyGetVideo: () => Promise.resolve(bunnyVideo("b".repeat(64))),
      destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
      serviceRoleClient: () => store.client,
      sleep: () => Promise.resolve(),
    } as never);

    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(
      String(store.snapshot()?.status) === "failed",
      `a mismatch must fail the job, left at ${store.snapshot()?.status}`,
    );
  });
});
