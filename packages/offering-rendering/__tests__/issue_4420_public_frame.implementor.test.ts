// MINGLA-INVARIANT: I-4420-PREMIUM-PUBLIC-FRAME | issue #4420 | Every buyer offering page (event, RSVP, experience, trip) mounts ParallaxCoverShell with frame="premium": the title sits on the cover, the glass header carries close / share / pause (nothing floats over the tickets), the theme motion covers the whole screen under the header and the bars, and the brand and venue pages keep the classic frame until they opt in.
// issue #4420 — implementor regression for the premium public-page frame.
// Deno-runnable source contracts: the shell and bodies import react-native
// and cannot mount here; the business render suites mount them.
//
// FAILS-ON-REVERT (true line deletion):
//   - drop `frame="premium"` from any of the four previews → F-1 fails;
//   - render `{motionPause(` in a premium branch (the floating pause that sat
//     over the tickets) → F-2 fails;
//   - move the premium header before the motion overlay → F-3 fails;
//   - add a `frame=` prop to the brand or venue page → F-4 fails;
//   - restore the in-body title without the identityOnCover gate → F-5 fails;
//   - give the glass bar a fill on its title text (gradient on text) → F-6 fails;
//   - import expo-blur (GlassBlur) into the frame → F-7 fails.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): string =>
  Deno.readTextFileSync(new URL(rel, import.meta.url));

const shell = read("../ParallaxCoverShell.tsx");
const premium = shell.slice(
  shell.indexOf("// ===================== PREMIUM FRAME (issue #4420)"),
  shell.indexOf("// ===================== DESKTOP (web ≥1024px) ====================="),
);

Deno.test("F-1 all four buyer offering previews opt into the premium frame", () => {
  for (const rel of [
    "../../../mingla-business/src/components/event/FoundationEventPreview.tsx",
    "../../../mingla-business/src/components/event/FoundationRsvpPreview.tsx",
    "../../../mingla-business/src/components/trip/TripPreview.tsx",
    "../../../mingla-business/src/components/experience/ExperiencePreview.tsx",
  ]) {
    const src = read(rel);
    assertStringIncludes(src, 'frame="premium"', rel);
    assertStringIncludes(src, "coverIdentity={coverIdentity}", rel);
    assertStringIncludes(src, "identityOnCover", rel);
  }
});

Deno.test("F-2 the pause control lives in the glass header, never floating over content", () => {
  assert(premium.length > 0, "premium section present");
  assert(!premium.includes("{motionPause("), "no floating pause in the premium frame");
  assertStringIncludes(premium, 'part="pauseButton"');
  assertStringIncludes(premium, "pauseSlot={");
  // the header turns solid (plain icons, title) once the cover scrolls away
  assertStringIncludes(premium, "solid={solidHeader}");
  assertStringIncludes(premium, "titleOpacity={bandOpacity}");
});

Deno.test("F-3 the motion covers the whole screen, under the header in every premium layout", () => {
  const overlays = premium.match(/\{motionOverlay\(\{[^}]*\}\)\}/g) ?? [];
  assertEquals(overlays.length, 3);
  let from = 0;
  for (const overlay of overlays) {
    const at = premium.indexOf(overlay, from);
    const header = premium.indexOf("{premiumHeader}", at);
    assert(header > at, "the header mounts after (above) the motion overlay");
    from = at + overlay.length;
  }
  // the overlay itself stays pointer-inert and hidden from screen readers
  assertStringIncludes(shell, 'importantForAccessibility="no-hide-descendants"');
  // and below every floating bar (MOTION_Z < FLOATING_CTA_MIN_Z)
  assertStringIncludes(shell, "export const MOTION_Z = 5;");
  assertStringIncludes(shell, "export const FLOATING_CTA_MIN_Z = 6;");
});

Deno.test("F-4 the venue and brand pages opt into the premium frame", () => {
  // [TEST-MOD-APPROVED #4420] wave B opted the venue page in; wave 2 (the
  // approved public-pages design) opts the brand page in.
  assertStringIncludes(shell, 'frame = "classic"');
  assertStringIncludes(read("../../brand-rendering/PublicBrandPage.tsx"), 'frame="premium"');
  const venue = read("../../brand-rendering/PublicVenueScreen.tsx");
  assertStringIncludes(venue, 'frame="premium"');
  assertStringIncludes(venue, "coverIdentity={{");
});

Deno.test("F-5 each body prints its title only when the cover does not", () => {
  assertStringIncludes(read("../EventOfferingBody.tsx"), "{identityOnCover ? null : (");
  assertStringIncludes(read("../RsvpOfferingBody.tsx"), "{identityOnCover ? null : (");
  assertStringIncludes(read("../TripOfferingBody.tsx"), "{!isDesktop && !identityOnCover ? (");
  assertStringIncludes(read("../ExperienceOfferingBody.tsx"), "{!isDesktop && !identityOnCover ? (");
});

Deno.test("F-6 the glass bar fills only its button; text accents stay the first colour", () => {
  const bar = read("../OfferingGlassBar.tsx");
  assertStringIncludes(bar, "accentFill(palette)");
  assertStringIncludes(bar, "<ThemeAccentGradientLayer");
  assert(!/styles\.title,[^\]]*accentFill/.test(bar), "no fill on the title");
  const facts = read("../OfferingFactRows.tsx");
  assertStringIncludes(facts, "themeTextAccent(palette)");
  assert(!facts.includes("accentFill("), "fact rows never take the gradient fill");
});

Deno.test("F-7 the frame adds no expo-blur dependency to the public route", () => {
  for (const rel of ["../ParallaxCoverShell.tsx", "../OfferingGlassBar.tsx", "../OfferingFactRows.tsx", "../OfferingCoverIdentity.tsx"]) {
    const src = read(rel);
    assert(!src.includes('from "./GlassBlur"'), rel);
    assert(!src.includes('from "expo-blur"'), rel);
  }
});

Deno.test("F-8 the event glass bar names the next step from the live selection", () => {
  const body = read("../EventOfferingBody.tsx");
  assertStringIncludes(body, '`${selectedQty} ticket${selectedQty === 1 ? "" : "s"} · all-in`');
  assertStringIncludes(body, '? "Continue"');
  assertStringIncludes(body, "onPress={onProceedToCart}");
  // the public route shows the bar as the one place to continue
  const page = read("../../../mingla-business/src/components/event/PublicEventPage.tsx");
  assertStringIncludes(page, "inlineProceed={false}");
});
