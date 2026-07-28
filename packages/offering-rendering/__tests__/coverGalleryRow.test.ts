// issue #868 [cover-gallery] — implementor regression for the shared
// CoverGalleryRow (beneath-cover card row over [cover] ++ gallery).
//
// CoverGalleryRow mounts react-native (View/Image/Pressable/ScrollView) +
// react-native-svg, so — Deno-runnable in the 1339/1340/1358 package house style
// (read the source → assert the compiled contract), since the package ships no
// react-native renderer. This is exactly what fails-on-revert requires.
//
// FAILS-ON-REVERT (proven by TRUE line deletion in the implementation report):
//   • Delete `if (gallery.length < 1) return null;` → T-1 FAILS.
//   • Revert the ▶ badge `cover.type === "video"` gate → T-3 FAILS.
//   • Revert the active ring/selected wiring → T-5 FAILS.
//   • Revert `onSelect(index)` on the card → T-6 FAILS.
//
// Run locally (repo root):
//   deno test --allow-read packages/offering-rendering/__tests__/coverGalleryRow.test.ts

import {
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

const SRC = await read("../CoverGalleryRow.tsx");
// Strip block + line comments so an assertion targets real code, not prose.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/.*$/gm,
  "$1",
);

Deno.test("T-1 renders NOTHING when there are no additional photos (Constitution #9)", () => {
  assert(
    /if\s*\(\s*gallery\.length\s*<\s*1\s*\)\s*return null;/.test(CODE),
    "empty gallery must early-return null",
  );
});

Deno.test("T-2 card 0 is the COVER: video → deriveCoverPosterUrl, else the cover url", () => {
  assert(/deriveCoverPosterUrl\(cover\.url\)/.test(CODE), "reuses the poster helper");
  assert(/const\s+isCoverVideo\s*=\s*cover\.type\s*===\s*"video"/.test(CODE));
  assert(/renderCard\(\s*0,/.test(CODE), "card 0 is rendered first");
  assert(/"Cover, video"\s*:\s*"Cover"/.test(CODE), "card 0 labelled Cover(/, video)");
});

Deno.test("T-3 ▶ play badge on card 0 ONLY for a video cover (never image/GIF or gallery cards)", () => {
  // card 0 passes showPlay = isCoverVideo; gallery cards pass false.
  assert(/isCoverVideo,\s*\n\s*\)/.test(CODE), "card 0 showPlay = isCoverVideo");
  assert(/false,\s*\n\s*\)/.test(CODE), "gallery cards showPlay = false");
  assert(/showPlay\s*\?\s*<PlayBadge/.test(CODE), "badge gated on showPlay");
});

Deno.test("T-4 renders 1 + gallery.length cards (card 0 = cover, cards 1..N = gallery)", () => {
  assert(/gallery\.map\(\(item, i\) =>/.test(CODE));
  assert(/renderCard\(\s*\n?\s*i \+ 1,/.test(CODE), "gallery cards indexed i+1");
  assert(/Photo \$\{i \+ 1\} of \$\{gallery\.length\}/.test(CODE));
});

Deno.test("T-5 rings + badges the ACTIVE card (WCAG two-signal: ring + check + selected)", () => {
  assert(/const\s+active\s*=\s*index\s*===\s*activeIndex/.test(CODE));
  assert(
    /borderColor:\s*active\s*\?\s*palette\.accent\s*:\s*palette\.panelBorder/.test(CODE),
    "accent ring on active card",
  );
  assert(/borderWidth:\s*active\s*\?\s*2\s*:\s*1/.test(CODE));
  assert(/active\s*\?\s*<CheckBadge/.test(CODE), "2nd WCAG signal: check badge");
  assert(/accessibilityState=\{\{\s*selected:\s*active\s*\}\}/.test(CODE));
});

Deno.test("T-6 fires onSelect(index) when a card is tapped", () => {
  assert(/onPress=\{\(\)\s*=>\s*onSelect\(index\)\}/.test(CODE));
});

Deno.test("T-7 gallery cards render via item.type (image/GIF) — NO video items", () => {
  assert(/gallery:\s*OfferingGalleryImage\[\]/.test(CODE), "gallery typed image/GIF");
  assert(!/mediaType="video"/.test(CODE), "no video media-type in the row");
});
