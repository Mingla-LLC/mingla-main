#!/usr/bin/env node
/**
 * #426 PR6 — Grade A contract for organizer Hub surfaces.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HUB = join(ROOT, "mingla-business/app/(tabs)/hub");

const ROUTES = [
  {
    file: "events.tsx",
    mustInclude: [
      "useBusinessEventsForBrand",
      "Nothing created yet",
      "emptyTitle",
      "errorMessage={deleteDraftError}",
    ],
    label: "events",
  },
  {
    file: "trips.tsx",
    mustInclude: ["tripsQuery.isLoading", "tripsQuery.isError", "ActivityIndicator"],
    label: "trips",
  },
  {
    file: "experiences.tsx",
    mustInclude: [
      "experiencesQuery.isLoading",
      "emptyListHint",
      "ActivityIndicator",
    ],
    label: "experiences",
  },
  {
    file: "_layout.tsx",
    mustInclude: ["visibleTabs.isLoading", "HubSubNav"],
    label: "layout",
  },
];

const REQUIRED_EXTERNAL = [
  "docs/evidence/grade-a-hub.md",
  "mingla-business/app/(tabs)/hub/__tests__/events.pastTab.test.tsx",
  "mingla-business/maestro/tr2-events-tab-no-trip-leak.yaml",
  "scripts/load/discover-merged-events.js",
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

for (const rel of REQUIRED_EXTERNAL) {
  if (!existsSync(join(ROOT, rel))) fail(`missing ${rel}`);
}

for (const route of ROUTES) {
  const path = join(HUB, route.file);
  if (!existsSync(path)) fail(`missing hub route ${route.file}`);
  const text = readFileSync(path, "utf8");
  for (const snippet of route.mustInclude) {
    if (!text.includes(snippet)) {
      fail(`${route.label} (${route.file}) missing required marker: ${snippet}`);
    }
  }
}

const evidence = readFileSync(join(ROOT, "docs/evidence/grade-a-hub.md"), "utf8");
if (!evidence.includes("discover-merged-events") || !evidence.includes("test:orch-431")) {
  fail("grade-a-hub.md must reference discover load script and test:orch-431");
}

console.log("PASS: hub Grade A contract (4 hub routes + evidence)");
process.exit(0);
