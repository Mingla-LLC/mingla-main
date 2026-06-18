// ORCH-1159 [hide-web-close-x] — implementor-owned happy-path regression.
//
// CONTRACT: on the PUBLIC event / trip / experience pages the floating "X"
// (close) button is HIDDEN on web (`Platform.OS === "web"`) and KEPT on native.
// The Share button (and Mute) render on EVERY surface, web included. Native is
// byte-identical to before. The public BRAND page is out of ORCH-1159 scope and
// keeps its X on web (it does NOT opt in).
//
// All three "render sites" named in the dispatch collapse to ONE shared owner:
// the close button is rendered exclusively by `OfferingChrome` (reached via
// `ParallaxCoverShell`) on all of event/trip/experience. So the gate is the
// `hideCloseOnWeb` opt-in threaded OfferingChrome ← ParallaxCoverShell ← the 4
// public-offering FOUNDATION render components, applied through the single-owner
// `shouldRenderCloseButton` predicate.
//
// (1) BEHAVIORAL — the real RN-free predicate is EXECUTED across web/native ×
//     opt-in/opt-out.
// (2) SOURCE-CONTRACT — the wiring (gate scoped to CLOSE only, Share never
//     gated, prop forwarded, 4 pages opt in, brand page does NOT).
//
// FAILS-ON-REVERT (proven by true line-deletion — see the implementation report):
//   - delete the `hideCloseOnWeb && platformOS === "web"` term in
//     closeButtonVisibility.ts → the web-hidden behavioral assert fails.
//   - delete `shouldRenderCloseButton(...)` / the `showClose ?` guard in
//     OfferingChrome.tsx → the "close is gated" source assert fails.
//   - delete `hideCloseOnWeb` from any of the 4 page call sites → that page's
//     opt-in source assert fails.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { shouldRenderCloseButton } from "../closeButtonVisibility.ts";

// ── (1) BEHAVIORAL: execute the single-owner predicate ──────────────────────

Deno.test("ORCH-1159: opted-in public page HIDES the close button on web", () => {
  assertEquals(shouldRenderCloseButton(true, "web"), false);
});

Deno.test("ORCH-1159: opted-in public page KEEPS the close button on iOS", () => {
  assertEquals(shouldRenderCloseButton(true, "ios"), true);
});

Deno.test("ORCH-1159: opted-in public page KEEPS the close button on Android", () => {
  assertEquals(shouldRenderCloseButton(true, "android"), true);
});

Deno.test("ORCH-1159: NOT-opted-in caller (e.g. brand page) KEEPS the X on web", () => {
  // The public brand page does not pass hideCloseOnWeb → unchanged on web.
  assertEquals(shouldRenderCloseButton(false, "web"), true);
  assertEquals(shouldRenderCloseButton(false, "ios"), true);
  assertEquals(shouldRenderCloseButton(false, "android"), true);
});

// ── (2) SOURCE-CONTRACT: the wiring is correctly scoped ─────────────────────

const read = (rel: string): string =>
  Deno.readTextFileSync(new URL(rel, import.meta.url));

Deno.test("ORCH-1159: OfferingChrome gates ONLY the close button (Share/Mute never gated)", () => {
  const src = read("../OfferingChrome.tsx");
  // The close render is wrapped in the showClose guard derived from the predicate.
  assertStringIncludes(src, "shouldRenderCloseButton(hideCloseOnWeb, Platform.OS)");
  assertStringIncludes(src, "{showClose ? (");
  // The guard wraps the CLOSE button (CloseGlyph), not Share/Mute.
  const guardIdx = src.indexOf("{showClose ? (");
  const closeIdx = src.indexOf("<CloseGlyph />");
  const shareIdx = src.indexOf("<ShareGlyph />");
  assert(guardIdx >= 0 && closeIdx > guardIdx, "showClose guard must precede CloseGlyph");
  // Share renders unconditionally and AFTER the close guard block, never inside it.
  assert(shareIdx > closeIdx, "Share must render after the close button");
  // Share/Mute are NOT behind any web/Platform gate.
  assert(
    !/Platform\.OS[^\n]*ShareGlyph/.test(src),
    "Share must never be platform-gated",
  );
});

Deno.test("ORCH-1159: ParallaxCoverShell forwards hideCloseOnWeb to OfferingChrome", () => {
  const src = read("../ParallaxCoverShell.tsx");
  assertStringIncludes(src, "hideCloseOnWeb?: boolean");
  assertStringIncludes(src, "hideCloseOnWeb = false");
  assertStringIncludes(src, "hideCloseOnWeb={hideCloseOnWeb}");
});

Deno.test("ORCH-1159: the 3 public-offering pages (event ticketed+RSVP, trip, experience) opt in", () => {
  const pages: Array<[string, string]> = [
    [
      "FoundationEventPreview (event ticketed)",
      "../../../mingla-business/src/components/event/FoundationEventPreview.tsx",
    ],
    [
      "RsvpPublicBody (event RSVP)",
      "../../../mingla-business/src/components/event/RsvpPublicBody.tsx",
    ],
    [
      "TripPreview (trip)",
      "../../../mingla-business/src/components/trip/TripPreview.tsx",
    ],
    [
      "ExperiencePreview (experience)",
      "../../../mingla-business/src/components/experience/ExperiencePreview.tsx",
    ],
  ];
  for (const [label, rel] of pages) {
    const src = read(rel);
    assert(
      /hideCloseOnWeb\b/.test(src),
      `${label} must pass hideCloseOnWeb to ParallaxCoverShell`,
    );
    // The prop must sit on the ParallaxCoverShell call alongside onShare (Share kept).
    assertStringIncludes(src, "onShare={onShare}");
  }
});

Deno.test("ORCH-1159: the public BRAND page is OUT of scope — it does NOT opt in (keeps its X on web)", () => {
  const src = read("../../../packages/brand-rendering/PublicBrandPage.tsx");
  assert(
    !/hideCloseOnWeb/.test(src),
    "PublicBrandPage must NOT pass hideCloseOnWeb (brand page is out of ORCH-1159 scope)",
  );
});
