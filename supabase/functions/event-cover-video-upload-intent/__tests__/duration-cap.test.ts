import {
  EFFECTIVE_TRIM_CEILING_MS,
  handleEventCoverVideoUploadIntent,
} from "../index.ts";

const EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";

const makeRequest = (sourceDurationMs: number): Request =>
  new Request("https://example.test/functions/v1/event-cover-video-upload-intent", {
    body: JSON.stringify({
      applyMode: "published_manual",
      brandId: BRAND_ID,
      eventId: EVENT_ID,
      sourceBytes: 289420,
      sourceDurationMs,
    }),
    headers: {
      Authorization: "Bearer user-session-jwt",
      "Content-Type": "application/json",
    },
    method: "POST",
  });

const createSupabaseStub = () => {
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
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: "job_29250" }, error: null }),
          }),
        }),
        update: () => ({
          eq: () => eqResult,
        }),
      };
    },
  };
};

const createDeps = () => ({
  cloudinarySignature: () => Promise.resolve("signed-upload-payload"),
  providerConfigured: () => true,
  requireEventManager: () =>
    Promise.resolve({ event: { brand_id: BRAND_ID, id: EVENT_ID, status: "published" } }),
  requireUserId: () => Promise.resolve("user_123"),
  serviceRoleClient: createSupabaseStub,
});

Deno.test("ORCH-0978 duration cap accepts 29250ms boundary", async () => {
  Deno.env.set("CLOUDINARY_CLOUD_NAME", "mingla-test");
  Deno.env.set("CLOUDINARY_API_KEY", "api-key");
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");

  const response = await handleEventCoverVideoUploadIntent(
    makeRequest(EFFECTIVE_TRIM_CEILING_MS),
    createDeps() as never,
  );
  const body = await response.json();

  if (response.status !== 200) {
    throw new Error(`Expected 200 at boundary, received ${response.status}`);
  }
  if (body.jobId !== "job_29250") {
    throw new Error(`Expected jobId job_29250, received ${String(body.jobId)}`);
  }
});

Deno.test("ORCH-0978 duration cap rejects 29251ms", async () => {
  const response = await handleEventCoverVideoUploadIntent(
    makeRequest(EFFECTIVE_TRIM_CEILING_MS + 1),
    createDeps() as never,
  );
  const body = await response.json();
  const expected = {
    error: "duration_over_cap",
    detail: {
      sourceDurationMs: EFFECTIVE_TRIM_CEILING_MS + 1,
      ceilingMs: EFFECTIVE_TRIM_CEILING_MS,
    },
  };

  if (response.status !== 422) {
    throw new Error(`Expected 422 above boundary, received ${response.status}`);
  }
  if (JSON.stringify(body) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
  }
});
