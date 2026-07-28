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

Deno.test("T-3 DETERMINISTIC — the shell cover renders ONLY sequence[activeIndex] (index 0 = existing coverMedia)", () => {
  // Pass 4 — the active item is selected purely from activeIndex; index 0 = the
  // UNCHANGED coverMedia, else EventCoverMedia for that gallery item.
  assert(/const activeSequenceItem =\s*\n\s*activeIndex <= 0 \? undefined : gallery\[activeIndex - 1\]/.test(SRC), "active item = gallery[activeIndex-1]");
  assert(/activeSequenceItem === undefined \? \(\s*\n\s*coverMedia/.test(SRC), "index 0 = the UNCHANGED coverMedia");
  assert(/<EventCoverMedia\s*\n\s*mediaUrl=\{activeSequenceItem\.url\}/.test(SRC), "index i renders gallery[i-1]");
  // No horizontal pager ScrollView pinned behind the body scroll (it could not scrollTo).
  assert(!/onScroll=\{handlePagerScroll\}/.test(SRC), "no scroll-driven pager");
  assert(!/pagerRef\.current\?\.scrollTo/.test(SRC), "no programmatic scrollTo (deterministic render)");
});

Deno.test("T-4 renders CoverGalleryRow as the body's first row (before children); single-owner activeIndex", () => {
  assert(/<CoverGalleryRow/.test(SRC));
  assert(/\{galleryRow\}\n\s*\{children\}/.test(SRC), "row immediately before children");
  assert(
    /const\s+\[activeIndex,\s*setActiveIndex\]\s*=\s*React\.useState\(0\)/.test(SRC),
    "single owner of the shown-item state",
  );
  // Tap/chevron only sets the index; the deterministic render picks it up.
  assert(/const selectSequenceIndex = React\.useCallback\(\(index: number\): void => \{\s*\n\s*setActiveIndex\(index\);\s*\n\s*\}/.test(SRC), "tap only sets the index");
});

Deno.test("T-5 flicker-free — the shown index has NO intermediate scroll commit (no scroll offset to bounce the ring)", () => {
  // With the deterministic render there is no onScroll/onMomentumScrollEnd commit
  // path at all — the ring reflects activeIndex directly, so it cannot flicker.
  assert(!/onMomentumScrollEnd/.test(SRC), "no momentum-end commit");
  assert(!/settleTimerRef/.test(SRC), "no debounced scroll commit");
});

Deno.test("T-6 no on-cover chevrons (unreliable on the pinned-behind-scroll native cover; the row-card is the control)", () => {
  assert(!/ShellChevron/.test(SRC), "no on-cover chevron component");
  assert(!/pagerChevron/.test(SRC), "no chevron styles");
  // The beneath-cover CoverGalleryRow drives activeIndex via onSelect.
  assert(/onSelect=\{selectSequenceIndex\}/.test(SRC), "row-card tap drives the shown index");
});
