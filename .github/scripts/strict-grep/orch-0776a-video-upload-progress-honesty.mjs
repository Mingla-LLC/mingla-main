#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const read = (path) => readFileSync(join(root, path), "utf8");
const fail = (message) => {
  console.error(`[orch-0776a] ${message}`);
  process.exit(1);
};

const service = read("mingla-business/src/services/eventCoverVideoProcessingService.ts");
const step4 = read("mingla-business/src/components/event/CreatorStep4Cover.tsx");
const test = read(
  "mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts",
);

if (!service.includes("EventCoverVideoUploadProgress")) {
  fail("service must expose the source-upload progress event contract.");
}
if (!service.includes("createUploadTask")) {
  fail("service must use the existing Expo upload task path before processing.");
}
if (!service.includes("totalBytesSent") || !service.includes("totalBytesExpectedToSend")) {
  fail("service must derive source upload percent from actual bytes.");
}
if (!step4.includes("Uploading video... ${progress.percent}%")) {
  fail("Step 4 must render a determinate source-upload percentage.");
}
if (!step4.includes("Upload complete. Compressing browser-safe video...")) {
  fail("Step 4 must use honest provider-processing copy after upload completes.");
}
if (/Compressing[^"`']*%\b/.test(step4)) {
  fail("Step 4 must not display a fake numeric Cloudinary processing percentage.");
}
if (!test.includes("uploads source video with real byte progress")) {
  fail("service tests must lock source upload progress.");
}

console.log("[orch-0776a] video upload progress honesty guard passed");

