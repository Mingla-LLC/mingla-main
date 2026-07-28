// issue #868 [cover-gallery] Pass 2 (§M.1a) — implementor regression for the
// shared CoverGalleryPager (the consumer-screen pinned pager over [cover] ++
// gallery). RN-heavy (react-native + EventCoverMedia), so pinned as a SOURCE
// contract in the package house style. Bare Deno.test + @std/assert.
//
// FAILS-ON-REVERT (proven by TRUE deletion in the implementation report):
//   • Remove the page-0 `{coverNode}` → T-2 FAILS (page 0 must reuse the EXISTING
//     video-capable cover node, UNCHANGED).
//   • Remove the `gallery.map` pages → T-3 FAILS.
//   • Revert the onScroll offset→index math → T-4 FAILS.
//
// Run: deno test --allow-read packages/offering-rendering/__tests__/coverGalleryPager.test.ts

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(
  new URL("../CoverGalleryPager.tsx", import.meta.url),
);

Deno.test("T-1 controlled props: coverNode + gallery + activeIndex + onActiveIndexChange + scrollRef + width", () => {
  assert(/coverNode:\s*React\.ReactNode/.test(SRC));
  assert(/gallery:\s*OfferingGalleryImage\[\]/.test(SRC));
  assert(/activeIndex:\s*number/.test(SRC));
  assert(/onActiveIndexChange:\s*\(index:\s*number\)\s*=>\s*void/.test(SRC));
  assert(/scrollRef\?:\s*React\.Ref<ScrollView>/.test(SRC));
  assert(/width:\s*number/.test(SRC));
});

Deno.test("T-2 page 0 = the EXISTING cover node (UNCHANGED, video-capable)", () => {
  // The pager reuses the passed-in coverNode verbatim as page 0 — it does NOT
  // construct or edit EventCoverMedia for the cover (that stays the screen's).
  assert(/<View style=\{pageStyle\}>\{coverNode\}<\/View>/.test(SRC));
});

Deno.test("T-3 pages 1..N = one EventCoverMedia per gallery item (image/GIF)", () => {
  assert(/gallery\.map\(\(item, i\) =>/.test(SRC));
  assert(/mediaType=\{item\.type \?\? "image"\}/.test(SRC));
  // horizontal paging pager (ImageGallery precedent).
  assert(/horizontal\s*\n\s*pagingEnabled/.test(SRC));
});

Deno.test("T-4 onScroll maps offset→index (Math.round(offsetX / width)) → onActiveIndexChange", () => {
  assert(/Math\.round\(event\.nativeEvent\.contentOffset\.x \/ w\)/.test(SRC));
  assert(/onActiveIndexChange\(next\)/.test(SRC));
});

Deno.test("T-5 empty gallery ⇒ page-0-only (gallery.map over [] renders no extra pages)", () => {
  // No hard-coded extra page; pages 1..N derive solely from gallery.map, so an
  // empty gallery yields only the coverNode page.
  const pageCount = (SRC.match(/style=\{pageStyle\}/g) ?? []).length;
  assert(pageCount === 2, "exactly two <View style={pageStyle}> sites: cover + mapped page template");
});
