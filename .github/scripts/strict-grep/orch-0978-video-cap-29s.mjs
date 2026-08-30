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

const constraintClause = (source, name) => {
  const marker = `ADD CONSTRAINT ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const tail = source.slice(start + marker.length);
  const boundary = tail.search(/\bADD CONSTRAINT\b|;/);
  return marker + (boundary < 0 ? tail : tail.slice(0, boundary));
};
const constraintHasExactCap = (source, name) =>
  /<=\s*15000\b/.test(constraintClause(source, name));
const providerDurationIsAuthoritative = (source) => {
  const block = source.match(/const lengthSeconds[\s\S]*?const derivative\s*=/)?.[0] ?? "";
  return block.includes('typeof video.video.length === "number" && video.video.length > 0') &&
    block.includes("const durationMs = lengthSeconds * 1000") &&
    block.includes('error: "derivative_not_ready"') &&
    block.includes('detail: "duration_pending"') &&
    !/trim_(?:start|end)_ms/.test(block);
};

if (process.argv.includes("--self-test")) {
  const goodSql = `ALTER TABLE jobs
    ADD CONSTRAINT event_cover_video_jobs_trim_max_duration CHECK (trim_end_ms-trim_start_ms <= 15000) NOT VALID,
    ADD CONSTRAINT event_cover_video_jobs_processed_max_duration CHECK (processed_duration_ms <= 15000) NOT VALID;`;
  const goodWebhook = `
    const lengthSeconds = typeof video.video.length === "number" && video.video.length > 0 ? video.video.length : 0;
    const durationMs = lengthSeconds * 1000;
    if (durationMs <= 0) return jsonResponse({ error: "derivative_not_ready", detail: "duration_pending" }, 503);
    const derivative = validate(durationMs);`;
  const cases = [
    ["GOOD exact SQL caps", constraintHasExactCap(goodSql, "event_cover_video_jobs_trim_max_duration") && constraintHasExactCap(goodSql, "event_cover_video_jobs_processed_max_duration"), true],
    ["BAD trim 15001", constraintHasExactCap(goodSql.replace("trim_start_ms <= 15000", "trim_start_ms <= 15001"), "event_cover_video_jobs_trim_max_duration"), false],
    ["BAD processed 15001", constraintHasExactCap(goodSql.replace("processed_duration_ms <= 15000", "processed_duration_ms <= 15001"), "event_cover_video_jobs_processed_max_duration"), false],
    ["GOOD provider duration", providerDurationIsAuthoritative(goodWebhook), true],
    ["BAD trim fallback", providerDurationIsAuthoritative(goodWebhook.replace("const durationMs = lengthSeconds * 1000", "const durationMs = lengthSeconds > 0 ? lengthSeconds * 1000 : trim_end_ms - trim_start_ms")), false],
  ];
  for (const [label, actual, expected] of cases) {
    if (actual !== expected) {
      console.error(`ORCH-0978 duration gate self-test FAIL: ${label}`);
      process.exit(1);
    }
  }
  console.log("ORCH-0978 duration gate self-test PASS (5/5).");
  process.exit(0);
}

const coverPickerPath = "mingla-business/src/components/ui/CoverPicker.tsx";
const deviceMediaPath = "mingla-business/src/components/ui/coverPickerDeviceMedia.native.ts";
// ORCH-1001: the native trim wiring (react-native-video-trim import + showEditor
// + cancel handler) moved out of CoverPicker.tsx into a Metro platform-split
// module so the native-only package never lands in the web bundle (white-page
// crash). ORCH-1092 also moved the native ImagePicker calls into a platform
// split device-media module for the same reason. C1/C12 below check that native
// wiring in the split modules; CoverPicker.tsx still owns the source ceiling
// and trimmed-upload build.
const trimEditorPath = "mingla-business/src/components/ui/coverPickerVideoTrimEditor.ts";
const processingServicePath =
  "mingla-business/src/services/eventCoverVideoProcessingService.ts";
const mediaRulesPath = "mingla-business/src/utils/eventCoverMediaRules.ts";
const migrationPath =
  "supabase/migrations/20270604002715_issue_2715_deterministic_cover_video_jobs.sql";
const uploadIntentPath = "supabase/functions/event-cover-video-upload-intent/index.ts";
const webhookPath = "supabase/functions/event-cover-video-webhook/index.ts";

const coverPicker = read(coverPickerPath);
const deviceMedia = read(deviceMediaPath);
const trimEditor = read(trimEditorPath);
if (
  !coverPicker.includes(
    "trimVideoWithDedicatedEditor(asset.uri, EVENT_COVER_MAX_VIDEO_DURATION_MS)",
  )
) {
  fail("C1", `${coverPickerPath} must pass EVENT_COVER_MAX_VIDEO_DURATION_MS to the trim editor`);
} else if (!trimEditor.includes("maxDuration: maxDurationMs")) {
  fail("C1", `${trimEditorPath} must forward the duration cap to showEditor`);
} else if (coverPicker.includes("videoMaxDuration") || deviceMedia.includes("videoMaxDuration")) {
  fail("C1", "video picker must not rely on ImagePicker videoMaxDuration");
} else {
  ok("C1", "Dedicated trimmer receives the canonical 15s cap; picker videoMaxDuration is dead");
}

const processingService = read(processingServicePath);
if (!processingService.includes('import { EVENT_COVER_MAX_VIDEO_DURATION_MS }')) {
  fail("C2", `${processingServicePath} must import the canonical duration contract`);
} else if (!processingService.includes("EVENT_COVER_SOURCE_CEILING_MS = EVENT_COVER_MAX_VIDEO_DURATION_MS")) {
  fail("C2", `${processingServicePath} must make the accepted source ceiling equal the processed cap`);
} else {
  ok("C2", "Processing service consumes one exact duration contract");
}

const mediaRules = read(mediaRulesPath);
if (!mediaRules.includes("EVENT_COVER_MAX_VIDEO_DURATION_MS = 15_000")) {
  fail("C3", `${mediaRulesPath} must pin EVENT_COVER_MAX_VIDEO_DURATION_MS at 15_000`);
} else if (/EVENT_COVER_MAX_VIDEO_DURATION_MS\s*=\s*(?:29_000|30_000)/.test(mediaRules)) {
  fail("C3", `${mediaRulesPath} must not contain the old 29/30-second cap`);
} else {
  ok("C3", "Client media contract is exactly 15_000ms");
}

if (!existsSync(join(root, migrationPath))) {
  fail("C4", `${migrationPath} must exist`);
} else {
  const migration = read(migrationPath);
  if (!constraintHasExactCap(migration, "event_cover_video_jobs_trim_max_duration")) {
    fail("C4", "trim max-duration constraint must contain 15000");
  } else if (!constraintHasExactCap(migration, "event_cover_video_jobs_processed_max_duration")) {
    fail("C4", "processed max-duration constraint must contain 15000");
  } else {
    ok("C4", "DB migration pins both video duration constraints to 15000");
  }
}

const uploadIntent = read(uploadIntentPath);
const webhook = read(webhookPath);
// #966 (SPEC AMENDMENT 1): C5 re-pointed from the removed Cloudinary public_id
// template + recoverJobIdFromPayload to the Bunny job-identity alignment that
// carries the SAME invariant — upload-intent stamps the Bunny video GUID into
// source_asset_id, and the webhook resolves the owning job by that GUID. Re-point,
// not weaken: dropping either the GUID stamp or the GUID lookup still fails C5.
if (!uploadIntent.includes('"cover_video_commit_provider_allocation"') ||
    !uploadIntent.includes("p_source_asset_id: videoId")) {
  fail(
    "C5",
    `${uploadIntentPath} must atomically commit the Bunny video GUID as p_source_asset_id`,
  );
} else if (!/\.eq\("source_asset_id", videoGuid\)/.test(webhook)) {
  fail(
    "C5",
    `${webhookPath} must resolve the owning job by source_asset_id = VideoGuid to match the upload-intent GUID stamp`,
  );
} else {
  ok("C5", "Upload-intent Bunny GUID stamp and webhook source_asset_id lookup remain aligned");
}

// #2715: only provider-observed duration is authoritative. Missing Bunny length
// is retryable derivative-not-ready state; client trim columns are never an
// output-duration fallback.
if (!providerDurationIsAuthoritative(webhook)) {
  fail(
    "C6",
    `${webhookPath} must require positive Bunny length and return duration_pending without trim-derived fallback`,
  );
} else {
  ok("C6", "Webhook accepts only provider-observed duration and retries missing evidence");
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

const eventCoverMediaServicePath = "mingla-business/src/services/eventCoverMediaService.ts";
const eventCoverMediaService = read(eventCoverMediaServicePath);
if (!eventCoverMediaService.includes("export const setEventCover")) {
  fail("C8", `${eventCoverMediaServicePath} must export setEventCover`);
} else if (!eventCoverMediaService.includes("export const clearEventCover")) {
  fail("C8", `${eventCoverMediaServicePath} must export clearEventCover`);
} else if (eventCoverMediaService.includes("updatePublishedEventCoverMedia")) {
  fail(
    "C8",
    `${eventCoverMediaServicePath} must NOT reference updatePublishedEventCoverMedia (dead literal)`,
  );
} else {
  ok("C8", "eventCoverMediaService exports setEventCover + clearEventCover; old symbol is dead");
}

const nativeVideoPath = "mingla-business/src/utils/eventCoverNativeVideo.ts";
const mediaRulesPath2 = "mingla-business/src/utils/eventCoverMediaRules.ts";
const nativeVideoText = read(nativeVideoPath);
const mediaRulesText = read(mediaRulesPath2);
const offendingFiles = [];
if (nativeVideoText.includes("30 seconds")) offendingFiles.push(nativeVideoPath);
if (mediaRulesText.includes("30 seconds")) offendingFiles.push(mediaRulesPath2);
if (offendingFiles.length > 0) {
  fail(
    "C9",
    `"30 seconds" literal must not appear in: ${offendingFiles.join(", ")}`,
  );
} else {
  ok("C9", `"30 seconds" literal is dead in eventCoverNativeVideo.ts + eventCoverMediaRules.ts`);
}

if (!uploadIntent.includes("SOURCE_CEILING_MS = 15_000")) {
  fail("C10", `${uploadIntentPath} must declare SOURCE_CEILING_MS = 15_000`);
} else if (uploadIntent.includes("EFFECTIVE_TRIM_CEILING_MS")) {
  fail("C10", `${uploadIntentPath} must not contain dead EFFECTIVE_TRIM_CEILING_MS`);
} else if (uploadIntent.includes("Math.min(rawTrimEndMs, MAX_DURATION_MS)")) {
  fail("C10", `${uploadIntentPath} must not silently clamp a mismatched trim identity`);
} else {
  ok("C10", "Upload-intent enforces one exact 15s source/trim identity");
}

if (!processingService.includes("EVENT_COVER_SOURCE_CEILING_MS = EVENT_COVER_MAX_VIDEO_DURATION_MS")) {
  fail("C11", `${processingServicePath} must keep source ceiling equal to the canonical cap`);
} else if (!coverPicker.includes("EVENT_COVER_SOURCE_CEILING_MS")) {
  fail("C11", `${coverPickerPath} must reference EVENT_COVER_SOURCE_CEILING_MS`);
} else if (coverPicker.includes("EVENT_COVER_MAX_VIDEO_DURATION_MS + 250")) {
  fail("C11", `${coverPickerPath} must not use the old +250ms duration tolerance`);
} else {
  ok("C11", "Client source and processed ceilings share the exact 15s contract");
}

const videoPickerCall = deviceMedia.match(
  /ImagePicker\.launchImageLibraryAsync\(\{\s*mediaTypes:\s*\["videos"\][\s\S]*?\n\s*\}\s*\)/,
)?.[0];
if (videoPickerCall === undefined) {
  fail("C12", `${deviceMediaPath} must keep a native video launchImageLibraryAsync call`);
} else if (videoPickerCall.includes("allowsEditing")) {
  fail("C12", `${deviceMediaPath} video picker must not pass allowsEditing`);
} else if (videoPickerCall.includes("videoMaxDuration")) {
  fail("C12", `${deviceMediaPath} video picker must not pass videoMaxDuration`);
} else if (!trimEditor.includes('from "react-native-video-trim"')) {
  fail("C12", `${trimEditorPath} must import react-native-video-trim`);
} else if (!trimEditor.includes("showEditor(uri")) {
  fail("C12", `${trimEditorPath} must call showEditor for the native trim flow`);
} else if (!trimEditor.includes("onCancelTrimming")) {
  fail("C12", `${trimEditorPath} must handle trimmer cancel`);
} else if (!coverPicker.includes("buildTrimmedVideoUploadFile")) {
  fail("C12", `${coverPickerPath} must build uploads from the trimmed outputPath`);
} else {
  ok("C12", "Dedicated trimmer is wired and ImagePicker trim knobs are absent");
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
