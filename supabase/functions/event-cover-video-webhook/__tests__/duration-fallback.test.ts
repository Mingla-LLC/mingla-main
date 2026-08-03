// #966 [TEST-MOD-APPROVED ORCH-0966] — the Cloudinary eager-duration fallback
// (eagerDurationOrFallback + the x-cld-signature verifyWebhook arm) was removed
// as dead residue post-META-1270. handleEventCoverVideoWebhook now routes
// unconditionally to the Bunny handler, which derives duration from the Bunny
// video length (see bunny-webhook.test.ts). The former Cloudinary duration-
// fallback assertions are retired in place; what remains proves the Cloudinary
// eager arm is GONE — a captured Cloudinary eager payload (no VideoGuid) is
// rejected as an invalid Bunny payload rather than duration-fallback-processed.
import { handleEventCoverVideoWebhook } from "../index.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

// A fixture-faithful Cloudinary eager_notification payload (captured shape). Post
// #966 it carries no VideoGuid, so the Bunny payload guard rejects it up front.
const capturedCloudinaryEagerPayload = {
  eager: [{
    url: "http://res.cloudinary.com/demo/video/upload/c_limit,w_1280,h_720,vc_h264,ac_aac,br_9000k,f_mp4,q_auto:good/v1/event-covers/raw/brand/event/job.mp4",
    bytes: 305371,
    format: "mp4",
  }],
  public_id: "event-covers/raw/brand/event/99179520-3566-4202-bf7c-f8711257ce0c",
  notification_type: "eager",
};

const makeRequest = (payload: Record<string, unknown>): Request =>
  new Request("https://example.test/functions/v1/event-cover-video-webhook", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

Deno.test("#966 webhook rejects the captured Cloudinary eager payload — no duration fallback arm remains", async () => {
  const response = await handleEventCoverVideoWebhook(makeRequest(capturedCloudinaryEagerPayload));
  const body = await response.json() as Record<string, unknown>;

  assert(response.status === 400, `expected 400 for a non-Bunny payload, received ${response.status}`);
  assert(
    body.detail === "bunny_payload_invalid",
    `expected bunny_payload_invalid (Cloudinary eager arm removed), received ${String(body.detail)}`,
  );
});
