// @ts-nocheck
// Executed by `node --experimental-strip-types --test`, never bundled — the
// runner requires the explicit `.ts` extension on relative imports, which tsc
// rejects without `allowImportingTsExtensions`. Same opt-out as the suites
// beside it.
/**
 * Issue #1636 — TESTER adversarial suite.
 *
 * The implementor's `issue_1636_likes_load.test.ts` covers the happy path: the
 * thumb helper's own string behaviour, the presence of the `FlatList`, the
 * stagger clamp, and the once-per-card animation guard. This suite deliberately
 * attacks FOUR different angles, every one of them chosen from something the
 * runtime leg on a physical SM-A725F and an iPhone 17 Pro Max actually exposed:
 *
 *   T-1  The reader and the WRITER must agree, byte for byte, on real
 *        production object names. `placePhotoThumb.ts` derives a URL that some
 *        OTHER program wrote. Nothing in the repo checks the two sides against
 *        each other, and the failure mode is silent: every derived URL 404s,
 *        every card quietly falls back to the full-size original, and the
 *        screen still looks perfect while the entire saving is gone. Measured
 *        on the Likes demo account: 4.36 MB across the whole list when the
 *        derivation is right, 18.79 MB when it is not.
 *
 *   T-2  The retry must be armed EXACTLY when a second request could succeed —
 *        never for a foreign host. This is the request-count consequence of the
 *        pass-through, not the string. Of 92 saved cards on the demo account
 *        exactly ONE is off-bucket (the Ticketmaster URL pinned below); if it
 *        ever carried a `fallbackUri`, every foreign-host card in production
 *        would pay a second, guaranteed-failing round trip before rendering.
 *
 *   T-3  384 px is sized for an 80 pt row and NOTHING else. The obvious next
 *        change someone makes is "use the thumbnails everywhere", which puts a
 *        384 px asset behind a full-bleed cover. This pins the derivation to
 *        the saved-card rows.
 *
 *   T-4  The virtualisation must stay bounded, and `removeClippedSubviews` must
 *        stay OFF. Turning it on is the classic "make the list faster" edit and
 *        on Android it swallows touches — every card in this list is
 *        interactive (Schedule / share / delete), so that would ship a screen
 *        full of dead taps.
 *
 *   T-5  The unbounded stagger must be gone from the CALL SITE, not merely
 *        available in clamped form from a helper. The helper can be perfect and
 *        the screen can still schedule `index * 60` itself.
 *
 * Every group fails on an independent single-line revert; see the QA report.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  getPlacePhotoThumbUrl,
  resolvePlacePhotoThumbSource,
} from "../../../utils/placePhotoThumb.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/activity/__tests__ → repo root is 6 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

function read(rel: string): string {
  const abs = path.join(REPO_ROOT, rel);
  assert.ok(
    fs.existsSync(abs),
    `expected ${rel} to exist — this suite reads it directly; a rename must fail loudly, not silently pass`,
  );
  return fs.readFileSync(abs, "utf8");
}

/**
 * Strip block and line comments so the "this pattern must NOT appear" checks
 * below read EXECUTABLE code only. Without this, a doc comment that faithfully
 * describes the removed `index * 60` stagger would fail the very test that
 * guards its removal — and the obvious "fix" would be to delete the
 * explanation, which is exactly the wrong outcome.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SUPABASE_PUBLIC_BASE =
  "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/";

/**
 * REAL object names, read out of `storage.objects` on the production project
 * (`gqnoajqerqhnvulmnyvv`, bucket `place-photos`) during the #1636 test run.
 * Every one of these was verified to have its `_thumb.jpg` sibling already
 * present. They are here rather than invented strings because the whole point
 * of T-1 is agreement with what the writer actually produced — including the
 * Google place-id alphabet, which contains `_` and `-`, and the 7 474 `.png`
 * originals whose thumb is nonetheless a `.jpg`.
 */
