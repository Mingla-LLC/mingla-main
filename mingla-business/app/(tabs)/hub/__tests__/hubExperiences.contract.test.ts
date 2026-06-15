/**
 * ORCH-1144 — experience parsers are venue-category-agnostic; both reachable by
 * every brand. This contract FAILS if the deleted `venueCategory` router or the
 * `canGenerate*` predicates return to the create surface, and asserts the new
 * 3-option chooser exposes all three paths unconditionally.
 *
 * (Was: a test asserting the EXACT `venueCategory === "restaurant"/"play"` +
 * `canGenerateExperiencesFromActivities` branch this ORCH removed.)
 *
 * See I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const EXPERIENCES_ROUTE = join(__dirname, "..", "experiences.tsx");
// ORCH-1144 UX refinement — the 3-option experience chooser was folded INTO
// UniversalCreatorSheet (step "experience"); the standalone
// ExperienceCreateChooser.tsx was retired. The chooser contract now reads the
// in-sheet EXPERIENCE_OPTIONS in UniversalCreatorSheet.tsx.
const CHOOSER = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "src",
  "components",
  "ui",
  "UniversalCreatorSheet.tsx",
);

describe("hub/experiences create surface (ORCH-1144)", () => {
  const source = readFileSync(EXPERIENCES_ROUTE, "utf8");

  test("create surface has NO venueCategory parser gate", () => {
    expect(source).not.toMatch(/venueCategory === "restaurant"/);
    expect(source).not.toMatch(/venueCategory === "play"/);
    expect(source).not.toMatch(/canGenerateExperiencesFrom/);
  });

  test("the Experiences tab is a pilled list (no snap banner here)", () => {
    // The pill ScrollView MUST carry flexGrow:0 (double-ScrollView footgun).
    expect(source).toMatch(/flexGrow:\s*0/);
    expect(source).toMatch(/pillsScroll/);
    // The old "Snap your menu to generate experiences" banner is gone.
    expect(source).not.toMatch(/Snap your menu to generate experiences/);
  });
});

describe("experience-create chooser (ORCH-1144)", () => {
  const chooser = readFileSync(CHOOSER, "utf8");

  test("offers all three options unconditionally", () => {
    expect(chooser).toMatch(/parseMode/i); // food/activities route literals
    expect(chooser).toMatch(/\?mode=menu/);
    expect(chooser).toMatch(/\?mode=activities/);
    expect(chooser).toMatch(/experience-chooser-food/);
    expect(chooser).toMatch(/experience-chooser-activities/);
    expect(chooser).toMatch(/experience-chooser-manual/);
  });

  test("chooser does not branch on venueCategory", () => {
    // No category equality branch and no brand.venueCategory read — the chooser
    // shows all three rows unconditionally (prose comments mentioning the word
    // are fine; an actual gate is not).
    expect(chooser).not.toMatch(/venueCategory ===/);
    expect(chooser).not.toMatch(/\.venueCategory/);
    expect(chooser).not.toMatch(/canGenerateExperiencesFrom/);
  });
});
