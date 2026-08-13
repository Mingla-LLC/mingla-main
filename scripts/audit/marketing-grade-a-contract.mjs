#!/usr/bin/env node
/**
 * #426 PR7 — Grade A contract for organizer Marketing surfaces.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MARKETING = join(ROOT, "mingla-business/app/(tabs)/marketing");

const ROUTES = [
  {
    file: "index.tsx",
    mustInclude: [
      "useMarketingOverview",
      "hasResolved",
      "Couldn't load metrics",
      "overview-skeleton",
    ],
    label: "overview",
  },
  {
    file: "audiences/index.tsx",
    mustInclude: [
      'import { Redirect } from "expo-router"',
      '<Redirect href="/(tabs)/marketing/people"',
    ],
    mustExclude: ["useAudienceList", "AudienceListScreen"],
    label: "legacy-audiences-redirect",
  },
  {
    file: "mingla-business/src/components/people/PeoplePage.tsx",
    rootRelative: true,
    mustInclude: [
      "useBrandPeople",
      'book.kind==="forbidden"',
      'book.kind==="offlineEmpty"',
      'book.kind==="error"',
      "No one is in your book yet.",
      "useAudienceList",
      "groups.isError",
      "people-groups-skeleton",
    ],
    label: "people",
  },
  {
    file: "campaigns/index.tsx",
    mustInclude: [
      "useCampaigns",
      "hasResolved",
      "Couldn't load campaigns",
      "campaigns-spinner",
      "Your first campaign starts here",
    ],
    label: "campaigns",
  },
  {
    file: "templates/index.tsx",
    mustInclude: [
      "useStarterTemplates",
      "Couldn't load templates",
      "ActivityIndicator",
    ],
    label: "templates",
  },
  {
    file: "_layout.tsx",
    mustInclude: ["MarketingSubNav", "hideUniversalPlus"],
    label: "layout",
  },
];

const REQUIRED_EXTERNAL = [
  "docs/evidence/grade-a-marketing.md",
  "docs/load-profile.md",
  "mingla-business/app/(tabs)/marketing/__tests__/MarketingOverview.disabled-query.test.ts",
  "mingla-business/app/(tabs)/marketing/__tests__/MarketingAudiences.disabled-query.adversarial.test.ts",
  "mingla-business/src/services/marketing/__tests__/marketingOverviewService.test.ts",
  "supabase/functions/marketing-send/index.test.ts",
  ".github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs",
];

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

for (const rel of REQUIRED_EXTERNAL) {
  if (!existsSync(join(ROOT, rel))) fail(`missing ${rel}`);
}

for (const route of ROUTES) {
  const path = join(route.rootRelative ? ROOT : MARKETING, route.file);
  if (!existsSync(path)) fail(`missing marketing route ${route.file}`);
  const text = readFileSync(path, "utf8");
  for (const snippet of route.mustInclude) {
    if (!text.includes(snippet)) {
      fail(`${route.label} (${route.file}) missing required marker: ${snippet}`);
    }
  }
  for (const snippet of route.mustExclude ?? []) {
    if (text.includes(snippet)) {
      fail(`${route.label} (${route.file}) contains retired marker: ${snippet}`);
    }
  }
}

const evidence = readFileSync(
  join(ROOT, "docs/evidence/grade-a-marketing.md"),
  "utf8",
);
if (
  !evidence.includes("marketing-send.js") ||
  !evidence.includes("test:orch-432")
) {
  fail("grade-a-marketing.md must reference marketing-send.js and test:orch-432");
}

console.log("PASS: marketing Grade A contract (legacy redirect + 5 owned surfaces + evidence)");
process.exit(0);