const PRODUCTION_OBJECT_PATHS = [
  "ChIJ_____5gEyIkR-yrWzf-Z6jg/0.png",
  "ChIJ_____5gEyIkR-yrWzf-Z6jg/4.png",
  "ChIJ___bIY__wokROQJdjAv5F3M/1.png",
  "ChIJ_____-xdwokRYU3uKKhvETI/0.jpg",
  "ChIJ_____-xdwokRYU3uKKhvETI/1.jpg",
  "ChIJ_____-xdwokRYU3uKKhvETI/2.jpg",
  "ChIJ_____4pPwokRx5QVB_UhfTM/0.jpg",
  "ChIJ_____4pPwokRx5QVB_UhfTM/1.jpg",
  "ChIJ_____4hfwokRcG4G4j8r27E/0.jpg",
  "ChIJ_____6RYwokRbPP7iw4Yi3M/0.jpg",
  // Straight off the Likes demo account (rambleawaypod, 92 saved cards).
  "ChIJxSNFGYv1rIkR0XPaXNsKRtM/0.jpg",
  "ChIJM1LNgjpfrIkRn6Pl1XhtNuI/0.png",
  "ChIJ97pX3M0EdkgR8YFd4G1GZJ8/0.jpg",
];

/**
 * The ONE off-bucket image among the demo account's 92 saved cards. Verbatim.
 * It rendered correctly on both the SM-A725F and the iPhone 17 Pro Max during
 * this run; this test is what keeps it that way.
 */
const TICKETMASTER_URL =
  "https://s1.ticketm.net/dam/c/060/c5c08e7a-9912-456c-a060-2758be94e060_105881_TABLET_LANDSCAPE_16_9.jpg";

/**
 * Lift the writer's two pure helpers out of the Deno edge function and make
 * them callable from Node.
 *
 * The edge function cannot be imported: its first four lines are `https://`
 * specifiers and it calls `serve()` at module scope. Extracting the two
 * functions by name is deliberate — if either is renamed, moved, or stops being
 * exported, this throws, which is the correct outcome. The reader in
 * `placePhotoThumb.ts` documents that it mirrors these two functions exactly;
 * this is the test that makes that comment enforceable instead of aspirational.
 */
function loadWriterHelpers(): {
  extractPlacePhotoObjectPath: (url: string) => string | null;
  buildThumbPathFromObjectPath: (objectPath: string) => string | null;
} {
  const src = read("supabase/functions/backfill-place-photo-thumbs/index.ts");
  const names = ["extractPlacePhotoObjectPath", "buildThumbPathFromObjectPath"];
  const bodies = names.map((name) => {
    const start = src.indexOf(`export function ${name}(`);
    assert.notEqual(
      start,
      -1,
      `backfill-place-photo-thumbs no longer exports ${name} — the thumb naming contract moved and app-mobile/src/utils/placePhotoThumb.ts has to move with it`,
    );
    // Walk braces from the function's opening `{` to its matching close.
    const open = src.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    assert.notEqual(end, -1, `could not delimit ${name} in the writer source`);
    return src.slice(start, end).replace(/^export\s+/, "");
  });

  // Strip TypeScript annotations the same way the runner does for our own
  // sources: these two functions only use simple `: string`/`: string | null`
  // forms, so a narrow strip is safe and keeps the extraction honest.
  const js = bodies
    .join("\n")
    .replace(/:\s*string\s*\|\s*null/g, "")
    .replace(/:\s*string/g, "");

  const context: Record<string, unknown> = {};
  vm.createContext(context);
  vm.runInContext(
    `${js}\nglobalThis.__writer = { extractPlacePhotoObjectPath, buildThumbPathFromObjectPath };`,
    context,
  );
  const writer = (context as any).__writer;
  assert.equal(typeof writer.extractPlacePhotoObjectPath, "function");
  assert.equal(typeof writer.buildThumbPathFromObjectPath, "function");
  return writer;
}

/**
 * Lazily memoised. This MUST NOT run in a `describe` body: a throw there is
 * reported as `not ok` but Node's test runner still exits 0, so the whole suite
 * would go dark exactly the way issue #1584 describes. Verified: hoisting this
 * call into the describe body made a renamed writer helper print a failure and
 * exit 0. Keep it inside the tests.
 */
