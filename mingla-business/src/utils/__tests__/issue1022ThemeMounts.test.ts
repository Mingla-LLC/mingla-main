import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

/**
 * #1022 — the Theme control is REACHABLE from every surface it was missing on.
 *
 * The original complaint: theming was only reachable when EDITING, so a
 * brand-new event/RSVP/trip/experience was published on the default theme and
 * could only be themed after publishing.
 *
 * Covers the six mounts (M1-M6), the three review-step rows, and the geometry
 * contract (C-9/C-10): the row is WIDTH-AGNOSTIC and self-caps on wide desktop.
 *
 * Source gates — see the note in issue1022ThemeSheetLayout.test.ts.
 */

const src = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const ROW = "src/components/theme/ThemeControlRow.tsx";

describe("the six mounts — theme is reachable while CREATING, not only after publishing", () => {
  test.each([
    // M1 + M2 + M3 — one file serves the Event wizard, the RSVP wizard and
    // EditPublishedScreen's cover section (they all render this step).
    ["M1/M2 Event + RSVP cover step", "src/components/event/CreatorStep4Cover.tsx"],
    ["M4 Trip Step 1 Basics", "src/components/trip/TripCreatorStep1Basics.tsx"],
    ["M5 Experience cover step", "src/components/experience/ExperienceCoverStep.tsx"],
    ["M6 BrandEditView", "src/components/brand/BrandEditView.tsx"],
    ["M3 EditPublishedScreen", "src/components/event/EditPublishedScreen.tsx"],
  ])("%s mounts the Theme row", (_label, file) => {
    expect(src(file)).toContain("<ThemeControlRow");
  });

  test.each([
    ["Event Preview step", "src/components/event/CreatorStep7Preview.tsx"],
    ["RSVP Preview step", "src/components/rsvp/RsvpStep7Preview.tsx"],
    ["Trip Review step", "src/components/trip/TripCreatorStep5Review.tsx"],
  ])('%s mounts a variant="review" row', (_label, file) => {
    const s = src(file);
    expect(s).toContain("<ThemeControlRow");
    expect(s).toMatch(/variant="review"/);
  });

  test("every offering mount passes scope='offering'; only the brand page passes 'brand'", () => {
    for (const file of [
      "src/components/event/CreatorStep4Cover.tsx",
      "src/components/trip/TripCreatorStep1Basics.tsx",
      "src/components/experience/ExperienceCoverStep.tsx",
      "src/components/event/CreatorStep7Preview.tsx",
      "src/components/rsvp/RsvpStep7Preview.tsx",
      "src/components/trip/TripCreatorStep5Review.tsx",
    ]) {
      expect(src(file)).toContain('scope="offering"');
    }
    const brand = src("src/components/brand/BrandEditView.tsx");
    expect(brand).toContain('scope="brand"');
    expect(brand).not.toContain('scope="offering"');
  });

  test("EditPublishedScreen does not render the row twice", () => {
    // Its Visual section hosts the row, so the shared cover step must suppress
    // its own copy there. Without this the edit screen shows Theme twice.
    const s = src("src/components/event/EditPublishedScreen.tsx");
    expect(s).toContain("showThemeRow={false}");
  });

  test("the Experience mount receives a STABLE onThemeChange (memo safety)", () => {
    // ExperienceCoverStep is React.memo'd specifically to survive the
    // META-ORCH-1059 cover-freeze fix. An inline lambda breaks the memo and
    // re-reconciles two expo-video surfaces on every theme frame.
    const wizard = src("src/components/experience/ExperienceCreatorWizard.tsx");
    expect(wizard).toContain("onThemeChange={handleThemeChange}");
    expect(wizard).toMatch(
      /const handleThemeChange = useCallback\(\(next: ThemeInput \| null\): void => \{[\s\S]*?\}, \[\]\);/,
    );
  });
});

