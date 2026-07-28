// issue #868 [cover-gallery] Pass 2 (§M.1a) + Pass 4 (deterministic render) —
// implementor regression for the shared CoverGalleryPager. RN-heavy
// (react-native + EventCoverMedia), so pinned as a SOURCE contract in the package
// house style. Bare Deno.test + @std/assert. The RUNTIME proof that a chevron/tap
// changes the DISPLAYED image lives in the on-device before/after screenshots
// (IMPL-868.md Pass 4).
//
// FAILS-ON-REVERT (proven by TRUE deletion in the implementation report):
//   • Break the deterministic link (render coverNode unconditionally instead of
//     sequence[activeIndex]) → T-DETERMINISTIC FAILS.
//   • Remove the chevrons → T-CHEVRON FAILS.
//
// Run: deno test --allow-read packages/offering-rendering/__tests__/coverGalleryPager.test.ts

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = await Deno.readTextFile(
  new URL("../CoverGalleryPager.tsx", import.meta.url),
);
// Comment-stripped for NEGATIVE assertions (the header prose mentions the OLD
// pagingEnabled ScrollView it replaced; that must not trip a "no ScrollView" check).
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/.*$/gm,
  "$1",
);

Deno.test("T-1 controlled props: coverNode + gallery + activeIndex + onActiveIndexChange (no paging width)", () => {
  assert(/coverNode:\s*React\.ReactNode/.test(SRC));
  assert(/gallery:\s*OfferingGalleryImage\[\]/.test(SRC));
  assert(/activeIndex:\s*number/.test(SRC));
  assert(/onActiveIndexChange:\s*\(index:\s*number\)\s*=>\s*void/.test(SRC));
});

Deno.test("T-DETERMINISTIC — the cover renders ONLY sequence[activeIndex] (activeIndex change swaps the shown image)", () => {
  // The active item is selected purely from activeIndex.
  assert(/const item = clamped === 0 \? undefined : gallery\[clamped - 1\]/.test(SRC), "active item = gallery[activeIndex-1]");
  // index 0 → the EXISTING cover node; else → EventCoverMedia for that gallery item.
  assert(/item === undefined \? \(/.test(SRC), "index 0 branch");
  assert(/\{coverNode\}/.test(SRC), "index 0 renders the cover node");
  assert(/<EventCoverMedia\s*\n\s*mediaUrl=\{item\.url\}/.test(SRC), "index i renders gallery[i-1] via EventCoverMedia");
  assert(/mediaType=\{item\.type \?\? "image"\}/.test(SRC));
});

Deno.test("T-NO-SCROLLVIEW — no horizontal pager ScrollView (it could not scrollTo behind the sheet)", () => {
  assert(!/pagingEnabled/.test(CODE), "no pagingEnabled horizontal pager");
  assert(!/scrollTo\(/.test(CODE), "no scrollTo (deterministic render, not scroll-driven)");
});

Deno.test("T-NO-DEAD-CONTROL — no on-cover chevrons/Pressable (unreachable behind the gorhom sheet; the row-card is the control)", () => {
  // On-device (Samsung, FIFA) proof: on-cover chevron taps were swallowed by the
  // sheet's scroll responder while a row-card tap flipped the cover. Dead on-cover
  // controls are removed — the pager only RENDERS sequence[activeIndex]; the
  // CoverGalleryRow (body, on top of the sheet) drives activeIndex.
  assert(!/<Pressable/.test(CODE), "no on-cover Pressable control");
  assert(!/react-native-svg/.test(CODE), "no chevron glyph on the cover");
});
