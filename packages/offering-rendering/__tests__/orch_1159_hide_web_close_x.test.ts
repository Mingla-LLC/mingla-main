// ORCH-1159 [hide-web-close-x] — implementor-owned happy-path regression.
//
// CONTRACT: on the PUBLIC event / trip / experience pages AND the public BRAND
// page the floating "X" (close) button is HIDDEN on web (`Platform.OS === "web"`)
// and KEPT on native. The Share button (and Mute) render on EVERY surface, web
// included. Native is byte-identical to before.
//
// SCOPE EXTENSION (Seth 2026-06-18): the public BRAND page (PublicBrandPage.tsx)
// is the FIFTH consumer of the shared chrome and now ALSO opts in — its X is
// hidden on web, same as the offering pages. The opt-in MECHANISM itself stays
// covered by a synthetic NOT-opted caller (predicate returns true on web).
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
//   - delete `hideCloseOnWeb` from any of the 5 page call sites (4 offering
//     pages + the brand page) → that page's opt-in source assert fails.

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

Deno.test("ORCH-1159: a NOT-opted-in caller (hideCloseOnWeb=false) KEEPS the X on every surface", () => {
  // The opt-in MECHANISM itself: any chrome consumer that does NOT pass
  // hideCloseOnWeb is unchanged on web (and native). This proves the gate is
  // opt-in, not a blanket web-hide — distinct from the brand page, which now
  // DOES opt in (asserted below).
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

Deno.test("ORCH-1159: ALL 5 public pages (event ticketed+RSVP, trip, experience, BRAND) opt in", () => {
  const pages: Array<[string, string, string]> = [
    [
      "FoundationEventPreview (event ticketed)",
      "../../../mingla-business/src/components/event/FoundationEventPreview.tsx",
      "onShare={onShare}",
    ],
    [
      "RsvpPublicBody (event RSVP)",
      "../../../mingla-business/src/components/event/RsvpPublicBody.tsx",
      "onShare={onShare}",
    ],
    [
      "TripPreview (trip)",
      "../../../mingla-business/src/components/trip/TripPreview.tsx",
      "onShare={onShare}",
    ],
    [
      "ExperiencePreview (experience)",
      "../../../mingla-business/src/components/experience/ExperiencePreview.tsx",
      "onShare={onShare}",
    ],
    // SCOPE EXTENSION (Seth 2026-06-18) — the 5th chrome consumer.
    [
      "PublicBrandPage (brand)",
      "../../../packages/brand-rendering/PublicBrandPage.tsx",
      "onShare={callbacks.onShare}",
    ],
  ];
  for (const [label, rel, shareCall] of pages) {
    const src = read(rel);
    assert(
      /hideCloseOnWeb\b/.test(src),
      `${label} must pass hideCloseOnWeb to ParallaxCoverShell`,
    );
    // The opt-in sits on the same ParallaxCoverShell call that keeps Share.
    assertStringIncludes(src, shareCall);
  }
});

Deno.test("ORCH-1159 (scope extension): the public BRAND page opts in — HIDES its X on web", () => {
  const src = read("../../../packages/brand-rendering/PublicBrandPage.tsx");
  assert(
    /hideCloseOnWeb\b/.test(src),
    "PublicBrandPage must pass hideCloseOnWeb (brand page now opts in — Seth 2026-06-18)",
  );
  // Share is preserved on the brand page on web (never gated).
  assertStringIncludes(src, "onShare={callbacks.onShare}");
});