describe("C-1 — every mount resolves the theme with the BRAND in the first slot", () => {
  test.each([
    ["ThemeControlRow", ROW],
    ["ThemeSheet", "src/components/theme/ThemeSheet.tsx"],
    ["themeColorModel", "src/components/theme/themeColorModel.ts"],
    ["Event preview", "src/components/event/CreatorStep7Preview.tsx"],
    ["RSVP preview", "src/components/rsvp/RsvpStep7Preview.tsx"],
  ])("%s never passes the offering override into the brand slot", (_label, file) => {
    const s = src(file);
    // The shipped C-1 bug was literally `resolveTheme(value ?? null, null)` on
    // an OFFERING-scoped mount.
    const offendingCalls = s.match(/resolveTheme\(\s*value\s*\?\?\s*null\s*,\s*null\s*\)/g) ?? [];
    if (offendingCalls.length > 0) {
      // Permitted ONLY under scope==="brand", where the brand theme
      // legitimately occupies that slot.
      expect(s).toContain('scope === "brand"');
    }
    // and the offering path must put brandTheme first
    if (s.includes("resolveTheme(")) {
      expect(s).toMatch(/resolveTheme\(\s*brandTheme/);
    }
  });
});

describe("A/F-12 — the review previews render the THEMED palette, not accent.warm", () => {
  test.each([
    ["Event preview", "src/components/event/CreatorStep7Preview.tsx"],
    ["RSVP preview", "src/components/rsvp/RsvpStep7Preview.tsx"],
  ])("%s paints the mini-card from createThemePalette", (_label, file) => {
    const s = src(file);
    expect(s).toContain("createThemePalette");
    // the date line was the hardcoded accent.warm offender
    expect(s).toMatch(/color: themePalette\.accent/);
    expect(s).toMatch(/backgroundColor: themePalette\.page/);
  });
});

describe("C-9 / C-10 — geometry: width-agnostic, self-capping", () => {
  test("the row never hardcodes a width — it renders at 342, 358 and 310", () => {
    const s = src(ROW);
    // A fixed width would break at least two of its three hosts.
    expect(s).not.toMatch(/width:\s*342/);
    expect(s).not.toMatch(/width:\s*358/);
    expect(s).not.toMatch(/width:\s*310/);
  });

  test("the text block is flex:1 and truncates TAIL-first", () => {
    const s = src(ROW);
    expect(s).toMatch(/textBlock:\s*\{[\s\S]*?flex:\s*1/);
    expect(s).toContain('ellipsizeMode="tail"');
    expect(s).toContain("numberOfLines={1}");
  });

  test("the row self-caps at 560pt on wide desktop, left-aligned", () => {
    // Neither edit surface has a desktopFormPane to inherit from (C-9).
    const s = src(ROW);
    // The cap is a named constant, asserted at its value so a silent widening
    // fails here rather than only showing up on a 1440px screen.
    expect(s).toMatch(/const DESKTOP_MAX_WIDTH = 560;/);
    expect(s).toMatch(/maxWidth:\s*DESKTOP_MAX_WIDTH/);
    expect(s).toMatch(/alignSelf:\s*"flex-start"/);
  });

  test("the desktop gate goes through useResponsiveLayout, never a raw width compare", () => {
    // I-DESKTOP-GATE-VIA-HOOK
    const s = src(ROW);
    expect(s).toContain("useResponsiveLayout()");
    expect(s).not.toMatch(/width\s*[><]=?\s*1024/);
  });

  test("Android uses the opaque composites with NO elevation", () => {
    const s = src(ROW);
    expect(s).toContain("androidOpaque.rowFill");
    expect(s).toContain("androidOpaque.rowBorder");
    expect(s).toMatch(/elevation:\s*0/);
  });

  test("androidOpaque ALIASES the existing constant — no third copy of the literal", () => {
    // B-27: #16181b already exists as ariThread.ariBubbleAndroid.
    const ds = src("src/constants/designSystem.ts");
    expect(ds).toMatch(/rowFill:\s*ariThread\.ariBubbleAndroid/);
  });

  test("the chip shows the DERIVED palette, never the raw seed", () => {
    // createThemePalette transforms a seed substantially (#eb7825 -> accent
    // #ae591c on page #1e120d; #16a34a produces a LIGHT page). A chip painted
    // with the raw hex would misrepresent what the guest sees.
    const s = src(ROW);
    expect(s).toContain("createThemePalette");
    expect(s).toMatch(/backgroundColor: palette\.accent/);
  });
});
