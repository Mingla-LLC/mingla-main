// issue #868 [cover-gallery] — implementor regression for the ParallaxCoverShell
// pager + row wiring. The shell mounts EventCoverMedia / ThemeEntranceAnimation /
// OfferingChrome (react-native), so — like the sibling 1358/1339 tests — it is
// Deno-runnable as a SOURCE contract (read the .tsx → assert the wiring). This is
// exactly what fails-on-revert requires.
//
// FAILS-ON-REVERT (proven by TRUE deletion in the implementation report):
//   • Remove the `galleryImages` prop → T-1 FAILS.
//   • Revert the pager guard `sequenceActive` / the `coverRender` swap → T-2 FAILS
//     (byte-identical guard).
//   • Remove the `<CoverGalleryRow` injection before {children} → T-4 FAILS.
//
// Run locally (repo root):
//   deno test --allow-read packages/offering-rendering/__tests__/parallaxCoverGallery.test.ts

import {
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

const SRC = await read("../ParallaxCoverShell.tsx");

Deno.test("T-1 declares the additive galleryImages prop (and destructures it)", () => {
  assert(/galleryImages\?\s*:\s*OfferingGalleryImage\[\]/.test(SRC));
  assert(/\bgalleryImages,\n/.test(SRC), "galleryImages destructured from props");
});

Deno.test("T-2 engages the pager + row ONLY when the sequence has >1 item (byte-identical guard)", () => {
  assert(/const\s+sequenceActive\s*=\s*gallery\.length\s*>=\s*1/.test(SRC));
  assert(
    /const\s+coverRender\s*=\s*sequenceActive\s*\?\s*coverPager\s*:\s*coverMedia/.test(SRC),
    "single cover unless in gallery mode",
  );
  assert(/const\s+galleryRow\s*=\s*sequenceActive\s*\?/.test(SRC));
});

Deno.test("T-3 pages over [cover] ++ gallery: page 0 = existing coverMedia, pages 1..N = gallery images", () => {
  assert(/\{coverMedia\}/.test(SRC), "page 0 reuses the UNCHANGED coverMedia");
  assert(/gallery\.map\(\(item, i\) =>/.test(SRC));
  assert(/mediaType=\{item\.type \?\? "image"\}/.test(SRC));
  assert(/horizontal\s*\n\s*pagingEnabled/.test(SRC), "horizontal paging pager");
});

Deno.test("T-4 renders CoverGalleryRow as the body's first row (before children); single-owner activeIndex", () => {
  assert(/<CoverGalleryRow/.test(SRC));
  assert(/\{galleryRow\}\n\s*\{children\}/.test(SRC), "row immediately before children");
  assert(
    /const\s+\[activeIndex,\s*setActiveIndex\]\s*=\s*React\.useState\(0\)/.test(SRC),
    "single owner of the shown-item state",
  );
  // Pass 3 — the pager DRIVES the scroll from activeIndex (useEffect), not a direct
  // tap-time scrollTo that fought onScroll.
  assert(/pagerRef\.current\?\.scrollTo\(\{ x: activeIndex \* coverWidth/.test(SRC), "pager drives scrollTo from activeIndex");
});

Deno.test("T-5 BUG 1 — shell pager commits the shown index ONLY ON SETTLE (debounced), never on intermediate onScroll frames", () => {
  assert(/const programmaticRef = React\.useRef\(false\)/.test(SRC), "programmatic-scroll guard");
  // Commit is debounced (settle), guarded, and only when the settled index differs.
  assert(/settleTimerRef\.current = setTimeout\(/.test(SRC), "debounced settle commit");
  assert(/if \(programmaticRef\.current\) \{\s*\n\s*programmaticRef\.current = false;\s*\n\s*return;/.test(SRC), "programmatic settle suppressed");
  assert(/if \(settled !== activeRef\.current\)/.test(SRC), "commit only when the settled index differs");
  // selectSequenceIndex must NOT itself scrollTo (that flickered — BUG 1).
  assert(/const selectSequenceIndex = React\.useCallback\(\(index: number\): void => \{\s*\n\s*setActiveIndex\(index\);\s*\n\s*\}/.test(SRC), "tap only sets the index");
});

Deno.test("T-6 BUG 2 — shell cover pager has tap chevrons (guaranteed control)", () => {
  assert(/<ShellChevron dir="left"/.test(SRC));
  assert(/<ShellChevron dir="right"/.test(SRC));
  assert(/onPress=\{goToPrevPage\}/.test(SRC));
  assert(/onPress=\{goToNextPage\}/.test(SRC));
});
