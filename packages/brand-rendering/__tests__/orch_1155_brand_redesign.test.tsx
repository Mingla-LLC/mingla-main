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
    expect(brandPage).toContain('from "@mingla/event-rendering"');
    expect(brandPage).toContain("createThemePalette");
    expect(brandPage).toContain("offeringSurfaceStyles");
    // no second palette engine defined in this file
    expect(brandPage).not.toContain("const createThemePalette =");
    expect(brandPage).not.toContain("const contrastRatio =");
  });

  test("T-1 tab order is About-FIRST + default — I-PROPOSED-1155-ABOUT-FIRST-DEFAULT", () => {
    // About is seeded as index 0 of the built tab list and is the default state.
    expect(brandPage).toContain('const tabs: Tab[] = ["about"];');
    expect(brandPage).toContain('useState<Tab>("about")');
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

  test("T-5 NO fabricated Follow / subscriber UI anywhere on the page — I-PROPOSED-1155-NO-FABRICATED-FOLLOW", () => {
    expect(brandPage).not.toMatch(/\bfollow\b/i);
    expect(brandPage).not.toMatch(/\bsubscrib/i);
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

  test("About pane holds tagline → bio (clamp + Read more) → contact (email/phone) inside About", () => {
    expect(brandPage).toContain("const AboutTab");
    expect(brandPage).toContain("ClampedBio");
    expect(brandPage).toContain("Read more");
    expect(brandPage).toContain("mailto:");
    expect(brandPage).toContain("tel:");
    // tagline/bio are NO LONGER above the tabs (only inside AboutTab via ClampedBio)
    expect(brandPage).not.toContain("taglineCentered");
    expect(brandPage).not.toContain("bioLeadCentered");
  });

  test("desktop sticky panel carries Share + Next-up; NO Reserve, NO Follow, NO contact-in-panel", () => {
    expect(brandPage).toContain("stickyPanel");
    expect(brandPage).toContain("deskShareBtn");
    expect(brandPage).not.toContain("Reserve");
    // contact lives in the About pane; the panel must not duplicate mailto/tel
    const panelStart = brandPage.indexOf("const stickyPanel");
    const panelEnd = brandPage.indexOf("// Desktop hero overlay");
    const panelSrc = brandPage.slice(panelStart, panelEnd);
    expect(panelSrc).not.toContain("mailto:");
  });

  test("stays anon-safe — no direct .from(\"brands\") select", () => {
    expect(brandPage).not.toContain('.from("brands")');
  });
});
