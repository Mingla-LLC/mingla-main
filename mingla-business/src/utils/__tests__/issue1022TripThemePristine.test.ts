import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

/**
 * #1022 B-3 — Trip Step 1 pristine check must compare the theme and the four
 * ORCH-1016 departure fields.
 *
 * Covers SPEC test case T-10.
 *
 * The pristine check gates the discard dialog. Before this build it compared
 * neither the four `departure*` fields nor (once theme joined step1Draft) the
 * theme — so "open the wizard, pick a colour, tap X" was a SILENT DISCARD
 * path: the work vanished with no confirmation.
 *
 * WHY THIS IS A SOURCE GATE, not a behavioural mount:
 * `isTripWizardPristine` lives in TripCreatorWizard.tsx, which transitively
 * imports react-native. The default jest project (jest.config.cjs) is
 * node/ts-jest with NO react-native transform — importing the wizard throws
 * "Cannot use import statement outside a module" on RN's index.js.flow. The
 * repo's own precedent for asserting logic inside a JSX-bearing module under
 * this config is to read the source as TEXT (see the note in jest.config.cjs:
 * "The existing carousel .tsx tests read source as TEXT (readFileSync)").
 * The behavioural mount belongs to the tester under a dedicated RN render
 * config — flagged in the implementation report.
 *
 * Fails-on-revert target: remove the themeOverrides comparison or any of the
 * four departure comparisons from isTripWizardPristine and this goes red.
 */

const wizardSource = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/trip/TripCreatorWizard.tsx"),
    "utf8",
  );

/** Extract just the body of isTripWizardPristine so assertions are scoped. */
const pristineBody = (): string => {
  const src = wizardSource();
  const start = src.indexOf("export function isTripWizardPristine(");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n}", src.indexOf("return true;", start));
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
};

describe("T-10 — theme participates in the Trip pristine check", () => {
  test("the pristine body compares themeOverrides on BOTH sides, normalised", () => {
    const body = pristineBody();
    expect(body).toContain("normalizeThemeOverrides(step1Draft.themeOverrides)");
    expect(body).toContain("normalizeThemeOverrides(initStep1.themeOverrides)");
  });

  test("the theme comparison is a real inequality that can return false", () => {
    const body = pristineBody();
    // The comparison must be wired into the early-return chain, not dangling.
    expect(body).toMatch(
      /JSON\.stringify\(normalizeThemeOverrides\(step1Draft\.themeOverrides\)\)\s*!==/,
    );
  });

  test("Step1Draft carries themeOverrides so the wizard can hold a pick", () => {
    const step1 = readFileSync(
      path.join(process.cwd(), "src/components/trip/TripCreatorStep1Basics.tsx"),
      "utf8",
    );
    expect(step1).toMatch(/themeOverrides:\s*ThemeInput \| null;/);
  });

  test("tripToStep1Draft seeds themeOverrides from the persisted trip", () => {
    const src = wizardSource();
    const start = src.indexOf("export function tripToStep1Draft(");
    const body = src.slice(start, src.indexOf("\n}", start));
    expect(body).toContain("normalizeThemeOverrides(trip.themeOverrides)");
  });
});

describe("T-10 — the four departure fields are compared (B-3)", () => {
  test.each([
    "departurePlaceId",
    "departureLocationText",
    "departureLat",
    "departureLng",
  ])("the pristine body compares %s", (field) => {
    const body = pristineBody();
    expect(body).toContain(`step1Draft.${field} !== initStep1.${field}`);
  });
});

describe("T-10 — the trip theme write is sequenced AFTER the basics mutation", () => {
  test("patchOfferingTheme is called after updateBasicsMutation.mutateAsync resolves", () => {
    const src = wizardSource();
    const start = src.indexOf("const autosaveStep1 = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("const autosaveStep2", start));

    const mutateAt = body.indexOf("await updateBasicsMutation.mutateAsync(");
    const themeAt = body.indexOf("await patchOfferingTheme(");
    expect(mutateAt).toBeGreaterThan(-1);
    expect(themeAt).toBeGreaterThan(-1);
    // Ordering is load-bearing: updateTripBasics read-modify-writes the whole
    // `theme` JSONB across two round-trips. Writing the columns first would
    // put them inside that race.
    expect(themeAt).toBeGreaterThan(mutateAt);
  });

  test("the trip theme write targets the COLUMNS, never the theme JSONB", () => {
    const src = wizardSource();
    const start = src.indexOf("const autosaveStep1 = useCallback(");
    const body = src.slice(start, src.indexOf("const autosaveStep2", start));
    expect(body).toContain("patchOfferingTheme({");
    expect(body).not.toMatch(/theme:\s*\{[^}]*color/);
  });
});
