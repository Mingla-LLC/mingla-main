#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const read = (rel) => readFileSync(resolve(repoRoot, rel), "utf8");

const swipeable = read("app-mobile/src/components/SwipeableCards.tsx");
const deckService = read("app-mobile/src/services/deckService.ts");

const helperStart = swipeable.indexOf("const getCollabDeadEndCopy = useCallback(() => {");
const helperEnd = swipeable.indexOf("  const handleSaveDismissedCard", helperStart);
const helper = helperStart >= 0 && helperEnd > helperStart
  ? swipeable.slice(helperStart, helperEnd)
  : "";

const failures = [];
for (const reason of [
  "intersection_empty",
  "no_matching_candidates",
  "no_unswiped_candidates",
  "quorum_not_met",
  "all_pools_exhausted",
]) {
  if (!helper.includes(`case '${reason}'`)) {
    failures.push(`SwipeableCards getCollabDeadEndCopy missing dedicated branch for ${reason}`);
  }
}

for (const token of ["collabDeadEndPayload", "acceptedCount", "pendingGpsUserIds"]) {
  if (!deckService.includes(token)) {
    failures.push(`deckService collab-v2 dead-end payload missing ${token}`);
  }
}

if (failures.length > 0) {
  console.error("i-proposed-orch-0945-dead-end-reason-coverage FAILED:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("i-proposed-orch-0945-dead-end-reason-coverage PASS");
