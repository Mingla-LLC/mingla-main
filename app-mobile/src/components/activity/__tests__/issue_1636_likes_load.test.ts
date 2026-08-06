/**
 * Issue #1636 — "Likes takes a long time to load once you have a lot of liked
 * places."
 *
 * Happy-path regression test (implementor). The tester owns a second,
 * adversarial angle.
 *
 * Harness: app-mobile has no jest. Tests run under Node's built-in runner with
 * type stripping, which lets this file import the real TypeScript modules and
 * exercise their actual behaviour rather than grepping for their source.
 *
 *   node --experimental-strip-types --test \
 *     app-mobile/src/components/activity/__tests__/issue_1636_likes_load.test.ts
 *
 * What the measured problem was, at the real production ceiling (Seth's own
 * account, 148 saves / 52 curated):
 *
 *   - 201 image requests totalling 37 MB fired at mount, against a database
 *     query that takes 2.5 ms and returns 360 kB;
 *   - cards requested 800x1066 originals (220 114 B) for an 80pt box, while a
 *     384x384 `_thumb.jpg` (46 741 B) already sat beside every one of them,
 *     unused;
 *   - the entrance stagger ran at `index * 60 ms`, so the last card did not
 *     begin animating until 8 880 ms after mount, and every search keystroke
 *     restarted the whole ramp.
 *
 * The three groups below pin the three fixes. Groups A and B are real unit
 * tests of the shipped logic. Group C is a source-structural contract for the
 * virtualisation, in the same style as the ORCH-1189 clearance test that lives
 * beside it (these screens are not mountable in this harness).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getPlacePhotoThumbUrl,
  resolvePlacePhotoThumbSource,
  PLACE_PHOTO_THUMB_SUFFIX,
} from "../../../utils/placePhotoThumb.ts";
import {
  getEntranceStaggerDelayMs,
  ENTRANCE_MAX_DELAY_MS,
  ENTRANCE_STAGGER_STEP_MS,
  ENTRANCE_MAX_STAGGER_STEPS,
} from "../savedTabEntrance.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/activity/__tests__ → repo root is 6 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/**
 * Structural assertions must talk about CODE, not prose. Without this, a comment
 * that merely NAMES the thing we removed ("this was a plain <ScrollView> ...")
 * fails a `doesNotMatch`, and the obvious "fix" is to delete the explanation —
 * which is exactly backwards. Mirrors the comment stripping in
 * `.github/scripts/strict-grep/i-consumer-calendar-uses-end-not-start.mjs`.
 */
