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
// #3040 (2026-10-19) — lane calls go through invokeLaneFunction (laneEdgeInvoke.ts),
// which never waits on the auth lock; the abort-before-invoke order is unchanged.
if (!/uploadAbortController\?\.abort\(\)[\s\S]*(?:supabase\.functions\.invoke|invokeLaneFunction)<StatusResponse>\(\s*"event-cover-video-cancel"/.test(service)) {
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
// #3040 rework (P1-1): the cancel still reclaims the source asset by its id,
// but ONLY through the live-reference guard destroyIfUnreferenced — a direct
// destroyCoverVideoAsset call is now forbidden everywhere outside the guard
// (I-VIDEO-SINGLE-GUARDED-DELETE, coverVideoReap.singleDeletePath suite).
if (!/destroyIfUnreferenced\(/.test(cancelEdge) || !/source_asset_id/.test(cancelEdge)) {
  failures.push("event-cover-video-cancel must reclaim the source asset through the guarded destroyIfUnreferenced using its source id (source_asset_id).");
}
if (/(?<!function\s)\bdestroyCoverVideoAsset\s*\(/.test(cancelEdge.replace(/\/\/.*$/gm, ""))) {
  failures.push("event-cover-video-cancel must not call destroyCoverVideoAsset directly (#3040: every delete is guarded).");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log("OK ORCH-0978 cancel aborts upload and destroys Cloudinary source gate");
