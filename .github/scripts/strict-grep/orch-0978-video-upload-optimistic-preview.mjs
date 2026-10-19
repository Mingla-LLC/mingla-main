#!/usr/bin/env node
// ORCH-0978 — optimistic local video preview + truthful upload state copy.
//
// Issue #3040 moved the upload card's copy out of CoverPicker.tsx into the
// pure model `coverUploadCardModel.ts` and replaced it with the approved
// design copy (Appendix A, states H-04…H-12). The protective intent is
// unchanged: the sheet previews the local clip while it uploads, every phase
// has its own truthful title, "Confirming upload" is only ever the
// all-bytes-confirmed phase, and no fabricated "Almost ready" state returns.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const source = read("mingla-business/src/components/ui/CoverPicker.tsx");
const model = stripComments(read("mingla-business/src/components/ui/coverUploadCardModel.ts"));

const failures = [];
if (!source.includes("videoUpload.localPreviewUri")) {
  failures.push("CoverPicker must keep localPreviewUri in the preview source chain.");
}
if (!source.includes("<EventCoverMedia") || !source.includes("activeMediaUrl")) {
  failures.push("CoverPicker must mount EventCoverMedia using the active local/final source.");
}
if (!source.includes("coverUploadCardModel")) {
  failures.push("CoverPicker must render the upload card from the pure coverUploadCardModel.");
}
// One truthful title (and the key promise) per pipeline phase, design H-04…H-12.
const truthfulProjectionCopy = [
  "Optimizing video",
  "Checking file",
  "Securing a copy so the upload can pick up where it left off.",
  "Starting upload",
  "Uploading",
  "Confirming upload",
  "Making sure every byte arrived safely.",
  "Preparing at Mingla",
  "your current cover stays until the new one is ready",
  "Taking longer than usual",
  "Upload paused",
  "Upload interrupted",
  "Choose the video again",
  "Reconnecting to your video…",
  "Applying cover…",
];
for (const copy of truthfulProjectionCopy) {
  if (!model.includes(copy)) failures.push(`Video upload UI is missing truthful state copy: ${copy}`);
}
// T3 — "Confirming upload" belongs to the ack_pending phase only.
const ackBlock = model.match(/case\s+"ack_pending"[\s\S]*?case\s+"processing"/)?.[0] ?? "";
if (!ackBlock.includes('title: "Confirming upload"') || model.split("Confirming upload").length !== 2) {
  failures.push('"Confirming upload" must be the title of the ack_pending phase and of no other phase (design T3).');
}
if (source.includes("Almost ready") || model.includes("Almost ready")) {
  failures.push("Video upload UI must not restore the fabricated hardcoded processing state.");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log("OK ORCH-0978 optimistic local video preview gate");
