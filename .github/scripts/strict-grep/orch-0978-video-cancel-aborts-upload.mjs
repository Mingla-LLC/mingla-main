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
if (!/abortRef\.current\?\.abort\(\)[\s\S]*cancelEventCoverVideoJob\(jobIdRef\.current\)/.test(hook)) {
  failures.push("useEventCoverVideoUpload.cancel must abort before calling cancelEventCoverVideoJob.");
}
// META-ORCH-1270: cancel now destroys the source via the provider-agnostic
// destroyCoverVideoAsset (routes to Cloudinary destroy OR Bunny delete by the
// job's source_public_id / source_asset_id). The behavioral guarantee is
// UNCHANGED — cancel still destroys the source asset using its source id — the
// mechanism was generalized off the Cloudinary-only cloudinaryDestroy call.
if (!/destroyCoverVideoAsset|cloudinaryDestroy/.test(cancelEdge) || !/source_public_id|source_asset_id/.test(cancelEdge)) {
  failures.push("event-cover-video-cancel must destroy the source asset (provider-agnostic destroyCoverVideoAsset) using its source id (source_public_id / source_asset_id).");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log("OK ORCH-0978 cancel aborts upload and destroys Cloudinary source gate");
