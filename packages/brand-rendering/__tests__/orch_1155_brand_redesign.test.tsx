// ORCH-1155 [public-brand-page] — implementor happy-path regression (append-only).
//
// fails-on-revert: reverting PublicBrandPage to the flat-banner / About-last /
// local-palette layout fails T-4 (uses-shell), T-1 (about-first), T-6
// (single-palette-engine) and the experience-video-cover assertion. Verified by
// TRUE LINE-DELETION of the fix (not a comment-out) — see the implementation
// report's Regression Test section for the commit hash.
//
// Structural (source-as-text) test, mirroring the existing brand-page
// data-driven test: no react-native / RTL import, so it runs under any node
// ts-jest env (the package has no RTL overlay). The tester writes the SECOND,
// adversarial render test on a different (data/parity) angle.

import fs from "fs";
import path from "path";

const brandPage = fs.readFileSync(
  path.join(__dirname, "..", "PublicBrandPage.tsx"),
  "utf8",
);
const types = fs.readFileSync(
  path.join(__dirname, "..", "types.ts"),
  "utf8",
);

describe("ORCH-1155 public brand page — Direction-A redesign", () => {
  test("T-4 composes the shared ParallaxCoverShell (no hand-rolled flat banner/chrome) — I-PROPOSED-1155-BRAND-USES-SHELL", () => {
    expect(brandPage).toContain("ParallaxCoverShell");
    expect(brandPage).toContain('from "@mingla/offering-rendering"');
    // the old flat hero + scroll + hand-rolled chrome are gone
    expect(brandPage).not.toContain("height: 380");
    expect(brandPage).not.toContain("paddingTop: 284");
    expect(brandPage).not.toContain("floatingChrome");
    expect(brandPage).not.toContain("ChromeGlyph");
  });

  test("T-6 uses the SINGLE shared palette engine, not a file-local one — I-PROPOSED-1155-SINGLE-PALETTE-ENGINE", () => {
    expect(brandPage).toContain('from "@mingla/offering-rendering"');
    expect(brandPage).toContain("createThemePalette");
    expect(brandPage).toContain("offeringSurfaceStyles");
    // no second palette engine defined in this file
    expect(brandPage).not.toContain("const createThemePalette =");
    expect(brandPage).not.toContain("const contrastRatio =");
  });

  test("T-1 tab order is About-FIRST; the default is Upcoming when it exists (#4420 D-B2)", () => {
    // About is seeded as index 0 of the built tab list.
    expect(brandPage).toContain('const tabs: Tab[] = ["about"];');
    // issue #4420 wave 2 (D-B2) — the default tab is Upcoming whenever the
    // Upcoming tab exists, else About; a guest's own pick wins.
    expect(brandPage).toContain(
      'selectedTab ?? (hasUpcomingTab ? "upcoming" : "about")',
    );
    // offering tabs are pushed AFTER about
    const aboutSeed = brandPage.indexOf('const tabs: Tab[] = ["about"];');
    const firstPush = brandPage.indexOf('tabs.push("upcoming")');
    expect(aboutSeed).toBeGreaterThanOrEqual(0);
    expect(firstPush).toBeGreaterThan(aboutSeed);
  });

  test("T-2 offering tabs render ONLY when their bucket is non-empty — I-PROPOSED-1155-TABS-HIDE-WHEN-EMPTY", () => {
    expect(brandPage).toContain(
      'if (upcomingEvents.length > 0 || pastEvents.length > 0) tabs.push("events");',
    );
    expect(brandPage).toContain(
      'if (upcomingTrips.length > 0 || pastTrips.length > 0) tabs.push("trips");',
    );
    expect(brandPage).toContain(
      'if (experiences.length > 0) tabs.push("experiences");',
    );
  });

  // Issue #679 REWRITE [TEST-MOD-APPROVED #679] — Follow is now a REAL,
  // server-truth primitive (brand_follows + owner-only RLS), so the blanket
  // /\bfollow\b/i ban became a lie-preventer preventing the truth. The honesty
  // guard now pins the SHAPE of real Follow: callback-gated rendering and a
  // standing ban on fabricated subscriber / stats.followers UI.
  //
  // [TEST-MOD-APPROVED #3682] Follow / Following label chrome moved into
  // SharedFollowButton; optional host-fed followerCount caption is now real
  // (contract E), so the old in-page ternary + blanket \bfollowers\b ban are
  // retired. Gate + subscriber / stats.followers bans stay.
  test("T-5 Follow is REAL and callback-gated — no fabricated audience UI", () => {
    // The gate: Follow renders ONLY when the host provides the callback.
    expect(brandPage).toContain("callbacks.onToggleFollow");
    expect(brandPage).toContain("<BrandFollowControl");
    expect(brandPage).toContain("<SharedFollowButton");
    // Fabricated audience UI stays banned; host-fed followerCount captions OK.
    expect(brandPage).not.toMatch(/\bsubscrib/i);
    expect(brandPage).not.toMatch(/stats\.followers/);
  });

  test("conditional mute: showMute is gated on a VIDEO cover only", () => {
    expect(brandPage).toContain('showMute={coverType === "video"}');
  });

  test("T-7 experience card renders the REAL cover media type (not hardcoded 'image')", () => {
    // the prior bug hardcoded mediaType="image" on the experience card
    expect(brandPage).toContain("mediaType={experience.coverMediaType}");
    expect(brandPage).not.toContain('mediaType="image"');
    // the field exists on the shared type, fed by both data paths
    expect(types).toContain("coverMediaType: PublicMediaType | null;");
  });

  // [TEST-MOD-APPROVED #4111] D10 (Seth, 2026-10-25): the brand's email and
  // phone leave the public brand page; guests use the foot's Message card. The
  // About pane is tagline → bio only, and no mailto:/tel: link remains.
  test("About pane holds tagline → measured bio disclosure, with no contact rows (#4111 D10)", () => {
    expect(brandPage).toContain("const AboutTab");
    expect(brandPage).toContain("ClampedBio");
    expect(brandPage).toContain("<DeferredMeasuredTextDisclosure");
    expect(brandPage).not.toContain("mailto:");
    expect(brandPage).not.toContain("tel:");
    // tagline/bio are NO LONGER above the tabs (only inside AboutTab via ClampedBio)
    expect(brandPage).not.toContain("taglineCentered");
    expect(brandPage).not.toContain("bioLeadCentered");
  });

  // Issue #679 REWRITE [TEST-MOD-APPROVED #679] — the panel now carries the
  // gated BrandFollowControl between socials and Share (spec insertion point).
  test("desktop flyer actions carry Follow + Share + Next-up; NO contact-in-panel (#4420 wave 2)", () => {
    // issue #4420 wave 2 — the boxed sticky panel became the actions under
    // the premium flyer: Follow, the Share / Message ghost row, the socials,
    // and the Next-up glass bar.
    expect(brandPage).not.toContain("stickyPanel=");
    expect(brandPage).toContain("deskShareBtn");
    const panelStart = brandPage.indexOf("const flyerActions = isDesktop");
    expect(panelStart).toBeGreaterThan(-1);
    const panelSrc = brandPage.slice(panelStart, panelStart + 900);
    expect(panelSrc).toContain("followControl(true)");
    expect(panelSrc).toContain("DeskShareRow");
    expect(panelSrc).toContain("nextUpBar");
    expect(panelSrc).not.toContain("mailto:");
  });

  test("stays anon-safe — no direct .from(\"brands\") select", () => {
    expect(brandPage).not.toContain('.from("brands")');
  });
});
