#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1042 [home-deck-black-card-swipe] — TESTER ADVERSARIAL regression.
 *
 * DISTINCT ANGLE from the implementor's happy-path structural gate
 * (`orch-1042-deck-hero-placeholder-check.mjs`). The implementor's gate proves
 * the right COMPONENTS / PROPS / IMPORTS are present (structure). This gate
 * attacks the RUNTIME / BEHAVIORAL invariants that a structural prop-grep
 * cannot see — the failure modes that survive a prop-complete migration:
 *
 *   A-01  onError fallback must be LOOP-SAFE in BOTH paths. If the CARD_FALLBACK_IMAGE
 *         itself hard-fails (404 Unsplash), an unguarded `onError={() => setSrc(FALLBACK)}`
 *         re-fires forever → render thrash / pegged CPU / the black panel never clears.
 *         The `if (src !== CARD_FALLBACK_IMAGE)` guard is the difference between
 *         "fallback engages once" and "infinite onError storm". The happy-path gate's
 *         G-05/G-09 only check that the FALLBACK URL string appears in the handler —
 *         it does NOT prove the loop-guard exists.
 *
 *   A-02  The placeholder must NOT be one of the OLD bare-dark-panel colors. The entire
 *         bug is "a near-black `#1a1a2e`/`#1C1C1E`/`#2C2C2E` panel shows during decode".
 *         A regression that wired `placeholder={{ uri: '#1a1a2e' }}` or a blank/empty
 *         placeholder string would pass the structural `placeholder=\{/` grep yet
 *         reintroduce the exact symptom. Assert the blurhash constant is a real,
 *         non-empty, non-hex, non-color-literal string and that NONE of the three old
 *         panel hexes is used as a placeholder source.
 *
 *   A-03  The fade transition must be NON-ZERO at the RESOLVED numeric value in BOTH
 *         files. The happy-path gate band-checks only the hero token (G-04). A
 *         `transition={0}` (or a 0-valued curated constant) reintroduces the hard
 *         black->photo cut. Assert both resolved constants are integers in (0, 1000].
 *
 *   A-04  recyclingKey must be wired to the MUTABLE `src` state (the value that flips
 *         to the fallback on error / resyncs on the `uri` prop), NOT to a static prop.
 *         If recyclingKey were `={uri}` (the immutable prop) instead of `={src}`, an
 *         onError fallback swap would keep the recycled view showing the failed frame
 *         (the cache key never changes) → the panel never repaints to the fallback.
 *         Assert recyclingKey={src} AND that `src` is a useState resynced by a
 *         useEffect on the source prop in BOTH components.
 *
 *   A-05  The curated empty/null guard-chain must keep an empty-STRING out of the photo
 *         component. CuratedStopImage does `useState(uri)` with NO length guard (unlike
 *         CardHeroImage's `uri && uri.length > 0`), so it relies ENTIRELY on the parent
 *         ternary `stop.imageUrl ? <CuratedStopImage/> : <placeholder View/>` (JS falsy
 *         "" → placeholder). If a future edit loosened that to `stop.imageUrl != null`,
 *         an empty string would reach CuratedStopImage and request `{uri:""}` → a broken
 *         decode = the dark panel returns. Lock the truthiness guard (NOT `!= null` /
 *         `!== null` / `.length` on the parent branch).
 *
 *   A-06  No bare react-native <Image source={{ uri ... }}> may render a deck hero in
 *         EITHER file (defense-in-depth beyond the import-removal grep): assert the JSX
 *         `<Image ` photo tag is gone from both, so a re-added `import {Image}` +
 *         `<Image>` can't silently restore the bug under a still-present ExpoImage import.
 *
 * Runs with plain `node` (no jest harness in this project — same convention as the
 * implementor gate and the other `scripts/ci/*.mjs` checks). FAILS on revert.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

const swipeable = read("app-mobile/src/components/SwipeableCards.tsx");
const curated = read("app-mobile/src/components/CuratedExperienceSwipeCard.tsx");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

// Isolate the two image sub-component bodies.
const sliceFn = (src, signature) => {
  const start = src.indexOf(signature);
  if (start < 0) return "";
  const end = src.indexOf("\n}", start);
  return end > start ? src.slice(start, end) : "";
};
const heroBody = sliceFn(swipeable, "function CardHeroImage(");
const stopBody = sliceFn(curated, "function CuratedStopImage(");

const OLD_PANEL_HEXES = ["#1a1a2e", "#1A1A2E", "#1c1c1e", "#1C1C1E", "#2c2c2e", "#2C2C2E"];

// Resolve a `transition={TOKEN}` to its numeric const value within a file.
const resolveTransitionMs = (fileSrc, body) => {
  const m = body.match(/transition=\{([A-Za-z0-9_]+)\}/);
  if (!m) return null;
  const tok = m[1];
  if (/^\d+$/.test(tok)) return Number(tok); // inline numeric literal
  const cm = fileSrc.match(new RegExp(`const\\s+${tok}\\s*=\\s*(\\d+)`));
  return cm ? Number(cm[1]) : null;
};

// ---- A-01: onError loop-guard in BOTH paths ----
const heroLoopGuard =
  /onError=\{\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*src\s*!==\s*CARD_FALLBACK_IMAGE\s*\)[\s\S]*?setSrc\(CARD_FALLBACK_IMAGE\)/.test(
    heroBody,
  );
const stopLoopGuard =
  /onError=\{\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*src\s*!==\s*CARD_FALLBACK_IMAGE\s*\)[\s\S]*?setSrc\(CARD_FALLBACK_IMAGE\)/.test(
    stopBody,
  );
check(
  "A-01 onError fallback is LOOP-SAFE in BOTH deck paths (guarded by `if (src !== CARD_FALLBACK_IMAGE)`)",
  heroLoopGuard && stopLoopGuard,
  `An unguarded onError that re-sets the fallback storms infinitely if the fallback URL itself fails. hero=${heroLoopGuard} curated=${stopLoopGuard}; both must guard before setSrc(CARD_FALLBACK_IMAGE).`,
);

// ---- A-02: placeholder is not an old bare-panel color / not empty ----
const blurhashMatch = swipeable.match(
  /DECK_HERO_PLACEHOLDER_BLURHASH\s*=\s*(['"])([^'"]*)\1/,
);
const blurhash = blurhashMatch ? blurhashMatch[2] : "";
const placeholderIsRealBlurhash =
  blurhash.length >= 6 && // a real blurhash is well over 6 chars
  !blurhash.startsWith("#") && // not a hex color
  !OLD_PANEL_HEXES.some((h) => blurhash.toLowerCase().includes(h.toLowerCase()));
// And neither file may pass an old panel hex as a placeholder source.
const noOldHexPlaceholder = !OLD_PANEL_HEXES.some(
  (h) =>
    new RegExp(`placeholder=\\{[^}]*${h.replace(/[#]/g, "\\#")}`, "i").test(heroBody) ||
    new RegExp(`placeholder=\\{[^}]*${h.replace(/[#]/g, "\\#")}`, "i").test(stopBody),
);
check(
  "A-02 placeholder is a real non-empty blurhash, never an old bare-panel hex (#1a1a2e/#1C1C1E/#2C2C2E)",
  placeholderIsRealBlurhash && noOldHexPlaceholder,
  `The placeholder is the WHOLE fix — it must never be the old near-black panel color or an empty string. blurhash="${blurhash}" realBlurhash=${placeholderIsRealBlurhash} noOldHex=${noOldHexPlaceholder}.`,
);

// ---- A-03: non-zero resolved transition in BOTH files ----
const heroMs = resolveTransitionMs(swipeable, heroBody);
const stopMs = resolveTransitionMs(curated, stopBody);
const bothNonZero =
  Number.isInteger(heroMs) && heroMs > 0 && heroMs <= 1000 &&
  Number.isInteger(stopMs) && stopMs > 0 && stopMs <= 1000;
check(
  "A-03 fade transition resolves to a non-zero integer in BOTH files (no hard black->photo cut)",
  bothNonZero,
  `A 0 (or unresolved) transition reintroduces the hard cut. hero=${heroMs}ms curated=${stopMs}ms; both must be in (0,1000].`,
);

// ---- A-04: recyclingKey wired to mutable `src`, src resynced by effect ----
const heroRecyclesSrc = /recyclingKey=\{src\}/.test(heroBody);
const stopRecyclesSrc = /recyclingKey=\{src\}/.test(stopBody);
// `src` must be a useState AND resynced via useEffect on the source prop in both.
const heroSrcState =
  /const\s*\[\s*src\s*,\s*setSrc\s*\]\s*=\s*(React\.)?useState/.test(heroBody) &&
  /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?setSrc\([\s\S]*?\}\s*,\s*\[\s*uri\s*\]\s*\)/.test(heroBody);
const stopSrcState =
  /const\s*\[\s*src\s*,\s*setSrc\s*\]\s*=\s*(React\.)?useState/.test(stopBody) &&
  /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?setSrc\([\s\S]*?\}\s*,\s*\[\s*uri\s*\]\s*\)/.test(stopBody);
check(
  "A-04 recyclingKey is keyed on the MUTABLE `src` state (not the immutable prop), and `src` resyncs via useEffect([uri])",
  heroRecyclesSrc && stopRecyclesSrc && heroSrcState && stopSrcState,
  `recyclingKey must follow the value that flips on onError (src), else a recycled view keeps the failed frame. heroKey=${heroRecyclesSrc} curatedKey=${stopRecyclesSrc} heroState=${heroSrcState} curatedState=${stopSrcState}.`,
);

// ---- A-05: curated empty guard-chain keeps "" out of the photo component ----
// Parent must branch on truthiness of stop.imageUrl (so "" → placeholder View),
// NOT on `!= null` / `!== null` / a `.length` check that would let "" through.
const curatedTruthyGuard =
  /stop\.imageUrl\s*\?\s*\(?\s*<CuratedStopImage/.test(curated);
const curatedNoNullishGuard =
  !/stop\.imageUrl\s*!==?\s*null\s*\?/.test(curated) &&
  !/stop\.imageUrl\s*!==?\s*undefined\s*\?/.test(curated);
check(
  "A-05 curated empty/null guard-chain keeps an empty STRING out of CuratedStopImage (truthiness ternary, not `!= null`)",
  curatedTruthyGuard && curatedNoNullishGuard,
  `CuratedStopImage has no internal length guard; the parent truthiness ternary is the ONLY thing stopping {uri:""}. A "!= null"/".length" loosening would request a broken empty URL -> the dark panel returns. truthy=${curatedTruthyGuard} noNullish=${curatedNoNullishGuard}.`,
);

// ---- A-06: no bare react-native <Image source={{uri> photo tag survives in either file ----
const heroNoBareImageTag = !/<Image\s[^>]*source=\{\{\s*uri/.test(swipeable);
const curatedNoBareImageTag = !/<Image\s[^>]*source=\{\{\s*uri/.test(curated);
check(
  "A-06 no bare `<Image source={{ uri ... }}>` JSX tag renders a deck hero in either file (defense beyond import-grep)",
  heroNoBareImageTag && curatedNoBareImageTag,
  `Even with ExpoImage imported, a re-added bare <Image source={{uri}}> would silently restore the bug. hero=${heroNoBareImageTag} curated=${curatedNoBareImageTag}.`,
);

const failures = checks.filter((c) => !c.pass);
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}`);
  if (!c.pass) console.log(`  ${c.detail}`);
}

if (failures.length > 0) {
  console.error(
    `ORCH-1042 deck-hero ADVERSARIAL regression failed: ${failures.length}/${checks.length}`,
  );
  process.exit(1);
}

console.log("ORCH-1042 deck-hero ADVERSARIAL regression passed.");
