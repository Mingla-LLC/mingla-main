// ORCH-1157 [rsvp-public-redesign] Round-11 — SUPERSEDED by Round-12.
//
// [TEST-MOD-APPROVED ORCH-1157] — Round-11's mechanism (an in-tree
// screen-height absolute layer, `styles.androidNavFillerScreenLayer`, wrapping
// the inline-path `androidNavFiller` so its bottom:0 "reaches scrH") FAILED
// on-device, clean-cache verified on a Samsung A72. The reason is now proven and
// permanent: an in-tree layer can NEVER escape the window-bounded, clipping host
// the inline sheet mounts inside — its top:0/bottom:0/explicit-height all resolve
// against the winH-bounded ancestor, not the physical screen. So the
// `androidNavFillerScreenLayer` style + its render wrapper were DELETED in
// Round-12 and replaced with a SYSTEM-BAR-LEVEL fix: on Android (nav-bar inset
// present) the inline sheet is hosted inside a transparent full-screen RN
// <Modal statusBarTranslucent navigationBarTranslucent> — a SEPARATE native
// window that genuinely spans the physical screen (scrH) including the nav-bar
// band, so the retained `androidNavFiller` (rendered as a sibling INSIDE that
// window) paints the sheet's own bg across the real 48dp band.
//
// This file's original assertions (screen-layer present, NO Modal on the inline
// path) are now FALSE BY DESIGN. Per the append-only override grammar they are
// replaced here with assertions that LOCK THE SUPERSESSION — they FAIL if the
// dead Round-11 mechanism is re-introduced or if the Round-12 window-level fix is
// reverted. The live Round-12 happy-path + fails-on-revert regression is
// `orch_1157_round12_inline_navbar_modal_window.test.ts`.

import {
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const baseSheet = await read(
  "../../../app-mobile/src/components/ui/BaseBottomSheet.tsx",
);

Deno.test("Round-11 SUPERSEDED: the dead screen-height layer is fully removed (no re-introduction)", () => {
  // The Round-11 `androidNavFillerScreenLayer` style + its render wrapper are
  // gone. Re-introducing the in-tree layer (proven non-working) fails this.
  assert(
    !baseSheet.includes("androidNavFillerScreenLayer"),
    "the dead Round-11 screen-height layer must NOT be re-introduced (in-tree layers cannot reach scrH — proven on the A72)",
  );
});

Deno.test("Round-11 SUPERSEDED: the inline-path nav-bar fix is now window-level (Round-12), not an in-tree layer", () => {
  // Round-12 hosts the inline sheet inside a full-screen RN <Modal> with
  // navigationBarTranslucent — the only mechanism that reaches the physical
  // screen bottom. If that is reverted (back to a pure in-tree inline return)
  // the band returns on-device; this assertion guards it.
  assert(
    baseSheet.includes("navigationBarTranslucent"),
    "navigationBarTranslucent must be present (Round-12 window-level inline fix)",
  );
  // `Dimensions.get('screen').height` was the Round-11 escape attempt; it is no
  // longer used for the fill (the modal window provides scrH natively).
  assert(
    !baseSheet.includes("Dimensions.get('screen').height"),
    "the Round-11 Dimensions-based screen-height escape must be gone (modal window provides scrH)",
  );
});
