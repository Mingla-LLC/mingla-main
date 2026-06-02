#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1042 [home-deck-black-card-swipe] structural regression.
 *
 * The bug: the Home/solo (and collab) deck card hero rendered a bare react-native
 * <Image source={{uri}}> over a dark `#1a1a2e` container with NO placeholder, NO
 * fade transition, and NO managed decoded-bitmap cache; combined with the
 * `key={currentRec.id}` per-card remount (ORCH-0694), every swipe forced a
 * from-scratch async decode and the dark container showed through as a "black"
 * card until the decode landed. The curated multi-stop card was worse — it had no
 * onError fallback at all, so a slow/failed stop image stayed a dark panel forever.
 *
 * The fix: render both deck heroes via expo-image with the LOCKED prop set
 * (placeholder + non-zero transition + cachePolicy="memory-disk" + recyclingKey +
 * contentFit="cover" + placeholderContentFit + onError fallback), repoint the
 * next-2-cards prefetch warm-up to ExpoImage.prefetch so it warms the SAME cache,
 * and KEEP `key={currentRec.id}` byte-identical (it fixes the ORCH-0694 ghost-card
 * class — the new fix works WITH the remount, not by removing it).
 *
 * This check locks that contract. It FAILS on revert (proven: a revert to the bare
 * react-native <Image> trips G-01/G-02/G-03/G-07/G-08) and PASSES on the fix.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const swipeable = read("app-mobile/src/components/SwipeableCards.tsx");
const curated = read("app-mobile/src/components/CuratedExperienceSwipeCard.tsx");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

// Isolate the CardHeroImage body so prop assertions can't be satisfied by
// unrelated expo-image usage elsewhere in the (large) file.
const heroStart = swipeable.indexOf("function CardHeroImage(");
const heroEnd = heroStart >= 0 ? swipeable.indexOf("\n}", heroStart) : -1;
const heroBody =
  heroStart >= 0 && heroEnd > heroStart ? swipeable.slice(heroStart, heroEnd) : "";

// Isolate the CuratedStopImage body in the curated card.
const stopStart = curated.indexOf("function CuratedStopImage(");
const stopEnd = stopStart >= 0 ? curated.indexOf("\n}", stopStart) : -1;
const stopBody =
  stopStart >= 0 && stopEnd > stopStart ? curated.slice(stopStart, stopEnd) : "";

// ---- SwipeableCards: front + next-preview hero (CardHeroImage) ----

check(
  "G-01 SwipeableCards imports expo-image as ExpoImage (aliased, no RN Image collision)",
  /import\s*\{\s*Image\s+as\s+ExpoImage\s*\}\s*from\s*["']expo-image["']/.test(swipeable),
  "SwipeableCards.tsx must import { Image as ExpoImage } from 'expo-image' for the deck hero.",
);

check(
  "G-02 react-native Image import is removed (no bare RN <Image> hero anymore)",
  !/import\s*\{[^}]*\bImage\b[^}]*\}\s*from\s*["']react-native["']/s.test(swipeable),
  "react-native's Image must no longer be imported into SwipeableCards — the hero + prefetch now use expo-image.",
);

