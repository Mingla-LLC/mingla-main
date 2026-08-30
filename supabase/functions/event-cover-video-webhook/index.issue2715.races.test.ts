import { hmacSha256Hex } from "../_shared/bunnyStream.ts";
import { handleEventCoverVideoWebhook } from "./index.ts";

const SECRET = "webhook-secret";
const GUID = "guid-race";
const JOB = "11a18413-bfbf-4087-9ba7-45f70deba0f3";
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const signed = async (status: number) => {
  const body = JSON.stringify({ VideoGuid: GUID, Status: status });
  return new Request("https://test/webhook", {
    method: "POST",
    body,
    headers: {
      "x-bunnystream-signature": await hmacSha256Hex(SECRET, body),
      "x-bunnystream-signature-version": "v1",
      "x-bunnystream-signature-algorithm": "hmac-sha256",
    },
  });
};
const withSecret = async (fn: () => Promise<void>) => {
  const old = Deno.env.get("BUNNY_STREAM_WEBHOOK_KEY");
  Deno.env.set("BUNNY_STREAM_WEBHOOK_KEY", SECRET);
  try {
    await fn();
  } finally {
    old === undefined
      ? Deno.env.delete("BUNNY_STREAM_WEBHOOK_KEY")
      : Deno.env.set("BUNNY_STREAM_WEBHOOK_KEY", old);
  }
};
const row = (status: string) => ({
  id: JOB,
  status,
  event_id: null,
  target_kind: "venue_draft",
  apply_mode: "published_manual",
  trim_start_ms: 0,
  trim_end_ms: 12_000,
  provider: "bunny",
  source_public_id: GUID,
  source_asset_id: GUID,
  source_sha256: "a".repeat(64),
  provider_payload: {},
  processed_poster_url: null,
});
const client = (
  job: Record<string, unknown>,
  rpcResult?: Record<string, unknown>,
) => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: job, error: null }),
      }),
    }),
  }),
  rpc: () => Promise.resolve({ data: rpcResult ?? job, error: null }),
});

Deno.test("#2715 duplicate Finished after ready is a no-op", async () =>
  withSecret(async () => {
    let reads = 0, destroys = 0, rpcs = 0;
    const response = await handleEventCoverVideoWebhook(await signed(3), {
      bunnyGetVideo: () => {
        reads += 1;
        throw new Error("provider must not be read");
      },
      destroyCoverVideoAsset: () => {
        destroys += 1;
        return Promise.resolve({ ok: true as const });
      },
      serviceRoleClient: () => ({
        ...client(row("ready")),
        rpc: () => {
          rpcs += 1;
          return Promise.resolve({ data: null, error: null });
        },
      }),
    } as never);
    assert(response.status === 200, "duplicate Finished failed");
    assert(
      reads === 0 && destroys === 0 && rpcs === 0,
      "duplicate Finished performed work",
    );
  }));

Deno.test("#2715 provider failure losing a ready race cannot delete the ready asset", async () =>
  withSecret(async () => {
    let destroys = 0;
    const processing = row("processing");
    const response = await handleEventCoverVideoWebhook(await signed(5), {
      bunnyGetVideo: () =>
        Promise.resolve({ ok: false as const, status: 500, reason: "unused" }),
      destroyCoverVideoAsset: () => {
        destroys += 1;
        return Promise.resolve({ ok: true as const });
      },
      serviceRoleClient: () =>
        client(processing, { ...processing, status: "ready" }),
    } as never);
    assert(response.status === 200, "failed webhook response");
    assert(destroys === 0, "ready asset deleted after failed CAS");
  }));

Deno.test("#2715 transient provider read on Finished stays retryable without mutation or deletion", async () =>
  withSecret(async () => {
    let destroys = 0, rpcs = 0;
    const response = await handleEventCoverVideoWebhook(await signed(3), {
      bunnyGetVideo: () =>
        Promise.resolve({
          ok: false as const,
          status: 503,
          reason: "bunny_get_http_503",
        }),
      destroyCoverVideoAsset: () => {
        destroys += 1;
        return Promise.resolve({ ok: true as const });
      },
      serviceRoleClient: () => ({
        ...client(row("processing")),
        rpc: () => {
          rpcs += 1;
          return Promise.resolve({ data: null, error: null });
        },
      }),
    } as never);
    assert(response.status === 503, `expected 503, got ${response.status}`);
    assert(
      destroys === 0 && rpcs === 0,
      "transient provider failure mutated terminal state",
    );
  }));

Deno.test("#2715 content-identity mismatch losing a ready race cannot delete the ready asset", async () =>
  withSecret(async () => {
    let destroys = 0;
    const processing = row("processing");
    const response = await handleEventCoverVideoWebhook(await signed(3), {
      bunnyGetVideo: () =>
        Promise.resolve({
          ok: true as const,
          video: { originalHash: "b".repeat(64) },
        }),
      destroyCoverVideoAsset: () => {
        destroys += 1;
        return Promise.resolve({ ok: true as const });
      },
      serviceRoleClient: () =>
        client(processing, { ...processing, status: "ready" }),
    } as never);
    assert(response.status === 200, "identity race response failed");
    assert(
      destroys === 0,
      "ready asset deleted after identity-mismatch CAS loss",
    );
  }));

Deno.test("#2715 authoritative invalid derivative fails and cleans up exactly once", async () =>
  withSecret(async () => {
    const oldCdn = Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME");
    Deno.env.set("BUNNY_STREAM_CDN_HOSTNAME", "vz-race.b-cdn.net");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { "content-length": "8000000" },
        }),
      )) as typeof fetch;
    let current: Record<string, unknown> = row("processing");
    let destroys = 0, rpcs = 0, reads = 0;
    const deps = {
      bunnyGetVideo: () => {
        reads += 1;
        return Promise.resolve({
          ok: true as const,
          video: {
            guid: GUID,
            status: 3,
            length: 12,
            storageSize: 8_000_000,
            availableResolutions: "720p",
            encodeProgress: 100,
            outputCodecs: "vp9",
            originalHash: "a".repeat(64),
          },
        });
      },
      destroyCoverVideoAsset: () => {
        destroys += 1;
        return Promise.resolve({ ok: true as const });
      },
      serviceRoleClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: current, error: null }),
            }),
          }),
        }),
        rpc: () => {
          rpcs += 1;
          current = {
            ...current,
            status: "failed",
            failure_code: "processed_codec_invalid",
          };
          return Promise.resolve({ data: current, error: null });
        },
      }),
    } as never;
    try {
      const first = await handleEventCoverVideoWebhook(await signed(3), deps);
      assert(first.status === 200, "invalid derivative was not acknowledged");
      assert(
        (await first.json()).status === "failed",
        "invalid derivative did not terminally fail",
      );
      assert(
        reads === 1 && rpcs === 1 && destroys === 1,
        "first invalid derivative did not fail and clean once",
      );
      const duplicate = await handleEventCoverVideoWebhook(
        await signed(3),
        deps,
      );
      assert(
        duplicate.status === 200,
        "duplicate invalid Finished was not acknowledged",
      );
      assert(
        reads === 1 && rpcs === 1 && destroys === 1,
        "duplicate invalid Finished repeated provider work or cleanup",
      );
    } finally {
      globalThis.fetch = originalFetch;
      oldCdn === undefined
        ? Deno.env.delete("BUNNY_STREAM_CDN_HOSTNAME")
        : Deno.env.set("BUNNY_STREAM_CDN_HOSTNAME", oldCdn);
    }
  }));
