// #966 [TEST-MOD-APPROVED ORCH-0966] — Cloudinary is retired; the notification-
// signature + destroy helpers (verifyCloudinaryNotificationSignature,
// cloudinaryDestroy) and their tests were removed with the dead upload/webhook
// path. The retained coverage (status mapping + ready-update column shape) is
// provider-agnostic and stays live.
import {
  eventCoverVideoReadyUpdate,
  mapEventCoverVideoStatus,
  serviceRoleClient,
} from "./eventCoverVideo.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

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