let writerHelpers: ReturnType<typeof loadWriterHelpers> | null = null;
function writer(): ReturnType<typeof loadWriterHelpers> {
  if (writerHelpers === null) writerHelpers = loadWriterHelpers();
  return writerHelpers;
}

describe("Issue #1636 T-1 — the reader agrees with the WRITER on real production object names", () => {
  test("T-1.1 every production object name derives the exact thumb the writer wrote", () => {
    for (const objectPath of PRODUCTION_OBJECT_PATHS) {
      const url = `${SUPABASE_PUBLIC_BASE}${objectPath}`;

      const writerThumbPath = writer().buildThumbPathFromObjectPath(
        writer().extractPlacePhotoObjectPath(url),
      );
      assert.equal(
        typeof writerThumbPath,
        "string",
        `the writer refuses to name a thumb for ${objectPath} — the corpus is wrong, not the code`,
      );

      const readerUrl = getPlacePhotoThumbUrl(url);
      assert.equal(
        readerUrl,
        `${SUPABASE_PUBLIC_BASE}${writerThumbPath}`,
        `reader/writer disagreement on ${objectPath}: the app would request an object that does not exist, ` +
          `404 on every card, and silently fall back to the full-size original`,
      );
    }
  });

  test("T-1.2 a .png original still resolves to a .jpg thumb, exactly as the writer stores it", () => {
    // 7 474 of the bucket's originals are .png. The writer always writes .jpg.
    // Carrying the source extension through would 404 every one of them.
    const pngUrl = `${SUPABASE_PUBLIC_BASE}ChIJM1LNgjpfrIkRn6Pl1XhtNuI/0.png`;
    const derived = getPlacePhotoThumbUrl(pngUrl);
    assert.ok(derived.endsWith("/0_thumb.jpg"), `expected a .jpg thumb, got ${derived}`);
    assert.ok(!derived.includes(".png"), `the .png extension survived into ${derived}`);
    assert.equal(
      derived,
      `${SUPABASE_PUBLIC_BASE}${writer().buildThumbPathFromObjectPath(
        writer().extractPlacePhotoObjectPath(pngUrl),
      )}`,
    );
  });

  test("T-1.3 the reader never invents a thumb the writer would have refused to write", () => {
    // The writer returns null for a bucket-root object (no directory segment).
    // If the reader were more permissive it would request a nonexistent object.
    const rootObject = `${SUPABASE_PUBLIC_BASE}loose.jpg`;
    assert.equal(
      writer().buildThumbPathFromObjectPath(
        writer().extractPlacePhotoObjectPath(rootObject),
      ),
      null,
    );
    assert.equal(
      getPlacePhotoThumbUrl(rootObject),
      null,
      "the reader derived a thumb for an object the writer would never have thumbed",
    );
  });
});

