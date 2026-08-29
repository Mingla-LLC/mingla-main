#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const source = fs.readFileSync(
  path.join(root, "mingla-business/src/components/ui/CoverPicker.tsx"),
  "utf8",
);

const failures = [];
if (!source.includes("videoUpload.localPreviewUri")) {
  failures.push("CoverPicker must keep localPreviewUri in the preview source chain.");
}
if (!source.includes("<EventCoverMedia") || !source.includes("activeMediaUrl")) {
  failures.push("CoverPicker must mount EventCoverMedia using the active local/final source.");
}
const truthfulProjectionCopy = [
  "Making a secure copy so the upload can resume if you leave.",
  "Creating a secure, resumable upload.",
  "Uploading video",
  "The video is uploaded. Confirming it arrived safely.",
  "Processing video",
  "Reconnecting to your video…",
  "Still working in the background",
  "Applying cover…",
];
for (const copy of truthfulProjectionCopy) {
  if (!source.includes(copy)) failures.push(`Video upload UI is missing truthful state copy: ${copy}`);
}
if (source.includes("Almost ready")) {
  failures.push("Video upload UI must not restore the fabricated hardcoded processing state.");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log("OK ORCH-0978 optimistic local video preview gate");
