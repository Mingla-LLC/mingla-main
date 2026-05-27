import { handleEventCoverVideoWebhook } from "../index.ts";
import { sha1Hex } from "../../_shared/eventCoverVideo.ts";

const JOB_ID = "99179520-3566-4202-bf7c-f8711257ce0c";
const EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";
const API_SECRET = "cloudinary-test-secret";
const TIMESTAMP = "1778346000";

type UpdateCall = {
  table: string;
  payload: Record<string, unknown>;
  eq?: { column: string; value: unknown };
};

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const capturedPayload = {
  "eager": [{
    "url": "http://res.cloudinary.com/dhza7d54o/video/upload/c_limit,w_1280,h_720,vc_h264,ac_aac,br_9000k,f_mp4,q_auto:good/v1779910931/event-covers/raw/22a18413-bfbf-4087-9ba7-45f70deba0f3/09b4ece6-eabc-4734-8ce3-3a25d90417e4/99179520-3566-4202-bf7c-f8711257ce0c.mp4",
    "bytes": 305371,
    "width": 1280,
    "format": "mp4",
    "height": 720,
    "secure_url": "https://res.cloudinary.com/dhza7d54o/video/upload/c_limit,w_1280,h_720,vc_h264,ac_aac,br_9000k,f_mp4,q_auto:good/v1779910931/event-covers/raw/22a18413-bfbf-4087-9ba7-45f70deba0f3/09b4ece6-eabc-4734-8ce3-3a25d90417e4/99179520-3566-4202-bf7c-f8711257ce0c.mp4",
    "transformation": "c_limit,w_1280,h_720,vc_h264,ac_aac,br_9000k,f_mp4,q_auto:good",
  }],
  "api_key": "351961575759598",
  "asset_id": "1e3fcc5a073e15b29926b4fdca5a1b79",
  "batch_id": "fa50cec935e09174f369fbf446e352491437b4c9053c6fe89d70d3f64818cce2758d39cee15af4e6e85331195513004f",
  "public_id": "event-covers/raw/22a18413-bfbf-4087-9ba7-45f70deba0f3/09b4ece6-eabc-4734-8ce3-3a25d90417e4/99179520-3566-4202-bf7c-f8711257ce0c",
  "timestamp": "2026-05-27T19:42:16+00:00",
  "request_id": "aede61e90d89d060c522e67c1cf07a66",
  "signature_key": "351961575759598",
  "notification_type": "eager",
  "notification_context": {
    "triggered_at": "2026-05-27T19:42:11.876420Z",
    "triggered_by": { "id": "351961575759598", "source": "api" },
  },
};

const cloneCapturedPayload = (): Record<string, unknown> =>
  structuredClone(capturedPayload) as Record<string, unknown>;

const firstEager = (payload: Record<string, unknown>): Record<string, unknown> => {
  const eager = payload.eager;
  assert(Array.isArray(eager), "expected eager array");
  const eagerArray = eager as unknown[];
  assert(typeof eagerArray[0] === "object" && eagerArray[0] !== null, "expected eager object");
  return eagerArray[0] as Record<string, unknown>;
};

const signBody = async (rawBody: string): Promise<string> =>
  sha1Hex(`${rawBody}${TIMESTAMP}${API_SECRET}`);

const makeRequest = async (payload: Record<string, unknown>): Promise<Request> => {
  const rawBody = JSON.stringify(payload);
  return new Request("https://example.test/functions/v1/event-cover-video-webhook", {
    body: rawBody,
    headers: {
      "Content-Type": "application/json",
      "x-cld-signature": await signBody(rawBody),
      "x-cld-timestamp": TIMESTAMP,
    },
    method: "POST",
  });
};

const createSupabaseStub = (options: {
  trimStartMs?: number | null;
  trimEndMs?: number | null;
} = {}) => {
  const updates: UpdateCall[] = [];
  const existingJob = {
    id: JOB_ID,
    status: "source_uploaded",
    event_id: EVENT_ID,
    apply_mode: "published_manual",
    trim_start_ms: options.trimStartMs ?? 0,
    trim_end_ms: options.trimEndMs === undefined ? 12_000 : options.trimEndMs,
  };

  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: existingJob, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        const call: UpdateCall = { table, payload };
        updates.push(call);
        return {
          eq: (column: string, value: unknown) => {
            call.eq = { column, value };
            const result = { data: null, error: null };
            return {
              then: (resolve: (value: typeof result) => unknown) =>
                Promise.resolve(result).then(resolve),
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: value,
                      event_id: EVENT_ID,
                      apply_mode: existingJob.apply_mode,
                    },
                    error: null,
                  }),
              }),
            };
          },
        };
      },
    }),
  };

  return { client, updates };
};

