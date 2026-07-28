// issue #868 [cover-gallery] Pass 2 (§M.1a) + Pass 3 (on-device fixes) —
// implementor regression for the shared CoverGalleryPager. RN-heavy
// (react-native + EventCoverMedia), so pinned as a SOURCE contract in the package
// house style. Bare Deno.test + @std/assert.
//
// FAILS-ON-REVERT (proven by TRUE deletion in the implementation report):
//   • BUG 1 (settle-guard): revert the commit from onMomentumScrollEnd back to an
//     onScroll frame-commit → T-SETTLE FAILS (no intermediate onScroll commit is
//     allowed; the ring must commit only on settle).
//   • Remove the page-0 `{coverNode}` → T-2 FAILS.
//   • Remove the chevrons → T-CHEVRON FAILS (BUG 2 guaranteed control).
//
// Run: deno test --allow-read packages/offering-rendering/__tests__/coverGalleryPager.test.ts

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(
  new URL("../CoverGalleryPager.tsx", import.meta.url),
);

Deno.test("T-1 controlled props: coverNode + gallery + activeIndex + onActiveIndexChange + width", () => {
  assert(/coverNode:\s*React\.ReactNode/.test(SRC));
  assert(/gallery:\s*OfferingGalleryImage\[\]/.test(SRC));
  assert(/activeIndex:\s*number/.test(SRC));
  assert(/onActiveIndexChange:\s*\(index:\s*number\)\s*=>\s*void/.test(SRC));
  assert(/width:\s*number/.test(SRC));
});

Deno.test("T-2 page 0 = the EXISTING cover node (UNCHANGED, video-capable)", () => {
  assert(/<View style=\{pageStyle\}>\{coverNode\}<\/View>/.test(SRC));
});

Deno.test("T-3 pages 1..N = one EventCoverMedia per gallery item (image/GIF)", () => {
  assert(/gallery\.map\(\(item, i\) =>/.test(SRC));
  assert(/mediaType=\{item\.type \?\? "image"\}/.test(SRC));
  assert(/horizontal\s*\n\s*pagingEnabled/.test(SRC));
});

Deno.test("T-SETTLE BUG 1 — the shown index COMMITS ONLY ON SETTLE, never on intermediate onScroll frames", () => {
  // The pager drives the scroll from activeIndex (single programmatic-scroll site).
  assert(/programmaticRef = useRef\(false\)/.test(SRC), "programmatic-scroll guard exists");
  assert(/scrollViewRef\.current\?\.scrollTo\(\{ x: activeIndex \* width/.test(SRC), "useEffect drives scrollTo from activeIndex");
  // Commit happens on onMomentumScrollEnd (settle), NOT on raw onScroll.
  assert(/onMomentumScrollEnd=\{handleSettle\}/.test(SRC), "commit on settle");
  assert(!/onScroll=\{handleSettle\}/.test(SRC), "must NOT commit on raw onScroll frames");
  // A programmatic settle is suppressed; a user swipe settle commits once.
  assert(/if \(programmaticRef\.current\) \{\s*\n\s*programmaticRef\.current = false;\s*\n\s*return;/.test(SRC), "programmatic settle suppressed");
  assert(/if \(settled !== activeRef\.current\)/.test(SRC), "commit only when the settled index differs");
});

Deno.test("T-CHEVRON BUG 2 — tap chevrons page cover↔photos (guaranteed control)", () => {
  assert(/activeIndex > 0 \? \(/.test(SRC), "prev chevron shown when not on the cover");
  assert(/onPress=\{goPrev\}/.test(SRC));
  assert(/activeIndex < lastIndex \? \(/.test(SRC), "next chevron shown when not on the last page");
  assert(/onPress=\{goNext\}/.test(SRC));
  assert(/accessibilityLabel="Previous photo"/.test(SRC));
  assert(/accessibilityLabel="Next photo"/.test(SRC));
});

Deno.test("T-EMPTY empty gallery ⇒ page-0-only (gallery.map over [] renders no extra pages)", () => {
  const pageCount = (SRC.match(/style=\{pageStyle\}/g) ?? []).length;
  assert(pageCount === 2, "exactly two <View style={pageStyle}> sites: cover + mapped page template");
});
