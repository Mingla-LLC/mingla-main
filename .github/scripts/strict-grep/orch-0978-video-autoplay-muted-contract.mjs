#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const eventCoverMedia = fs.readFileSync(
  path.join(root, "packages/event-rendering/EventCoverMedia.tsx"),
  "utf8",
);
const packageIndex = fs.readFileSync(
  path.join(root, "packages/event-rendering/index.ts"),
  "utf8",
);

const failures = [];
if (!/muted = true/.test(eventCoverMedia)) {
  failures.push("EventCoverMedia must default muted to true.");
}
if (!eventCoverMedia.includes("playsInline") || !eventCoverMedia.includes("autoPlay: shouldPlay")) {
  failures.push("EventCoverMedia web branch must keep muted autoplay inline playback primitives.");
}
if (!eventCoverMedia.includes("setIsMuted((prev)") || !eventCoverMedia.includes("accessibilityRole=\"button\"")) {
  failures.push("Unmute must be a user-gesture Pressable, not an automatic prop flip.");
}
if (!packageIndex.includes("EventCoverMedia")) {
  failures.push("@mingla/event-rendering must export the shared EventCoverMedia contract.");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log("OK ORCH-0978 autoplay muted contract gate");
