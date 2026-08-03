// #966 [TEST-MOD-APPROVED ORCH-0966] — the Cloudinary webhook arm (job_id
// recovery from an x-cld-signature-verified eager `public_id`/`context`) was
// removed as dead residue post-META-1270. handleEventCoverVideoWebhook now routes
// unconditionally to the Bunny library-level handler. The former Cloudinary
// job_id-recovery assertions are retired in place; what remains proves the arm is
// GONE — a former Cloudinary-shaped payload (public_id + eager, no VideoGuid) is
// rejected as an invalid Bunny payload rather than silently job_id-recovered.
import { handleEventCoverVideoWebhook } from "../index.ts";

const JOB_ID = "dde19eac-9810-4e0d-b8f6-63fe235fc5af";
const EVENT_ID = "09b4ece6-eabc-4734-8ce3-3a25d90417e4";
const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const makeRequest = (payload: Record<string, unknown>): Request =>
  new Request("https://example.test/functions/v1/event-cover-video-webhook", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const readJson = async (response: Response): Promise<Record<string, unknown>> =>
  await response.json() as Record<string, unknown>;

Deno.test("#966 webhook is Bunny-only — a former Cloudinary eager payload is rejected, never job_id-recovered", async () => {
  // The Bunny payload guard rejects (no VideoGuid) BEFORE any signature check or
  // DB lookup, so default deps are never exercised.
  const response = await handleEventCoverVideoWebhook(
    makeRequest({
      notification_type: "eager",
      public_id: `event-covers/raw/${BRAND_ID}/${EVENT_ID}/${JOB_ID}`,
      eager: [{ secure_url: "https://res.cloudinary.com/x/video/upload/v1/processed.mp4" }],
    }),
  );
  const body = await readJson(response);

  assert(response.status === 400, `expected 400 for a non-Bunny payload, received ${response.status}`);
  assert(
    body.detail === "bunny_payload_invalid",
    `expected bunny_payload_invalid, received ${String(body.detail)}`,
  );
});

Deno.test("#966 webhook rejects a bare Cloudinary context payload (no VideoGuid) as an invalid Bunny payload", async () => {
  const response = await handleEventCoverVideoWebhook(
    makeRequest({
      notification_type: "eager",
      context: { custom: { job_id: JOB_ID } },
    }),
  );
  const body = await readJson(response);

  assert(response.status === 400, `expected 400, received ${response.status}`);
  assert(
    body.detail === "bunny_payload_invalid",
    `expected bunny_payload_invalid, received ${String(body.detail)}`,
  );
});
