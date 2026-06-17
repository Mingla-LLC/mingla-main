// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1155 [public-brand-page] — implementor happy-path regression for the
// consumer brand-badge wiring (no dead taps — constitution rule 1 /
// I-PROPOSED-1155-BRAND-BADGE-NOT-DEAD-TAP).
//
// app-mobile has no jest/RTL runner; the repo convention is node:assert
// source-assertions (see orch_1138_consumer_trip_brand_cover.test.ts). Every
// assertion FAILS on a true LINE-DELETION of the guard it protects
// (fails-on-revert), NOT on a comment-out. The tester writes the SECOND,
// adversarial render-angle test (curated byte-identical + press-fires-once +
// empty-slug guard) under the brand-rendering package.
//
// Run with:
//   node app-mobile/src/components/__tests__/orch_1155_brand_badge_nav.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8");

const swipeCard = read("src/components/CuratedExperienceSwipeCard.tsx");
const swipeable = read("src/components/SwipeableCards.tsx");
const detail = read("src/screens/Experience/ConsumerExperienceDetailScreen.tsx");

// 1) The swipe card accepts an optional onBrandPress and renders the badge inside
//    a pressable when it is present (the badge becomes a button, not a dead View).
assert.ok(
  swipeCard.includes("onBrandPress?: () => void;"),
  "CuratedExperienceSwipeCard must accept an optional onBrandPress prop",
);
assert.ok(
  swipeCard.includes("onBrandPress, experienceCover"),
  "onBrandPress must be destructured from props",
);
assert.ok(
  /onBrandPress\s*\?\s*\(\s*<TrackedTouchableOpacity[\s\S]*onPress=\{onBrandPress\}/.test(
    swipeCard,
  ),
  "the brand badge must be wrapped in a pressable wired to onBrandPress when present",
);

// 2) Curated regression: when onBrandPress is absent the bare BrandChip renders
//    (no pressable wrapper) — curated cards stay byte-identical (SC-12).
assert.ok(
  /\)\s*:\s*\(\s*<BrandChip/.test(swipeCard),
  "without onBrandPress the bare BrandChip must render (curated byte-identical)",
);

// 3) The swipe-deck mount wires onBrandPress to router.push('/b/'+slug) WITH an
//    empty-slug guard (rule 9 — never navigate to /b/).
assert.ok(
  swipeable.includes("const router = useRouter();"),
  "SwipeableCards must obtain an expo-router handle",
);
assert.ok(
  /onBrandPress=\{\(\) => \{[\s\S]*?brandSlug;[\s\S]*?typeof s === 'string' && s\.length > 0[\s\S]*?router\.push\(`\/b\/\$\{s\}`/.test(
    swipeable,
  ),
  "the experience mount must guard the empty slug then router.push(`/b/${slug}`)",
);

// 4) The experience-detail 'Presented by' lockup is a Pressable wired to
//    router.push('/b/'+brandSlug) with an empty-slug guard.
assert.ok(
  detail.includes("const router = useRouter();"),
  "ConsumerExperienceDetailScreen must obtain an expo-router handle",
);
assert.ok(
  /<Pressable[\s\S]*?accessibilityRole="button"[\s\S]*?seed\.brandSlug\.length > 0[\s\S]*?router\.push\(`\/b\/\$\{seed\.brandSlug\}`/.test(
    detail,
  ),
  "the 'Presented by' lockup must be a Pressable that guards the slug then opens /b/{brandSlug}",
);

console.log(
  "orch_1155_brand_badge_nav: PASS — consumer brand badges navigate to /b/{slug} (no dead taps), curated cards byte-identical, empty slug guarded.",
);
