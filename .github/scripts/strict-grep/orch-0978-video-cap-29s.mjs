#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
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

const coverPickerPath = "mingla-business/src/components/ui/CoverPicker.tsx";
const processingServicePath =
  "mingla-business/src/services/eventCoverVideoProcessingService.ts";
const mediaRulesPath = "mingla-business/src/utils/eventCoverMediaRules.ts";
const migrationPath =
  "supabase/migrations/20260730000000_orch_0978_video_cap_29s_constraints.sql";

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

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