describe("Issue #1636 T-2 — the retry is armed only where a second request could succeed", () => {
  test("T-2.1 the one off-bucket production URL carries NO fallback at all", () => {
    const resolved = resolvePlacePhotoThumbSource(TICKETMASTER_URL);
    assert.equal(resolved.uri, TICKETMASTER_URL, "the foreign host must be requested verbatim");
    assert.equal(
      resolved.fallbackUri,
      undefined,
      "a foreign host was given a fallback: every off-bucket card would pay a second, " +
        "guaranteed-failing request before it could render",
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(resolved, "fallbackUri"),
      "fallbackUri must be ABSENT, not present-and-undefined — ImageWithFallback keys its retry off it",
    );
  });

  test("T-2.2 a rewritten Supabase URL always carries the ORIGINAL as its fallback", () => {
    for (const objectPath of PRODUCTION_OBJECT_PATHS) {
      const original = `${SUPABASE_PUBLIC_BASE}${objectPath}`;
      const resolved = resolvePlacePhotoThumbSource(original);
      assert.notEqual(resolved.uri, original, `${objectPath} was not rewritten to its thumb`);
      assert.equal(
        resolved.fallbackUri,
        original,
        `${objectPath} lost its fallback — an uncovered place would render a hole instead of its photo. ` +
          "Coverage is ~40 000 of 88 367 active places; this retry is the only thing standing between " +
          "an uncovered place and a broken image tile.",
      );
    }
  });

  test("T-2.3 an already-thumbed URL is passed through and NOT re-armed", () => {
    // Re-arming would mean a fallback pointing at the same object, i.e. a
    // pointless second request, and re-deriving would produce `0_thumb_thumb`.
    const thumb = `${SUPABASE_PUBLIC_BASE}ChIJ_____-xdwokRYU3uKKhvETI/0_thumb.jpg`;
    const resolved = resolvePlacePhotoThumbSource(thumb);
    assert.equal(resolved.uri, thumb);
    assert.equal(resolved.fallbackUri, undefined);
    assert.equal(getPlacePhotoThumbUrl(thumb), null);
  });

  test("T-2.4 ImageWithFallback refuses a fallback that points where the primary already points", () => {
    // The component is .tsx and cannot be imported by the type-stripping
    // runner, so this pins the guard expression itself. Without it a
    // pass-through URL would retry itself forever-ish (one wasted request per
    // card) instead of failing straight to the placeholder.
    const src = read("app-mobile/src/components/figma/ImageWithFallback.tsx");
    assert.match(
      src,
      /fallbackUri\s*!==\s*primaryUri/,
      "ImageWithFallback lost its self-pointing-fallback guard",
    );
    assert.match(
      src,
      /if\s*\(canRetryWithFallback\s*&&\s*!usedFallback\)/,
      "ImageWithFallback lost its ONE-shot retry guard — a permanently failing image could loop",
    );
    // The first, recoverable failure must NOT be reported to the caller: from
    // the caller's point of view nothing has failed yet.
    const handler = src.slice(src.indexOf("const handleError"), src.indexOf("const resolvedSource"));
    const retryReturn = handler.indexOf("return");
    const onErrorCall = handler.indexOf("props.onError()");
    assert.ok(retryReturn !== -1 && onErrorCall !== -1);
    assert.ok(
      retryReturn < onErrorCall,
      "handleError reports onError before it takes the recoverable retry — the caller would see a " +
        "failure for an image that is about to load fine",
    );
  });
});

describe("Issue #1636 T-3 — a 384 px asset is for an 80 pt row and nowhere else", () => {
  const THUMB_HELPERS = /resolvePlacePhotoThumbSource|getPlacePhotoThumbUrl/;

  test("T-3.1 the Likes saved rows are wired to the helper", () => {
    const savedTab = read("app-mobile/src/components/activity/SavedTab.tsx");
    assert.match(
      savedTab,
      /import\s*\{\s*resolvePlacePhotoThumbSource\s*\}\s*from\s*["']\.\.\/\.\.\/utils\/placePhotoThumb["']/,
      "SavedTab no longer derives thumbs — Likes is back to full-size originals in an 80 pt box",
    );
    // Both card shapes: the simple row's single image and the curated row's stops.
    const callSites = savedTab.match(/resolvePlacePhotoThumbSource\(/g) ?? [];
    assert.ok(
      callSites.length >= 2,
      `expected the helper at both the simple-row and curated-stop image sites, found ${callSites.length}`,
    );
    assert.match(
      savedTab,
      /fallbackUri=\{[^}]*fallbackUri\}/,
      "SavedTab derives a thumb but never passes the fallback down — an uncovered place renders a hole",
    );
  });

  test("T-3.2 no full-bleed / hero surface requests the 384 px thumb", () => {
    const HERO_SURFACES = [
      "app-mobile/src/components/ExpandedCardModal.tsx",
      "app-mobile/src/components/SwipeableCards.tsx",
      "app-mobile/src/components/CuratedExperienceSwipeCard.tsx",
      "app-mobile/src/components/deckCardPlate.tsx",
      "app-mobile/src/components/DiscoverScreen.tsx",
    ];
    for (const rel of HERO_SURFACES) {
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) continue; // renamed elsewhere; T-3.1 still holds the wiring
      assert.doesNotMatch(
        stripComments(fs.readFileSync(abs, "utf8")),
        THUMB_HELPERS,
        `${rel} requests the 384 px thumb. That asset is sized for an 80 pt row; behind a ` +
          "full-bleed cover it is a visible quality regression, not an optimisation.",
      );
    }
  });
});

