#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const read = (relPath) => {
  const absPath = path.join(repoRoot, relPath);
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch (error) {
    console.error(`ORCH-0766F ERROR: could not read ${relPath}: ${error.message}`);
    process.exit(2);
  }
};

const migrationRelPath =
  "supabase/migrations/20260515000010_orch_0766f_event_cover_quicktime_mime.sql";
const migration = read(migrationRelPath);
const mediaRules = read("mingla-business/src/utils/eventCoverMediaRules.ts");
const serviceTest = read(
  "mingla-business/src/services/__tests__/eventCoverMediaService.test.ts",
);

const violations = [];

const requireIncludes = (relPath, source, signatures) => {
  for (const [signature, message] of signatures) {
    if (!source.includes(signature)) {
      violations.push(`${relPath}: missing ${signature} :: ${message}`);
    }
  }
};

requireIncludes(migrationRelPath, migration, [
  ["UPDATE storage.buckets", "migration must update the existing bucket"],
  ["WHERE id = 'event_covers'", "migration must target event_covers only"],
  ["video/quicktime", "bucket must allow iPhone MOV/QuickTime uploads"],
  ["video/mp4", "bucket must preserve MP4 upload support"],
  ["video/webm", "bucket must preserve WebM upload support"],
  ["image/jpeg", "bucket must preserve JPEG upload support"],
  ["image/png", "bucket must preserve PNG upload support"],
  ["image/webp", "bucket must preserve WebP upload support"],
  ["image/gif", "bucket must preserve GIF upload support"],
  ["file_size_limit = 31457280", "bucket must preserve the 30 MB limit"],
  ["public = true", "bucket must remain public for cover rendering"],
  ["SELECT DISTINCT mime", "migration must be idempotent and deduplicate MIME entries"],
]);

requireIncludes("mingla-business/src/utils/eventCoverMediaRules.ts", mediaRules, [
  ['mov: "video/quicktime"', "app rules must classify .mov as QuickTime"],
  ['"video/quicktime": "mov"', "app rules must store QuickTime with .mov extension"],
  ['mime === "video/quicktime"', "app rules must accept video/quicktime"],
]);

requireIncludes(
  "mingla-business/src/services/__tests__/eventCoverMediaService.test.ts",
  serviceTest,
  [
    [
      "uploads short iOS MOV videos with QuickTime content type",
      "service test must prove short MOV upload contract",
    ],
    [
      "keeps 15-second enforcement for iOS MOV videos before upload",
      "service test must prove over-limit MOV is rejected before upload",
    ],
    [
      'contentType: "video/quicktime"',
      "service test must assert QuickTime upload content type",
    ],
  ],
);

if (violations.length > 0) {
  console.error(
    "ORCH-0766F violation: event-cover MOV support and storage MIME contract drifted.",
  );
  for (const violation of violations) {
    console.error(violation);
  }
  process.exit(1);
}

console.log(
  "ORCH-0766F PASS: event-cover QuickTime storage MIME guard passed.",
);