const createDeps = (stub = createSupabaseStub()) => ({
  serviceRoleClient: () => stub.client,
  verifyWebhook: async (req: Request, rawBody: string) => {
    const expected = await signBody(rawBody);
    return req.headers.get("x-cld-signature") === expected &&
        req.headers.get("x-cld-timestamp") === TIMESTAMP
      ? { ok: true as const }
      : {
        ok: false as const,
        code: "invalid_signature",
        status: 403,
        message: "Cloudinary signature is invalid.",
      };
  },
}) as never;

const captureWarns = async (run: () => Promise<void>): Promise<string[]> => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    await run();
    return warnings;
  } finally {
    console.warn = originalWarn;
  }
};

const readyUpdate = (updates: UpdateCall[]): Record<string, unknown> => {
  const update = updates.find((call) => call.payload.status === "ready");
  if (update === undefined) {
    const failed = updates.find((call) => call.payload.status === "failed");
    if (failed !== undefined) {
      throw new Error(
        `expected ready update; received failed update with failure_code=${failed.payload.failure_code} failure_message=${failed.payload.failure_message}`,
      );
    }
    throw new Error("expected ready update");
  }
  return update.payload;
};

const failedUpdate = (updates: UpdateCall[]): Record<string, unknown> => {
  const update = updates.find((call) => call.payload.status === "failed");
  if (update === undefined) throw new Error("expected failed update");
  return update.payload;
};

Deno.test("T-AMEND6-01 falls back to job trim for fixture-faithful Cloudinary payload", async () => {
  const stub = createSupabaseStub({ trimStartMs: 0, trimEndMs: 12_000 });
  const payload = cloneCapturedPayload();
  const warnings = await captureWarns(async () => {
    const response = await handleEventCoverVideoWebhook(
      await makeRequest(payload),
      createDeps(stub),
    );
    assert(response.status === 200, `expected 200, received ${response.status}`);
  });
  const ready = readyUpdate(stub.updates);

  assert(ready.processed_duration_ms === 12_000, "expected trim fallback duration");
  assert(ready.processed_url === firstEager(payload).secure_url, "expected processed secure_url");
  assert(
    warnings.some((warning) => warning.includes("duration_fallback_to_job_trim")),
    "expected fallback warning",
  );
});

Deno.test("T-AMEND6-02 uses Cloudinary float-second duration without fallback warning", async () => {
  const stub = createSupabaseStub({ trimStartMs: 0, trimEndMs: 12_000 });
  const payload = cloneCapturedPayload();
  firstEager(payload).duration = 12.0;
  const warnings = await captureWarns(async () => {
    const response = await handleEventCoverVideoWebhook(
      await makeRequest(payload),
      createDeps(stub),
    );
    assert(response.status === 200, `expected 200, received ${response.status}`);
  });
  const ready = readyUpdate(stub.updates);

  assert(ready.processed_duration_ms === 12_000, "expected seconds-to-ms duration");
  assert(ready.status === "ready", "expected ready status");
  assert(
    !warnings.some((warning) => warning.includes("duration_fallback_to_job_trim")),
    "did not expect fallback warning",
  );
});

Deno.test("T-AMEND6-03 writes over-cap code for genuine provider over-duration", async () => {
  const stub = createSupabaseStub({ trimStartMs: 0, trimEndMs: 12_000 });
  const payload = cloneCapturedPayload();
  firstEager(payload).duration = 35.0;
  const response = await handleEventCoverVideoWebhook(
    await makeRequest(payload),
    createDeps(stub),
  );
  const failed = failedUpdate(stub.updates);

  assert(response.status === 200, `expected 200, received ${response.status}`);
  assert(failed.failure_code === "processed_duration_over_cap", "expected over-cap code");
  assert(
    failed.failure_message === "Processed video was over the duration limit.",
    "expected over-cap message",
  );
});

Deno.test("T-AMEND6-04 writes missing code when provider duration and trim fallback are absent", async () => {
  const stub = createSupabaseStub({ trimStartMs: 0, trimEndMs: null });
  const payload = cloneCapturedPayload();
  const response = await handleEventCoverVideoWebhook(
    await makeRequest(payload),
    createDeps(stub),
  );
  const failed = failedUpdate(stub.updates);

  assert(response.status === 200, `expected 200, received ${response.status}`);
  assert(failed.failure_code === "processed_duration_missing", "expected missing-duration code");
  assert(
    failed.failure_message === "Processed video duration was missing from the provider callback.",
    "expected missing-duration message",
  );
});

Deno.test("T-AMEND6-05 writes nonpositive code for zero provider duration", async () => {
  const stub = createSupabaseStub({ trimStartMs: 0, trimEndMs: 12_000 });
  const payload = cloneCapturedPayload();
  firstEager(payload).duration = 0;
  const response = await handleEventCoverVideoWebhook(
    await makeRequest(payload),
    createDeps(stub),
  );
  const failed = failedUpdate(stub.updates);

  assert(response.status === 200, `expected 200, received ${response.status}`);
  assert(failed.failure_code === "processed_duration_nonpositive", "expected nonpositive code");
  assert(
    failed.failure_message === "Processed video duration was zero or negative.",
    "expected nonpositive message",
  );
});
