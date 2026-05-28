import {
  handleEventCoverVideoUploadIntent,
  SOURCE_CEILING_MS,
} from "../index.ts";

const EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";

type UploadIntentTestBody = {
  sourceDurationMs?: number;
  trimEndMs?: number;
  trimStartMs?: number;
};

type CapturedUploadIntentWrite = {
  insert?: Record<string, unknown>;
  providerPayload?: Record<string, unknown>;
};

const makeRequest = (body: UploadIntentTestBody): Request =>
  new Request("https://example.test/functions/v1/event-cover-video-upload-intent", {
    body: JSON.stringify({
      applyMode: "published_manual",
      brandId: BRAND_ID,
      eventId: EVENT_ID,
      sourceBytes: 289420,
      sourceDurationMs: body.sourceDurationMs,
      trimEndMs: body.trimEndMs,
      trimStartMs: body.trimStartMs,
    }),
    headers: {
      Authorization: "Bearer user-session-jwt",
      "Content-Type": "application/json",
    },
    method: "POST",
  });

const createSupabaseStub = (captured: CapturedUploadIntentWrite = {}) => {
  const updateResult = { error: null };
  const eqResult = {
    not: () => Promise.resolve(updateResult),
    then: (resolve: (value: typeof updateResult) => unknown) =>
      Promise.resolve(updateResult).then(resolve),
  };
  return {
    from: (table: string) => {
      if (table !== "event_cover_video_jobs") {
        throw new Error(`Unexpected table ${table}`);
      }
      return {
        insert: (payload: Record<string, unknown>) => {
          captured.insert = payload;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "job_source_ceiling" }, error: null }),
            }),
          };
        },
        update: (payload: Record<string, unknown>) => ({
          eq: (column: string) => {
            if (column === "id") {
              captured.providerPayload = payload;
            }
            return eqResult;
          },
        }),
      };
    },
  };
};

const createDeps = (captured: CapturedUploadIntentWrite = {}) => ({
  cloudinarySignature: () => Promise.resolve("signed-upload-payload"),
  providerConfigured: () => true,
  requireEventManager: () =>
    Promise.resolve({ event: { brand_id: BRAND_ID, id: EVENT_ID, status: "published" } }),
  requireUserId: () => Promise.resolve("user_123"),
  serviceRoleClient: () => createSupabaseStub(captured),
});

Deno.test("ORCH-0978 duration cap accepts 33000ms source boundary", async () => {
  Deno.env.set("CLOUDINARY_CLOUD_NAME", "mingla-test");
  Deno.env.set("CLOUDINARY_API_KEY", "api-key");
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");

  const response = await handleEventCoverVideoUploadIntent(
    makeRequest({ sourceDurationMs: SOURCE_CEILING_MS }),
    createDeps() as never,
  );
  const body = await response.json();

  if (response.status !== 200) {
    throw new Error(`Expected 200 at boundary, received ${response.status}`);
  }
  if (body.jobId !== "job_source_ceiling") {
    throw new Error(`Expected jobId job_source_ceiling, received ${String(body.jobId)}`);
  }
});

Deno.test("ORCH-0978 duration cap rejects 33001ms", async () => {
  const response = await handleEventCoverVideoUploadIntent(
    makeRequest({ sourceDurationMs: SOURCE_CEILING_MS + 1 }),
    createDeps() as never,
  );
  const body = await response.json();
  const expected = {
    error: "duration_over_cap",
    detail: {
      sourceDurationMs: SOURCE_CEILING_MS + 1,
      ceilingMs: SOURCE_CEILING_MS,
    },
  };

  if (response.status !== 422) {
    throw new Error(`Expected 422 above boundary, received ${response.status}`);
  }
  if (JSON.stringify(body) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
  }
});

Deno.test("ORCH-0978 generous source clamps persisted trim window to 30000ms", async () => {
  const captured: CapturedUploadIntentWrite = {};
  const response = await handleEventCoverVideoUploadIntent(
    makeRequest({ sourceDurationMs: 31_000, trimEndMs: 31_000, trimStartMs: 0 }),
    createDeps(captured) as never,
  );
  const body = await response.json();
  const eager = (captured.providerPayload?.provider_payload as { eager?: string } | undefined)
    ?.eager;

  if (response.status !== 200) {
    throw new Error(
      `Expected 200 for clamped source, received ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  if (captured.insert?.source_duration_ms !== 31_000) {
    throw new Error(
      `Expected source_duration_ms=31000, received ${String(captured.insert?.source_duration_ms)}`,
    );
  }
  if (captured.insert?.trim_end_ms !== 30_000) {
    throw new Error(
      `Expected clamped trim_end_ms=30000, received ${String(captured.insert?.trim_end_ms)}`,
    );
  }
  if (typeof eager !== "string" || !eager.includes("du_30")) {
    throw new Error(`Expected eager transformation to contain du_30, received ${String(eager)}`);
  }
});

Deno.test("ORCH-0978 normal native trim remains unclamped", async () => {
  const captured: CapturedUploadIntentWrite = {};
  const response = await handleEventCoverVideoUploadIntent(
    makeRequest({ sourceDurationMs: 29_400, trimEndMs: 29_400, trimStartMs: 0 }),
    createDeps(captured) as never,
  );
  const body = await response.json();

  if (response.status !== 200) {
    throw new Error(
      `Expected 200 for normal trim, received ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  if (captured.insert?.source_duration_ms !== 29_400) {
    throw new Error(
      `Expected source_duration_ms=29400, received ${String(captured.insert?.source_duration_ms)}`,
    );
  }
  if (captured.insert?.trim_end_ms !== 29_400) {
    throw new Error(`Expected trim_end_ms=29400, received ${String(captured.insert?.trim_end_ms)}`);
  }
});
