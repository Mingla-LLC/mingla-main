#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const read = (path) => readFileSync(join(root, path), "utf8");
const fail = (message) => {
  console.error(`[orch-0776] ${message}`);
  process.exit(1);
};

const requiredFiles = [
  "supabase/functions/event-cover-video-source-uploaded/index.ts",
  "supabase/functions/event-cover-video-status/index.ts",
  "supabase/functions/event-cover-video-webhook/index.ts",
  "supabase/functions/event-cover-video-cancel/index.ts",
  "supabase/functions/_shared/eventCoverVideo.ts",
  "supabase/migrations/20270604002715_issue_2715_deterministic_cover_video_jobs.sql",
  "mingla-business/src/services/eventCoverVideoProcessingService.ts",
  "mingla-business/src/components/event/CreatorStep4Cover.tsx",
];

for (const path of requiredFiles) {
  if (!existsSync(join(root, path))) fail(`missing required file: ${path}`);
}

const service = read("mingla-business/src/services/eventCoverVideoProcessingService.ts");
const shared = read("supabase/functions/_shared/eventCoverVideo.ts");
const status = read("supabase/functions/event-cover-video-status/index.ts");
const sourceUploaded = read("supabase/functions/event-cover-video-source-uploaded/index.ts");
const webhook = read("supabase/functions/event-cover-video-webhook/index.ts");
const cancel = read("supabase/functions/event-cover-video-cancel/index.ts");
const deterministicJobs = read("supabase/migrations/20270604002715_issue_2715_deterministic_cover_video_jobs.sql");

if (!service.includes("acknowledgeEventCoverVideoSourceUploaded")) {
  fail("service must expose source-upload acknowledgement.");
}
if (!service.includes("lastStatus") || !service.includes("Your video is still processing. You can check again in a moment.")) {
  fail("wait timeout must carry last status and use recoverable copy.");
}
if (service.includes("Video is still processing. Try again in a moment.")) {
  fail("service must not keep the old dead-end timeout copy.");
}
if (!shared.includes("mapEventCoverVideoStatus")) {
  fail("shared edge helper must centralize enriched status mapping.");
}
if (!status.includes("mapEventCoverVideoStatus") || status.includes(".update(")) {
  fail("status function must return enriched payload without mutating state.");
}
if (!sourceUploaded.includes("status: \"source_uploaded\"")) {
  fail("source-uploaded function must durably move source_uploading jobs forward.");
}
if (!sourceUploaded.includes("provider_payload") || sourceUploaded.includes("secure_url")) {
  fail("source-uploaded function must store sanitized provider metadata without source URL.");
}
if (!webhook.includes('failure_code: "provider_failed"') ||
    !webhook.includes("cover_video_transition_job")) {
  fail("webhook must send provider failures through the canonical transition RPC.");
}
if (!deterministicJobs.includes("completed_at=CASE WHEN p_to_status IN") ||
    !deterministicJobs.includes("failure_code=coalesce(p_patch->>'failure_code'")) {
  fail("canonical transition RPC must persist terminal completion and failure state.");
}
// #966 (SPEC AMENDMENT 1): re-pointed from the removed Cloudinary tail's
// `late_webhook_ignored_cancelled` log stage to the Bunny terminal guard that
// enforces the SAME invariant — handleEventCoverVideoWebhook's terminal guards
// idempotently ignore a late callback for a cancelled job. Re-point, not weaken:
// removing the cancelled-status ignore (or the `ignored: "cancelled"` response)
// still fails this gate.
if (!webhook.includes('existingJob.status === "cancelled"') ||
    !webhook.includes('existingJob.status === "superseded"') ||
    !webhook.includes("ignored: existingJob.status")) {
  fail("webhook must ignore late callbacks for cancelled/superseded jobs.");
}
if (!cancel.includes("source_uploaded") && !cancel.includes("mapEventCoverVideoStatus")) {
  fail("cancel function must support enriched cancellation from active processing states.");
}

console.log("[orch-0776] video processing status bridge guard passed");
