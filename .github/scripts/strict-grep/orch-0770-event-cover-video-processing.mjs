#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const mustExist = [
  "supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql",
  "supabase/functions/event-cover-video-upload-intent/index.ts",
  "supabase/functions/event-cover-video-status/index.ts",
  "supabase/functions/event-cover-video-webhook/index.ts",
  "supabase/functions/event-cover-video-apply/index.ts",
  "supabase/functions/event-cover-video-cancel/index.ts",
  "mingla-business/src/services/eventCoverVideoProcessingService.ts",
];

const read = (path) => readFileSync(join(root, path), "utf8");
const fail = (message) => {
  console.error(`[orch-0770] ${message}`);
  process.exit(1);
};

for (const path of mustExist) {
  if (!existsSync(join(root, path))) fail(`missing required file: ${path}`);
}

const creator = read("mingla-business/src/components/event/CreatorStep4Cover.tsx");
if (!creator.includes("createEventCoverVideoUploadIntent")) {
  fail("CreatorStep4Cover must use the processing upload-intent flow for videos.");
}
if (!creator.includes("allowsEditing: true") || !creator.includes("videoMaxDuration: 15")) {
  fail("CreatorStep4Cover must request native video editing before upload-intent.");
}
if (!creator.includes("validateNativeTrimmedEventCoverVideo")) {
  fail("CreatorStep4Cover must validate native-trimmed video output before upload-intent.");
}
if (creator.includes("Use this clip") || creator.includes("Trim video cover")) {
  fail("CreatorStep4Cover must not expose the retired custom trim panel in the native-trim flow.");
}

const service = read("mingla-business/src/services/eventCoverVideoProcessingService.ts");
if (!service.includes("EVENT_COVER_FINAL_MAX_BYTES = 25 * 1024 * 1024")) {
  fail("final processed video budget must be 25 MB.");
}
if (!service.includes("EVENT_COVER_MAX_SOURCE_VIDEO_BYTES = 500 * 1024 * 1024")) {
  fail("source phone-video intake must be larger than the processed derivative budget.");
}

const uploadIntent = read("supabase/functions/event-cover-video-upload-intent/index.ts");
if (!uploadIntent.includes("vc_h264") || !uploadIntent.includes("ac_aac") || !uploadIntent.includes("f_mp4")) {
  fail("Cloudinary eager transform must request browser-safe H.264/AAC MP4 output.");
}
if (!uploadIntent.includes("provider_not_configured")) {
  fail("missing honest provider-not-configured response.");
}

const webhook = read("supabase/functions/event-cover-video-webhook/index.ts");
if (!webhook.includes("assertProcessedDerivative")) {
  fail("webhook must reject provider outputs that miss final derivative constraints.");
}
if (!webhook.includes("x-cld-timestamp")) {
  fail("webhook must verify Cloudinary notifications with x-cld-timestamp.");
}
if (webhook.includes("rawBody}${apiSecret}") || webhook.includes("rawBody}${Deno.env")) {
  fail("webhook must not use timestamp-free rawBody + apiSecret notification signature verification.");
}

const shared = read("supabase/functions/_shared/eventCoverVideo.ts");
if (!shared.includes("verifyCloudinaryNotificationSignature")) {
  fail("shared edge helper must expose testable Cloudinary notification verification.");
}
if (!shared.includes("rawBody}${input.timestamp}${input.apiSecret}")) {
  fail("Cloudinary notification verification must sign raw body + x-cld-timestamp + API secret.");
}

const config = read("supabase/config.toml");
if (!config.includes("[functions.event-cover-video-webhook]")) {
  fail("supabase/config.toml must configure event-cover-video-webhook.");
}
if (!/\[functions\.event-cover-video-webhook\][\s\S]*?verify_jwt\s*=\s*false/.test(config)) {
  fail("event-cover-video-webhook must have verify_jwt = false for third-party Cloudinary callbacks.");
}

const publicPage = read("mingla-business/src/components/event/PublicEventPage.tsx");
if (!publicPage.includes("isLegacyUnsafeEventCoverVideoUrl")) {
  fail("public page must avoid rendering historical unsafe MOV/QuickTime URLs as browser video.");
}

console.log("[orch-0770] event cover video processing guard passed");