describe("Issue #1636 T-4 — the virtualisation stays bounded and touch-safe", () => {
  const savedTab = read("app-mobile/src/components/activity/SavedTab.tsx");

  test("T-4.1 removeClippedSubviews stays OFF (Android swallows touches with it on)", () => {
    assert.match(
      savedTab,
      /removeClippedSubviews=\{false\}/,
      "removeClippedSubviews was turned on. Every row here is interactive (Schedule / share / " +
        "delete); on Android this swallows touches and ships a list of dead taps.",
    );
  });

  test("T-4.2 the mounted window is a small constant, not a function of list length", () => {
    const initial = savedTab.match(/ISSUE_1636_INITIAL_RENDER_COUNT\s*=\s*(\d+)/);
    const windowSize = savedTab.match(/ISSUE_1636_WINDOW_SIZE\s*=\s*(\d+)/);
    assert.ok(initial, "ISSUE_1636_INITIAL_RENDER_COUNT is gone");
    assert.ok(windowSize, "ISSUE_1636_WINDOW_SIZE is gone");
    const initialN = Number(initial[1]);
    const windowN = Number(windowSize[1]);
    assert.ok(
      initialN > 0 && initialN <= 15,
      `initialNumToRender=${initialN}: the measured ceiling account has 148 saves and 201 images; ` +
        "anything large here re-creates the 37 MB burst this issue exists to remove",
    );
    assert.ok(windowN > 0 && windowN <= 11, `windowSize=${windowN} is not a small constant`);
    assert.match(savedTab, /initialNumToRender=\{ISSUE_1636_INITIAL_RENDER_COUNT\}/);
    assert.match(savedTab, /windowSize=\{ISSUE_1636_WINDOW_SIZE\}/);
  });

  test("T-4.3 the list is fed the whole filtered set, with a stable per-card key", () => {
    // A hand-rolled `.slice()` here would look like virtualisation and silently
    // hide cards; the FlatList must own the windowing.
    assert.match(savedTab, /data=\{filteredCards\}/, "the FlatList is no longer fed filteredCards");
    assert.match(
      savedTab,
      /keyExtractor\s*=\s*useCallback\(\(card:\s*SavedCard\)\s*=>\s*card\.id,\s*\[\]\)/,
      "keyExtractor must be the stable card id — an index key rebinds images to the wrong row on recycle",
    );
  });

  test("T-4.4 the ORCH-1189 clearance rides the list CONTENT, not the frame", () => {
    assert.match(
      savedTab,
      /contentContainerStyle=\{dynamicStyles\.mainScrollContent\}/,
      "the floating-nav clearance left the FlatList's content container — the last card slides under the nav",
    );
    assert.match(savedTab, /paddingBottom:\s*bottomNavTotalHeight\s*\+\s*24/);
  });
});

describe("Issue #1636 T-5 — the unbounded stagger is gone from the CALL SITE", () => {
  test("T-5.1 SavedTab schedules no per-index delay of its own", () => {
    const raw = read("app-mobile/src/components/activity/SavedTab.tsx");
    const savedTab = stripComments(raw);
    assert.doesNotMatch(
      savedTab,
      /index\s*\*\s*60/,
      "an `index * 60` stagger is back in SavedTab: at the 148-card ceiling the last card would not " +
        "begin animating for 8 880 ms, which is the original complaint",
    );
    assert.doesNotMatch(
      savedTab,
      /setTimeout\([^)]*,\s*\w+\s*\*\s*ENTRANCE_STAGGER_STEP_MS\s*\)/,
      "SavedTab multiplies the step itself instead of going through the clamped helper",
    );
    assert.match(
      savedTab,
      /getEntranceStaggerDelayMs\(/,
      "SavedTab no longer calls the clamped delay helper",
    );
  });

  test("T-5.2 the clamp is enforced at the ceiling the issue was reported at", () => {
    // Guard the property, not the constant: any N must be bounded.
    const savedTabEntrance = read("app-mobile/src/components/activity/savedTabEntrance.ts");
    assert.match(savedTabEntrance, /Math\.min\(/, "the clamp is gone from getEntranceStaggerDelayMs");
  });
});