check(
  "G-03 CardHeroImage renders <ExpoImage> with the LOCKED prop set",
  heroBody.includes("<ExpoImage") &&
    /contentFit=["']cover["']/.test(heroBody) &&
    /cachePolicy=["']memory-disk["']/.test(heroBody) &&
    /recyclingKey=\{src\}/.test(heroBody) &&
    /transition=\{[^}]+\}/.test(heroBody) &&
    /placeholder=\{/.test(heroBody) &&
    /placeholderContentFit=["']cover["']/.test(heroBody) &&
    heroBody.includes("onError"),
  "CardHeroImage must render <ExpoImage> with source, contentFit='cover', cachePolicy='memory-disk', recyclingKey={src}, a non-zero transition, a placeholder, placeholderContentFit='cover', and an onError fallback.",
);

check(
  "G-04 CardHeroImage transition is a non-zero numeric constant in the 180–300 ms band",
  (() => {
    const m = heroBody.match(/transition=\{([A-Za-z0-9_]+)\}/);
    if (!m) return false;
    const token = m[1];
    const constRe = new RegExp(`const\\s+${token}\\s*=\\s*(\\d+)`);
    const cm = swipeable.match(constRe);
    if (!cm) return false;
    const ms = Number(cm[1]);
    return ms >= 180 && ms <= 300;
  })(),
  "The hero fade transition must be a non-zero numeric constant within 180–300 ms (never 0 — a 0 transition reintroduces the hard black→photo cut).",
);

check(
  "G-05 CardHeroImage keeps the CARD_FALLBACK_IMAGE onError fallback",
  /onError=\{\(\)\s*=>\s*\{[\s\S]*?CARD_FALLBACK_IMAGE/.test(heroBody),
  "The front-card Unsplash hard-failure fallback (onError -> CARD_FALLBACK_IMAGE) must survive the expo-image migration.",
);

check(
  "G-06 prefetch warm-up is repointed to ExpoImage.prefetch with memory-disk cache",
  /ExpoImage\.prefetch\([^)]*cachePolicy:\s*['"]memory-disk['"]/.test(swipeable) &&
    !/\bImage\.prefetch\(/.test(swipeable),
  "The next-2-cards prefetch effect must call ExpoImage.prefetch(url, { cachePolicy: 'memory-disk' }) (warming the SAME cache the hero reads) and must no longer call react-native Image.prefetch.",
);

check(
  "G-07 key={currentRec.id} per-card remount (ORCH-0694) is preserved",
  /key=\{currentRec\.id\}/.test(swipeable),
  "key={currentRec.id} on the front-card Animated.View must stay — it fixes the ORCH-0694 ghost-card class; the hero fix works WITH the remount.",
);

// ---- CuratedExperienceSwipeCard: multi-stop hero (CuratedStopImage) ----

check(
  "G-08 CuratedExperienceSwipeCard imports expo-image and dropped react-native Image",
  /import\s*\{\s*Image\s+as\s+ExpoImage\s*\}\s*from\s*['"]expo-image['"]/.test(curated) &&
    !/import\s*\{[^}]*\bImage\b[^}]*\}\s*from\s*['"]react-native['"]/s.test(curated),
  "CuratedExperienceSwipeCard.tsx must import { Image as ExpoImage } from 'expo-image' and no longer import Image from react-native.",
);

check(
  "G-09 CuratedStopImage renders <ExpoImage> with the LOCKED prop set + onError fallback (the hidden-flaw fix)",
  stopBody.includes("<ExpoImage") &&
    /contentFit=["']cover["']/.test(stopBody) &&
    /cachePolicy=["']memory-disk["']/.test(stopBody) &&
    /recyclingKey=\{src\}/.test(stopBody) &&
    /transition=\{[^}]+\}/.test(stopBody) &&
    /placeholder=\{/.test(stopBody) &&
    /placeholderContentFit=["']cover["']/.test(stopBody) &&
    /onError=\{\(\)\s*=>\s*\{[\s\S]*?CARD_FALLBACK_IMAGE/.test(stopBody),
  "CuratedStopImage must render <ExpoImage> with the same prop contract AND a NEW onError -> CARD_FALLBACK_IMAGE fallback (this path previously had none).",
);

check(
  "G-10 curated card reuses the shared fallback + placeholder constants (one source of truth)",
  /import\s*\{[^}]*CARD_FALLBACK_IMAGE[^}]*DECK_HERO_PLACEHOLDER_BLURHASH[^}]*\}\s*from\s*['"]\.\/SwipeableCards['"]/s.test(curated),
  "CuratedExperienceSwipeCard must import CARD_FALLBACK_IMAGE + DECK_HERO_PLACEHOLDER_BLURHASH from ./SwipeableCards — not duplicate the literals.",
);

check(
  "G-11 curated empty-URL branch still renders the non-photo placeholder View (Constitution #9 — no fabricated photo)",
  curated.includes("styles.imagePlaceholder") &&
    /stop\.imageUrl\s*\?\s*\([\s\S]*?CuratedStopImage[\s\S]*?\)\s*:\s*\(\s*<View style=\{\[styles\.stopImage, styles\.imagePlaceholder\]\}/.test(curated),
  "A genuinely image-less stop (imageUrl null/empty) must still render the non-photo placeholder View — no broken-image icon, no fabricated photo.",
);

const failures = checks.filter((item) => !item.pass);
for (const item of checks) {
  console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
  if (!item.pass) console.log(`  ${item.detail}`);
}

if (failures.length > 0) {
  console.error(
    `ORCH-1042 deck-hero placeholder regression failed: ${failures.length}/${checks.length}`,
  );
  process.exit(1);
}

console.log("ORCH-1042 deck-hero placeholder regression passed.");
