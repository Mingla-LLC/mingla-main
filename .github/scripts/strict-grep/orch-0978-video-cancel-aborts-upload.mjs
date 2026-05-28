#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const hook = fs.readFileSync(
  path.join(root, "mingla-business/src/hooks/useEventCoverVideoUpload.ts"),
  "utf8",
);
const service = fs.readFileSync(
  path.join(root, "mingla-business/src/services/eventCoverVideoProcessingService.ts"),
  "utf8",
);
const cancelEdge = fs.readFileSync(
  path.join(root, "supabase/functions/event-cover-video-cancel/index.ts"),
  "utf8",
);

const failures = [];
if (!/uploadAbortController\?\.abort\(\)[\s\S]*supabase\.functions\.invoke<StatusResponse>\(\s*"event-cover-video-cancel"/.test(service)) {
  failures.push("cancelEventCoverVideoJob must abort the upload controller before invoking the cancel edge function.");
}
if (!/uploadAbortController\?\.abort\(\)[\s\S]*cancelEventCoverVideoJob\(\{/.test(hook)) {
  failures.push("useEventCoverVideoUpload.cancel must abort before calling cancelEventCoverVideoJob.");
}
if (!cancelEdge.includes("cloudinaryDestroy") || !cancelEdge.includes("source_public_id")) {
  failures.push("event-cover-video-cancel must use source_public_id and call Cloudinary destroy.");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log("OK ORCH-0978 cancel aborts upload and destroys Cloudinary source gate");
