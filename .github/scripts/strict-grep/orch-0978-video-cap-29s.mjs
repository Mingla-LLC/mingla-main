#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const read = (filePath) => readFileSync(join(root, filePath), "utf8");
const fail = (check, message) => {
  console.error(`FAIL [${check}] ${message}`);
  process.exitCode = 1;
};
const ok = (check, message) => {
  console.log(`OK   [${check}] ${message}`);
};

const count = (source, literal) => source.split(literal).length - 1;
const walkFiles = (dirPath) => {
  const absoluteDir = join(root, dirPath);
  if (!existsSync(absoluteDir)) return [];
  const entries = readdirSync(absoluteDir);
  return entries.flatMap((entry) => {
    const relativePath = join(dirPath, entry);
    const absolutePath = join(root, relativePath);
    return statSync(absolutePath).isDirectory() ? walkFiles(relativePath) : [relativePath];
  });
};

const coverPickerPath = "mingla-business/src/components/ui/CoverPicker.tsx";
const processingServicePath =
  "mingla-business/src/services/eventCoverVideoProcessingService.ts";
const mediaRulesPath = "mingla-business/src/utils/eventCoverMediaRules.ts";
const migrationPath =
  "supabase/migrations/20260730000000_orch_0978_video_cap_29s_constraints.sql";
const uploadIntentPath = "supabase/functions/event-cover-video-upload-intent/index.ts";
const webhookPath = "supabase/functions/event-cover-video-webhook/index.ts";

const coverPicker = read(coverPickerPath);
if (count(coverPicker, "videoMaxDuration: 29") !== 1) {
  fail("C1", `${coverPickerPath} must contain videoMaxDuration: 29 exactly once`);
} else if (coverPicker.includes("videoMaxDuration: 30")) {
  fail("C1", `${coverPickerPath} must not contain videoMaxDuration: 30`);
} else {
  ok("C1", "CoverPicker client picker cap is 29 seconds");
}

const processingService = read(processingServicePath);
if (!processingService.includes("EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000")) {
  fail("C2", `${processingServicePath} must pin EVENT_COVER_MAX_VIDEO_DURATION_MS at 29_000`);
} else if (processingService.includes("EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000")) {
  fail("C2", `${processingServicePath} must not contain the old 30_000 cap`);
} else {
  ok("C2", "Cloudinary-pipeline constant is 29_000");
}

const mediaRules = read(mediaRulesPath);
if (!mediaRules.includes("EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000")) {
  fail("C3", `${mediaRulesPath} must pin EVENT_COVER_MAX_VIDEO_DURATION_MS at 29_000`);
} else if (mediaRules.includes("EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000")) {
  fail("C3", `${mediaRulesPath} must not contain the old 30_000 cap`);
} else {
  ok("C3", "Storage-pipeline constant is 29_000");
}

if (!existsSync(join(root, migrationPath))) {
  fail("C4", `${migrationPath} must exist`);
} else {
  const migration = read(migrationPath);
  const trimConstraintPattern =
    /ADD CONSTRAINT event_cover_video_jobs_trim_max_duration[\s\S]*?<= 29000/;
  const processedConstraintPattern =
    /ADD CONSTRAINT event_cover_video_jobs_processed_max_duration[\s\S]*?<= 29000/;
  if (!trimConstraintPattern.test(migration)) {
    fail("C4", "trim max-duration constraint must contain 29000");
  } else if (!processedConstraintPattern.test(migration)) {
    fail("C4", "processed max-duration constraint must contain 29000");
  } else {
    ok("C4", "DB migration pins both video duration constraints to 29000");
  }
}

const uploadIntent = read(uploadIntentPath);
const webhook = read(webhookPath);
const publicIdTemplatePattern = /event-covers\/raw\/\$\{brandId\}\/\$\{eventId\}\/\$\{job\.id\}/;
if (!publicIdTemplatePattern.test(uploadIntent)) {
  fail(
    "C5",
    `${uploadIntentPath} must contain publicId template event-covers/raw/\${brandId}/\${eventId}/\${job.id}`,
  );
} else if (!webhook.includes("recoverJobIdFromPayload") && !webhook.includes("public_id.split")) {
  fail(
    "C5",
    `${webhookPath} must contain public_id-based job_id recovery to match upload-intent template`,
  );
} else {
  ok("C5", "Upload-intent public_id template and webhook public_id parser remain aligned");
}

if (!webhook.includes("eagerDurationOrFallback") || !webhook.includes("trim_end_ms")) {
  fail(
    "C6",
    `${webhookPath} must contain eagerDurationOrFallback and trim_end_ms duration fallback references`,
  );
} else {
  ok("C6", "Webhook duration fallback remains tied to job trim columns");
}

const sharedPath = "supabase/functions/_shared/eventCoverVideo.ts";
const shared = read(sharedPath);
const durationCodes = [
  "processed_duration_missing",
  "processed_duration_nonpositive",
  "processed_duration_over_cap",
];
const missingDurationCodes = durationCodes.filter((literal) => !shared.includes(literal));
if (missingDurationCodes.length > 0) {
  fail("C7", `${sharedPath} is missing duration code(s): ${missingDurationCodes.join(", ")}`);
}
const oldLiteralFiles = [
  ...walkFiles("supabase/functions"),
  ...walkFiles("mingla-business/src"),
].filter((filePath) => read(filePath).includes("processed_duration_invalid"));
if (oldLiteralFiles.length > 0) {
  fail("C7", `processed_duration_invalid literal must be dead; found in ${oldLiteralFiles.join(", ")}`);
}
if (missingDurationCodes.length === 0 && oldLiteralFiles.length === 0) {
  ok("C7", "Processed-duration validation uses discrete codes and the old literal is dead");
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
