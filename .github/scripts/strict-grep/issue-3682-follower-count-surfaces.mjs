#!/usr/bin/env node

// #3682 — one formatter, explicit follower-count surfaces, and a hard ban on
// leaking follower counts into discovery, swipe, activity, ticket/pass, or chat
// UI. Structural wiring is checked here; formatter/service/DB behaviour is
// exercised by the issue's Jest and pg17 suites.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCE_EXT = /\.(?:js|jsx|ts|tsx)$/;
const TEST_PATH = /(?:^|\/)__tests__(?:\/|$)|\.(?:test|spec)\./;
const FORMATTER_OWNER = "packages/offering-rendering/followerCount.ts";
const FORBIDDEN_TOKENS = [
  "useBrandFollowerCount",
  "useBrandFollowerCounts",
  "FollowerCountLine",
  "formatFollowerCount",
  "formatCompactCount",
  "followerCount",
];
const FORBIDDEN_DIRS = [
  "app-mobile/src/components/discover",
  "app-mobile/src/components/swipeDeck",
  "app-mobile/src/components/activity",
  "app-mobile/src/components/chat",
];
const FORBIDDEN_FILES = [
  "app-mobile/src/components/SwipeableCards.tsx",
  "app-mobile/src/components/deckCardPlate.tsx",
  "app-mobile/src/components/CuratedExperienceSwipeCard.tsx",
];

// Ticket/pass production paths confirmed on origin/main when this gate landed:
// app-mobile activity/expandedCard pass+ticket files; business checkout,
// event, guests and ticketLinks files. Matching the path keeps later files in
// those categories protected without weakening the inventory.
const COMPONENT_ROOTS = [
  "app-mobile/src/components",
  "mingla-business/src/components",
];
const FORMAT_SCAN_ROOTS = [
  "packages",
  "app-mobile/src",
  "mingla-business/src",
  "mingla-business/app",
];
const WIRING = [
  ["app-mobile/src/screens/ConsumerBrandProfileScreen.tsx", "followerCountLoading="],
  ["mingla-business/src/components/brand/PublicBrandPage.tsx", "followerCountLoading="],
  ["packages/offering-rendering/EventOfferingBody.tsx", "<PresentedByFollowerCount"],
  ["packages/offering-rendering/RsvpOfferingBody.tsx", "<PresentedByFollowerCount"],
  ["packages/offering-rendering/TripOfferingBody.tsx", "<PresentedByFollowerCount"],
  ["packages/offering-rendering/ExperienceOfferingBody.tsx", "<PresentedByFollowerCount"],
  ["packages/offering-rendering/PresentedByFollowerCount.tsx", "<LazyFollowerCountLine"],
  ["packages/offering-rendering/TripOfferingBody.tsx", "presentedByFollow"],
  ["packages/offering-rendering/ExperienceOfferingBody.tsx", "presentedByFollow"],
];

function walk(root, relDir, violations) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, relDir), { withFileTypes: true });
  } catch (error) {
    violations.push(`${relDir}: could not inspect (${error.message})`);
    return [];
  }
  return entries.flatMap((entry) => {
    const relPath = path.join(relDir, entry.name);
    if (entry.isDirectory()) return walk(root, relPath, violations);
    return SOURCE_EXT.test(entry.name) && !TEST_PATH.test(relPath) ? [relPath] : [];
  });
}

function verify(root, overrides = new Map()) {
  const violations = [];
  const read = (relPath) => {
    if (overrides.has(relPath)) return overrides.get(relPath);
    try {
      return fs.readFileSync(path.join(root, relPath), "utf8");
    } catch (error) {
      violations.push(`${relPath}: could not read (${error.message})`);
      return "";
    }
  };

  const formatFiles = FORMAT_SCAN_ROOTS.flatMap((dir) => walk(root, dir, violations));
  for (const relPath of formatFiles) {
    const source = read(relPath);
    if (relPath !== FORMATTER_OWNER && /\b(?:function|const)\s+format\w*Follower\b/.test(source)) {
      violations.push(`${relPath}: defines a follower formatter outside ${FORMATTER_OWNER}`);
    }
    const templates = source.match(/`(?:\\.|[^`])*`/gs) ?? [];
    for (const template of templates) {
      if (/followers?/i.test(template) && (/(?:\/|\*)\s*1_?000\b/.test(template) || /toFixed\s*\(/.test(template))) {
        violations.push(`${relPath}: contains retired inline follower compaction`);
        break;
      }
    }
  }

  const forbiddenPaths = new Set([
    ...FORBIDDEN_DIRS.flatMap((dir) => walk(root, dir, violations)),
    ...FORBIDDEN_FILES,
    ...COMPONENT_ROOTS.flatMap((dir) => walk(root, dir, violations)).filter((relPath) =>
      /ticket|pass/i.test(relPath),
    ),
  ]);
  for (const relPath of forbiddenPaths) {
    const source = read(relPath);
    for (const token of FORBIDDEN_TOKENS) {
      if (source.includes(token)) violations.push(`${relPath}: forbidden follower token ${token}`);
    }
  }

  for (const [relPath, signature] of WIRING) {
    if (!read(relPath).includes(signature)) {
      violations.push(`${relPath}: missing required wiring ${signature}`);
    }
  }
  const tripAdapterPath = "app-mobile/src/hooks/useConsumerTripOfferingData.ts";
  const tripAdapter = read(tripAdapterPath);
  const tripDataStart = tripAdapter.indexOf("export function buildConsumerTripOfferingData");
  const tripBrandStart = tripAdapter.indexOf("export function buildConsumerTripOfferingBrand");
  if (
    tripDataStart < 0 ||
    tripBrandStart <= tripDataStart ||
    !tripAdapter.slice(tripDataStart, tripBrandStart).includes("id: detail.tripId") ||
    !tripAdapter.slice(tripBrandStart).includes("id: detail.brandId")
  ) {
    violations.push(`${tripAdapterPath}: trip and Presented-by brand identities are crossed`);
  }
  return violations;
}

function runSelfTest() {
  const control = verify(REPO_ROOT);
  if (control.length > 0) throw new Error(`real-tree control failed: ${control.join("; ")}`);
  const cases = [
    [
      "Discover leak",
      "app-mobile/src/components/SwipeableCards.tsx",
      (source) => `${source}\nconst followerCount = 3;`,
    ],
    [
      "inline formatter",
      "app-mobile/src/services/brandFollowerCountService.ts",
      (source) => source + '\nconst fakeFollower = `${n / 1000} followers`;',
    ],
    [
      "missing body wiring",
      "packages/offering-rendering/EventOfferingBody.tsx",
      (source) => source.replace("<PresentedByFollowerCount", "<Text"),
    ],
    [
      "crossed trip identity",
      "app-mobile/src/hooks/useConsumerTripOfferingData.ts",
      (source) => source
        .replace("id: detail.tripId", "id: detail.__swap")
        .replace("id: detail.brandId", "id: detail.tripId")
        .replace("id: detail.__swap", "id: detail.brandId"),
    ],
  ];
  for (const [label, relPath, mutate] of cases) {
    const source = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
    const failures = verify(REPO_ROOT, new Map([[relPath, mutate(source)]]));
    if (failures.length === 0) throw new Error(`${label} mutation was not detected`);
  }
  console.log("issue-3682 follower surfaces SELF-TEST PASS: leak, formatter, body wiring, and trip identity mutations detected.");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const violations = verify(REPO_ROOT);
  if (violations.length > 0) {
    console.error("issue-3682 follower-count surface invariant failed:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  console.log("issue-3682 follower surfaces PASS: one formatter, allowed surfaces only, wiring present.");
}
