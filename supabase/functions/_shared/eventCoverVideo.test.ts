import {
  cloudinaryDestroy,
  eventCoverVideoReadyUpdate,
  mapEventCoverVideoStatus,
  serviceRoleClient,
  sha1Hex,
  verifyCloudinaryNotificationSignature,
} from "./eventCoverVideo.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const withCloudinaryEnvAndFetch = async (
  response: Response,
  assertion: () => Promise<void>,
): Promise<void> => {
  const originalFetch = globalThis.fetch;
  const originalCloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME");
  const originalApiKey = Deno.env.get("CLOUDINARY_API_KEY");
  const originalApiSecret = Deno.env.get("CLOUDINARY_API_SECRET");

  Deno.env.set("CLOUDINARY_CLOUD_NAME", "demo");
  Deno.env.set("CLOUDINARY_API_KEY", "key");
  Deno.env.set("CLOUDINARY_API_SECRET", "secret");
  globalThis.fetch = (() => Promise.resolve(response)) as typeof fetch;

  try {
    await assertion();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCloudName === undefined) Deno.env.delete("CLOUDINARY_CLOUD_NAME");
    else Deno.env.set("CLOUDINARY_CLOUD_NAME", originalCloudName);
    if (originalApiKey === undefined) Deno.env.delete("CLOUDINARY_API_KEY");
    else Deno.env.set("CLOUDINARY_API_KEY", originalApiKey);
    if (originalApiSecret === undefined) Deno.env.delete("CLOUDINARY_API_SECRET");
    else Deno.env.set("CLOUDINARY_API_SECRET", originalApiSecret);
  }
};

Deno.test("Cloudinary notification signature accepts body + timestamp + secret", async () => {
  const rawBody = '{"public_id":"sample"}';
  const timestamp = "1778346000";
  const apiSecret = "test-secret";
  const signature = await sha1Hex(`${rawBody}${timestamp}${apiSecret}`);

  const result = await verifyCloudinaryNotificationSignature({
    apiSecret,
    nowMs: 1778346000 * 1000,
    rawBody,
    signature,
    timestamp,
  });

  assert(result.ok, "expected documented Cloudinary notification signature to pass");
});

Deno.test("Cloudinary notification signature rejects old body-only payload", async () => {
  const rawBody = '{"public_id":"sample"}';
  const timestamp = "1778346000";
  const apiSecret = "test-secret";
  const oldStyleSignature = await sha1Hex(`${rawBody}${apiSecret}`);

  const result = await verifyCloudinaryNotificationSignature({
    apiSecret,
    nowMs: 1778346000 * 1000,
    rawBody,
    signature: oldStyleSignature,
    timestamp,
  });

  assert(!result.ok && result.code === "invalid_signature", "expected old signature to fail");
});

Deno.test("Cloudinary notification signature rejects missing timestamp", async () => {
  const result = await verifyCloudinaryNotificationSignature({
    apiSecret: "test-secret",
    nowMs: 1778346000 * 1000,
    rawBody: "{}",
    signature: "abc",
    timestamp: null,
  });

  assert(!result.ok && result.code === "missing_timestamp", "expected missing timestamp failure");
});

Deno.test("Cloudinary notification signature rejects stale timestamp", async () => {
  const result = await verifyCloudinaryNotificationSignature({
    apiSecret: "test-secret",
    nowMs: 1778346000 * 1000,
    rawBody: "{}",
    signature: "abc",
    timestamp: `${1778346000 - 7200}`,
  });

  assert(!result.ok && result.code === "stale_timestamp", "expected stale timestamp failure");
});

Deno.test("Cloudinary notification signature rejects invalid signature", async () => {
  const result = await verifyCloudinaryNotificationSignature({
    apiSecret: "test-secret",
    nowMs: 1778346000 * 1000,
    rawBody: "{}",
    signature: "not-the-signature",
    timestamp: "1778346000",
  });

  assert(!result.ok && result.code === "invalid_signature", "expected invalid signature failure");
});

Deno.test("event cover video status mapping exposes honest processing affordances", () => {
  const status = mapEventCoverVideoStatus({
    apply_mode: "draft_auto",
    brand_id: "brand-id",
    created_at: "2026-05-10T00:00:00.000Z",
    event_id: "event-id",
    id: "job-id",
    processed_url: null,
    provider_payload: {
      source_upload: { acknowledged_at: "2026-05-10T00:00:01.000Z" },
    },
    status: "source_uploaded",
    updated_at: "2026-05-10T00:00:01.000Z",
  });

  assert(status.status === "source_uploaded", "expected source_uploaded status");
  assert(status.stageLabel === "Upload complete. Preparing processing...", "expected stage label");
  assert(status.canCheckAgain, "expected check-again affordance");
  assert(status.canCancel, "expected cancel affordance");
  assert(status.sourceUploadedAt === "2026-05-10T00:00:01.000Z", "expected source timestamp");
});

Deno.test("event cover video status mapping marks applied processed MP4 terminal", () => {
  const status = mapEventCoverVideoStatus({
    applied_at: "2026-05-10T00:00:02.000Z",
    apply_mode: "draft_auto",
    brand_id: "brand-id",
    event_id: "event-id",
    id: "job-id",
    processed_bytes: 123456,
    processed_duration_ms: 8000,
    processed_mime_type: "video/mp4",
    processed_url: "https://cdn.example.com/processed.mp4",
    provider_payload: {},
    status: "applied",
  });

  assert(status.isTerminal, "expected terminal status");
  assert(!status.canCheckAgain, "expected no check-again affordance");
  assert(status.processedMimeType === "video/mp4", "expected processed MP4");
  assert(status.processedUrl?.endsWith(".mp4") === true, "expected processed URL");
});

Deno.test("T-05 cancel cleanup treats Cloudinary destroy not found as idempotent success", async () => {
  await withCloudinaryEnvAndFetch(
    new Response(JSON.stringify({ result: "not found" }), { status: 200 }),
    async () => {
      const result = await cloudinaryDestroy("event-covers/raw/brand/event/job");

      assert(result.ok, "expected already-destroyed Cloudinary source to be cancel-safe");
    },
  );
});

Deno.test("T-05 cancel cleanup reports Cloudinary destroy failure without throwing", async () => {
  await withCloudinaryEnvAndFetch(
    new Response(JSON.stringify({ error: { message: "temporary outage" } }), {
      status: 503,
    }),
    async () => {
      const result = await cloudinaryDestroy("event-covers/raw/brand/event/job");

      assert(!result.ok, "expected destroy failure to return a structured failure");
      assert(
        !result.ok && result.reason === "cloudinary_destroy_http_503",
        "expected Cloudinary HTTP status in failure reason",
      );
    },
  );
});

Deno.test("event cover video ready update column set matches live table shape", async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("[eventCoverVideo.test] skipping live column-shape check; Supabase env is missing");
    return;
  }

  const update = eventCoverVideoReadyUpdate({
    applyMode: "published_manual",
    derivative: {
      bytes: 123456,
      durationMs: 8000,
      url: "https://cdn.example.com/processed.mp4",
    },
    providerPayload: { public_id: "event-covers/processed/job-id" },
  });

  assert(!("processed_at" in update), "ready update must not write missing processed_at column");

  const { error } = await serviceRoleClient()
    .from("event_cover_video_jobs")
    .update(update)
    .eq("id", "00000000-0000-0000-0000-000000000000")
    .select("id")
    .maybeSingle();

  assert(!error, `expected ready update columns to be accepted by live schema: ${error?.message ?? ""}`);
});