function readCode(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const SUPABASE_ORIGINAL =
  "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJ3yeYHov1rIkR_CnZWaV0oIE/0.jpg";
const SUPABASE_THUMB =
  "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJ3yeYHov1rIkR_CnZWaV0oIE/0_thumb.jpg";

// ───────────────────────────────────────────────────────────────────────────
// A. The thumbnail URL helper
// ───────────────────────────────────────────────────────────────────────────
describe("A. place-photo thumbnail helper", () => {
  test("A-1 rewrites a Supabase place-photos object URL to its _thumb sibling", () => {
    assert.equal(getPlacePhotoThumbUrl(SUPABASE_ORIGINAL), SUPABASE_THUMB);
  });

  test("A-2 matches the backfill writer: extension is always replaced with _thumb.jpg", () => {
    // supabase/functions/backfill-place-photo-thumbs/index.ts encodes JPEG
    // regardless of the source format, so a .png original still has a .jpg thumb.
    const png =
      "https://x.supabase.co/storage/v1/object/public/place-photos/PLACE/2.png";
    assert.equal(
      getPlacePhotoThumbUrl(png),
      "https://x.supabase.co/storage/v1/object/public/place-photos/PLACE/2_thumb.jpg",
    );
    // A basename with no extension keeps its whole stem.
    const noExt =
      "https://x.supabase.co/storage/v1/object/public/place-photos/PLACE/cover";
    assert.equal(
      getPlacePhotoThumbUrl(noExt),
      "https://x.supabase.co/storage/v1/object/public/place-photos/PLACE/cover_thumb.jpg",
    );
  });

  test("A-3 NON-SUPABASE HOSTS PASS THROUGH UNTOUCHED", () => {
    // 11 of 458 production saved cards point off-bucket. Rewriting any of these
    // renders a broken image, which is the worst possible outcome for this fix.
    const foreign = [
      "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4.jpg",
      "https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=abc",
      "https://lh3.googleusercontent.com/places/ABC/0.jpg",
      // Right file shape, wrong bucket.
      "https://x.supabase.co/storage/v1/object/public/brand_covers/BRAND/0.jpg",
      // Right bucket name, but the transformation endpoint, which we must never use.
      "https://x.supabase.co/storage/v1/render/image/public/place-photos/PLACE/0.jpg?width=240",
    ];
    for (const url of foreign) {
      assert.equal(
        getPlacePhotoThumbUrl(url),
        null,
        `must not rewrite foreign URL: ${url}`,
      );
      // And the resolver must hand back the ORIGINAL, with no fallback armed.
      const resolved = resolvePlacePhotoThumbSource(url);
      assert.deepEqual(resolved, { uri: url }, `must pass through: ${url}`);
    }
  });

  test("A-4 refuses to double-apply and refuses malformed inputs", () => {
    assert.equal(getPlacePhotoThumbUrl(SUPABASE_THUMB), null);
    assert.equal(getPlacePhotoThumbUrl(""), null);
    assert.equal(getPlacePhotoThumbUrl("   "), null);
    assert.equal(getPlacePhotoThumbUrl(null), null);
    assert.equal(getPlacePhotoThumbUrl(undefined), null);
    // Object directly at the bucket root has no directory segment, which is
    // exactly what buildThumbPathFromObjectPath refuses too.
    assert.equal(
      getPlacePhotoThumbUrl(
        "https://x.supabase.co/storage/v1/object/public/place-photos/0.jpg",
      ),
      null,
    );
    assert.equal(resolvePlacePhotoThumbSource(""), null);
    assert.equal(resolvePlacePhotoThumbSource(null), null);
  });

  test("A-5 THE FALLBACK IS ALWAYS ARMED — coverage is not universal", () => {
    // ~40 000 places have thumbs; place_pool has 88 367 active rows. A thumb URL
    // is only ever an optimistic first choice, so the original MUST ride along.
    const resolved = resolvePlacePhotoThumbSource(SUPABASE_ORIGINAL);
    assert.ok(resolved, "resolver returned null for a valid place photo");
    assert.equal(resolved.uri, SUPABASE_THUMB, "should request the thumb first");
    assert.equal(
      resolved.fallbackUri,
      SUPABASE_ORIGINAL,
      "must fall back to the full-size original if the thumb is missing",
    );
    assert.ok(resolved.uri.endsWith(PLACE_PHOTO_THUMB_SUFFIX));
  });

  test("A-6 preserves query strings and fragments", () => {
    assert.equal(
      getPlacePhotoThumbUrl(`${SUPABASE_ORIGINAL}?v=2#frag`),
      `${SUPABASE_THUMB}?v=2#frag`,
    );
  });

  test("A-7 ImageWithFallback consumes fallbackUri as a recoverable retry", () => {
    const src = read("app-mobile/src/components/figma/ImageWithFallback.tsx");
    assert.match(src, /fallbackUri\?:\s*string/, "declares the fallbackUri prop");
    // It must retry BEFORE surfacing the broken-image placeholder, and the
    // retry must not be reported to the caller as an error.
    assert.match(
      src,
      /if\s*\(\s*canRetryWithFallback\s*&&\s*!usedFallback\s*\)\s*\{[\s\S]*?setUsedFallback\(true\)[\s\S]*?return/,
      "error handler retries with the fallback before giving up",
    );
    // fallbackUri must be destructured out so it never leaks onto native <Image>.
    assert.match(src, /const\s*\{[^}]*fallbackUri[^}]*\}\s*=\s*props/);
  });

  test("A-8 SavedTab routes BOTH of its small image sites through the helper", () => {
    const saved = readCode("app-mobile/src/components/activity/SavedTab.tsx");
    assert.match(
      saved,
      /import\s*\{\s*resolvePlacePhotoThumbSource\s*\}\s*from\s*["']\.\.\/\.\.\/utils\/placePhotoThumb["']/,
      "SavedTab imports the shared helper",
    );
    // The 80x80 simple-card thumbnail.
    assert.match(
      saved,
      /const thumb = resolvePlacePhotoThumbSource\(card\.image\)/,
      "simple card resolves a thumb for its 80pt image",
    );
    // The 3-image curated strip.
    assert.match(
      saved,
      /const stopThumb = resolvePlacePhotoThumbSource\(stop\.imageUrl\)/,
      "curated strip resolves a thumb per stop image",
    );
    // Both must arm the fallback.
    assert.match(saved, /fallbackUri=\{thumb\?\.fallbackUri\}/);
    assert.match(saved, /fallbackUri=\{stopThumb\?\.fallbackUri\}/);
    // And the transformation endpoint must never appear.
    assert.doesNotMatch(
      saved,
      /render\/image\//,
      "must not use the billed Supabase image-transformation endpoint",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B. The entrance stagger is bounded
// ───────────────────────────────────────────────────────────────────────────
describe("B. entrance stagger tail is bounded as N grows", () => {
  test("B-1 THE TAIL DOES NOT GROW WITH LIST LENGTH", () => {
    // This is the whole bug: the old code was `index * 60`, so the tail was
    // N * 60 ms — 8 880 ms at the real production ceiling of 148 cards.
    for (const n of [1, 10, 50, 148, 200, 1000, 10000]) {
      const lastIndex = n - 1;
      const tail = getEntranceStaggerDelayMs(lastIndex);
      assert.ok(
        tail <= ENTRANCE_MAX_DELAY_MS,
        `tail for N=${n} was ${tail}ms, above the ${ENTRANCE_MAX_DELAY_MS}ms ceiling`,
      );
      // The old formula would have produced this; prove we are not it.
      if (lastIndex > ENTRANCE_MAX_STAGGER_STEPS) {
        assert.notEqual(
          tail,
          lastIndex * ENTRANCE_STAGGER_STEP_MS,
          `tail for N=${n} still scales linearly with the index`,
        );
      }
    }
    // Concretely: the card that used to wait 8.88 s now waits 0.48 s.
    assert.equal(getEntranceStaggerDelayMs(147), ENTRANCE_MAX_DELAY_MS);
    assert.equal(getEntranceStaggerDelayMs(9999), ENTRANCE_MAX_DELAY_MS);
    assert.equal(ENTRANCE_MAX_DELAY_MS, 480);
  });

  test("B-2 the entrance still READS as a stagger for the first cards", () => {
    // Seth wants this premium, not abrupt: the cards a user can actually see on
    // first paint must still come in one after another, not all at once.
    for (let i = 0; i <= ENTRANCE_MAX_STAGGER_STEPS; i += 1) {
      assert.equal(
        getEntranceStaggerDelayMs(i),
        i * ENTRANCE_STAGGER_STEP_MS,
        `index ${i} lost its stagger step`,
      );
    }
    assert.notEqual(
      getEntranceStaggerDelayMs(0),
      getEntranceStaggerDelayMs(1),
      "the ramp was flattened to a single simultaneous pop",
    );
  });

  test("B-3 monotonic, non-negative, and total on hostile input", () => {
    let previous = -1;
    for (let i = 0; i < 500; i += 1) {
      const delay = getEntranceStaggerDelayMs(i);
      assert.ok(delay >= 0, `negative delay at ${i}`);
      assert.ok(delay >= previous, `delay went backwards at ${i}`);
      previous = delay;
    }
    assert.equal(getEntranceStaggerDelayMs(-5), 0);
    assert.equal(getEntranceStaggerDelayMs(Number.NaN), 0);
    assert.equal(getEntranceStaggerDelayMs(Number.POSITIVE_INFINITY), 0);
  });

  test("B-4 SavedTab animates each card ONCE — a keystroke cannot restart the ramp", () => {
    const saved = readCode("app-mobile/src/components/activity/SavedTab.tsx");
    // The old dependency array was `[filteredCards.length]`, so any change in
    // the match count reset all N cards to 0.8 and re-ran the whole ramp.
    assert.doesNotMatch(
      saved,
      /\}, \[filteredCards\.length\]\)/,
      "entrance effect still keyed on filteredCards.length (restarts on every keystroke)",
    );
    assert.match(
      saved,
      /entranceAnimatedIdsRef/,
      "no once-per-card guard on the entrance animation",
    );
    assert.match(
      saved,
      /if \(entranceAnimatedIdsRef\.current\.has\(card\.id\)\) continue;/,
      "entrance effect must skip cards that already animated in",
    );
    // The clamped delay must be handed to the animation, not to a raw setTimeout
    // whose cleanup could strand a card at 0.8 forever.
    assert.match(saved, /delay: getEntranceStaggerDelayMs\(newCardIndex\)/);
    assert.doesNotMatch(
      saved,
      /\}, index \* 60\)/,
      "the unbounded `index * 60` stagger is still present",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C. The list is virtualised, and everything it used to do it still does
// ───────────────────────────────────────────────────────────────────────────
describe("C. Saved list virtualisation contract", () => {
  const saved = readCode("app-mobile/src/components/activity/SavedTab.tsx");

  test("C-1 THE LIST IS VIRTUALISED — no ScrollView + map over every card", () => {
    assert.match(saved, /<FlatList/, "SavedTab must render a FlatList");
    assert.doesNotMatch(
      saved,
      /<ScrollView/,
      "the non-virtualised ScrollView is back",
    );
    assert.doesNotMatch(
      saved,
      /filteredCards\.map\(/,
      "every card is being rendered eagerly again",
    );
    assert.match(saved, /data=\{filteredCards\}/);
    assert.match(saved, /keyExtractor=\{keyExtractor\}/, "stable keyExtractor");
    assert.match(
      saved,
      /const keyExtractor = useCallback\(\(card: SavedCard\) => card\.id, \[\]\)/,
    );
    // The mounted window must actually be bounded. FlatList's default
    // windowSize is 21, which would keep ~90 rows (and their images) alive and
    // defeat the entire fix.
    assert.match(saved, /windowSize=\{ISSUE_1636_WINDOW_SIZE\}/);
    assert.match(saved, /initialNumToRender=\{ISSUE_1636_INITIAL_RENDER_COUNT\}/);
    assert.match(
      saved,
      /const ISSUE_1636_WINDOW_SIZE = (\d+)/,
      "window size must be declared",
    );
    const windowSize = Number(/const ISSUE_1636_WINDOW_SIZE = (\d+)/.exec(saved)![1]);
    assert.ok(
      windowSize > 0 && windowSize < 21,
      `windowSize ${windowSize} is not tighter than FlatList's default of 21`,
    );
  });

  test("C-2 rows are memoised components, not inline render functions", () => {
    assert.match(saved, /const SavedSimpleCardRow = React\.memo\(/);
    assert.match(saved, /const SavedCuratedCardRow = React\.memo\(/);
    // Both heterogeneous card types must still be reachable.
    assert.match(saved, /<SavedSimpleCardRow/);
    assert.match(saved, /<SavedCuratedCardRow/);
    assert.match(
      saved,
      /Array\.isArray\(\(card as any\)\.stops\) && \(card as any\)\.stops\.length > 0/,
      "curated/simple discrimination must survive",
    );
    // Memoised rows need stable callbacks or the memo is decorative.
    assert.match(saved, /const rowHandlers = useRef\(\{/);
    assert.match(saved, /\}\)\.current;/);
  });

  test("C-3 filter bar, empty state, refresh and keyboard behaviour all survive", () => {
    assert.match(saved, /ListHeaderComponent=\{listHeader\}/, "filter bar is the list header");
    assert.match(saved, /<CardFilterBar/, "filter bar still rendered");
    assert.match(saved, /ListEmptyComponent=\{listEmpty\}/, "empty state preserved");
    assert.match(saved, /const listEmpty = useMemo\(\s*\(\) => renderEmptyComponent\(\)/);
    assert.match(saved, /refreshControl=\{<RefreshControl/, "pull-to-refresh preserved");
    assert.match(saved, /keyboardShouldPersistTaps="handled"/);
    assert.match(saved, /keyboardDismissMode="on-drag"/);
    assert.match(saved, /showsVerticalScrollIndicator=\{false\}/);
    // The keyboard spacer that used to be the ScrollView's last child.
    assert.match(saved, /ListFooterComponent=\{listFooter\}/);
    assert.match(saved, /keyboardHeight > 0 \? <View style=\{\{ height: keyboardHeight \}\} \/> : null/);
    // All four empty-state branches must still exist.
    for (const key of [
      "savedTab.loadingSaved",
      "savedTab.errorTitle",
      "savedTab.noMatchesTitle",
      "savedTab.emptyTitle",
    ]) {
      assert.ok(saved.includes(key), `empty-state branch ${key} was dropped`);
    }
  });

  test("C-4 ORCH-1189 floating-nav clearance still rides the scroll CONTENT", () => {
    // Regression guard for the black-bar fix: the clearance must stay on the
    // inner scroll content, never on a frame-shrinking parent padding.
    assert.match(saved, /bottomNavTotalHeight\?:\s*number/);
    assert.match(
      saved,
      /mainScrollContent:\s*\{[\s\S]*?paddingBottom:\s*bottomNavTotalHeight\s*\+\s*24/,
    );
    assert.match(
      saved,
      /contentContainerStyle=\{dynamicStyles\.mainScrollContent\}/,
      "the FlatList must apply the ORCH-1189 clearance to its content container",
    );
  });

  test("C-5 the style blocks no longer re-allocate on every render", () => {
    // ~660 style objects were rebuilt inside the component body per render.
    // Module scope means allocated once; the only prop-dependent style is the
    // ORCH-1189 clearance, which is memoised on bottomNavTotalHeight.
    assert.match(
      saved,
      /^const styles = StyleSheet\.create\(\{/m,
      "styles must be at module scope",
    );
    assert.match(
      saved,
      /^const curatedSavedStyles = StyleSheet\.create\(\{/m,
      "curatedSavedStyles must be at module scope",
    );
    assert.doesNotMatch(
      saved,
      /^ {2}const styles = StyleSheet\.create\(\{/m,
      "styles moved back inside the component body",
    );
    assert.match(
      saved,
      /const dynamicStyles = useMemo\([\s\S]*?\[bottomNavTotalHeight\],/,
    );
    assert.match(saved, /export default React\.memo\(SavedTab\)/);
  });
});
