// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1155 [public-brand-page] — implementor happy-path regression for the
// brand-card "View" affordance ALL-SURFACE parity on the three offering pages
// (event / trip / experience), buyer-web + business iOS/Android + consumer app.
//
// The device-confirmed bug (Seth): the "Presented by {Brand}" block on the
// offering pages had no visible/functional "View" affordance on every surface —
// the consumer event + trip screens rendered the brand chip as a plain <View>
// (no CTA, no navigation = a dead block).
//
// Root cause per page (proven by source):
//   - EVENT  web/business: the shared event page renders the "View" CTA only
//            when onOpenBrand is passed; the business PublicEventPage DOES pass
//            it → already working. (asserted below, fails-on-revert guarded)
//   - TRIP / EXPERIENCE web/business: TripPreview/ExperiencePreview render the
//            "View" CTA + the /t/ + /exp/ routes pass onViewBrand → working.
//   - CONSUMER event + trip: brand chip was a plain <View> (the real gap) — now
//            a Pressable that opens /b/{brandSlug} with a trailing "View" CTA.
//   - CONSUMER experience: already navigated; now also shows the "View" CTA for
//            consistency with the other two pages.
//
// app-mobile has no jest/RTL runner; the repo convention is node:assert
// source-assertions (see orch_1155_brand_badge_nav.test.ts). Every assertion
// FAILS on a true LINE-DELETION of the line it protects (fails-on-revert), NOT
// on a comment-out. The tester writes the SECOND, adversarial render-angle test.
//
// Run with:
//   node app-mobile/src/screens/__tests__/orch_1155_brand_view_affordance.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// app-mobile/src/screens/__tests__ → repo root is 5 levels up.
const repoRoot = path.join(__dirname, "..", "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const consumerTrip = read(
  "app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx",
);
const consumerEvent = read(
  "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
);
const consumerExperience = read(
  "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
);

const tripPreview = read(
  "mingla-business/src/components/trip/TripPreview.tsx",
);
const experiencePreview = read(
  "mingla-business/src/components/experience/ExperiencePreview.tsx",
);
const sharedEventPage = read("packages/offering-rendering/PublicEventPage.tsx");
const businessEventPage = read(
  "mingla-business/src/components/event/PublicEventPage.tsx",
);
const tripRoute = read(
  "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
);
const experienceRoute = read(
  "mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx",
);

// ── EVENT (web/business) — "View" CTA renders when onOpenBrand is passed ───────
assert.ok(
  /callbacks\.onOpenBrand !== undefined \?[\s\S]*?>\s*View\s*</.test(
    sharedEventPage,
  ),
  "shared event page must render the 'View' CTA when onOpenBrand is provided",
);
assert.ok(
  /onOpenBrand=\{\(slug: string\) => router\.push\(`\/b\/\$\{slug\}`/.test(
    businessEventPage,
  ),
  "business PublicEventPage must pass onOpenBrand → router.push(`/b/${slug}`)",
);

// ── TRIP (web/business) — Preview renders "View" + route passes onViewBrand ────
assert.ok(
  /onPress=\{onViewBrand\}[\s\S]*?accessibilityRole="button"/.test(tripPreview),
  "TripPreview brand chip must be a Pressable wired to onViewBrand",
);
assert.ok(
  /styles\.brandCta[\s\S]*?>\s*View\s*<\/Text>/.test(tripPreview),
  "TripPreview must render the trailing 'View' CTA text",
);
assert.ok(
  tripRoute.includes("onViewBrand={handleViewBrand}"),
  "the /t/ trip route must pass onViewBrand to TripPreview",
);
assert.ok(
  /handleViewBrand[\s\S]*?brandSlug\.length > 0[\s\S]*?router\.push\(`\/b\/\$\{brandSlug\}`/.test(
    tripRoute,
  ),
  "the /t/ route handleViewBrand must guard the slug then open /b/{brandSlug}",
);

// ── EXPERIENCE (web/business) — Preview renders "View" + route passes handler ──
assert.ok(
  /onPress=\{onViewBrand\}[\s\S]*?accessibilityRole="button"/.test(
    experiencePreview,
  ),
  "ExperiencePreview brand chip must be a Pressable wired to onViewBrand",
);
assert.ok(
  /styles\.brandCta[\s\S]*?>\s*View\s*<\/Text>/.test(experiencePreview),
  "ExperiencePreview must render the trailing 'View' CTA text",
);
assert.ok(
  experienceRoute.includes("onViewBrand={handleViewBrand}"),
  "the /exp/ experience route must pass onViewBrand to ExperiencePreview",
);

// ── CONSUMER TRIP — brand chip is now a Pressable → /b/{brandSlug} + "View" ────
assert.ok(
  consumerTrip.includes("const router = useRouter();"),
  "ConsumerTripDetailScreen must obtain an expo-router handle",
);
assert.ok(
  /<Pressable[\s\S]*?accessibilityRole="button"[\s\S]*?brandSlug\.length > 0[\s\S]*?router\.push\(`\/b\/\$\{brandSlug\}`/.test(
    consumerTrip,
  ),
  "ConsumerTripDetailScreen brand chip must be a Pressable that guards the slug then opens /b/{brandSlug}",
);
assert.ok(
  /styles\.brandCta[\s\S]*?>View<\/Text>/.test(consumerTrip),
  "ConsumerTripDetailScreen must render the trailing 'View' CTA",
);

// ── CONSUMER EVENT — brand chip is now a Pressable → /b/{brandSlug} + "View" ───
assert.ok(
  consumerEvent.includes("const router = useRouter();"),
  "ConsumerEventDetailScreen must obtain an expo-router handle",
);
assert.ok(
  /<Pressable[\s\S]*?accessibilityRole="button"[\s\S]*?fnd\.brandSlug\.length > 0[\s\S]*?router\.push\(`\/b\/\$\{fnd\.brandSlug\}`/.test(
    consumerEvent,
  ),
  "ConsumerEventDetailScreen brand chip must be a Pressable that guards the slug then opens /b/{brandSlug}",
);
assert.ok(
  /styles\.brandCta[\s\S]*?>\s*View\s*<\/Text>/.test(consumerEvent),
  "ConsumerEventDetailScreen must render the trailing 'View' CTA",
);

// ── CONSUMER EXPERIENCE — already navigates; now also shows the "View" CTA ─────
assert.ok(
  /styles\.brandCta[\s\S]*?>\s*View\s*<\/Text>/.test(consumerExperience),
  "ConsumerExperienceDetailScreen must render the trailing 'View' CTA (consistency)",
);

console.log(
  "orch_1155_brand_view_affordance: PASS — the brand-card 'View' affordance is visible + functional on event/trip/experience across web/business + all three consumer screens (no dead taps, /b/{slug} guarded).",
);
