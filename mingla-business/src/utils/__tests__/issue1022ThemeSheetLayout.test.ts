import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

/**
 * #1022 — the two defect classes that are properties of the SHEET:
 * OFF-SCREEN / OVERFLOW and KEYBOARD OCCLUSION.
 *
 * Covers SPEC test cases T-14 (sheet body scroll bounded), T-15 (two-sheet
 * stacking prevented), T-19 (zero eager font loads), T-27 (disabled row) and
 * the motion-tab single-Lottie rule.
 *
 * WHY SOURCE GATES: every host is a JSX module that transitively imports
 * react-native; the default jest project is node/ts-jest with no RN transform.
 * The repo's own precedent for asserting structure inside such modules is
 * readFileSync (see jest.config.cjs). A real mounted render belongs to the
 * tester under a dedicated RN render config — and the on-device proof of the
 * scroll/keyboard behaviour can ONLY be obtained at runtime.
 *
 * Fails-on-revert target: drop `style={styles.bodyScroll}` (the flex:1 bound)
 * or swap SmartScrollView for a bare RN ScrollView and this goes red.
 */

const src = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const SHEET = "src/components/theme/ThemeSheet.tsx";

describe("T-14 — the sheet body is flex-bounded, so the footer stays reachable", () => {
  test("the tab body imports its ScrollView from wrappers/SmartScrollView", () => {
    // SheetMobile supplies NO scrolling of its own; the consumer must bring it.
    // SmartScrollView is also what lifts the focused hex field above the
    // keyboard + the 42pt Done bar (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE).
    expect(src(SHEET)).toContain('from "../../wrappers/SmartScrollView"');
  });

  test("a `bodyScroll` style exists and carries flex: 1", () => {
    // Without flex:1 the scroll box grows past the fixed-height,
    // overflow:hidden panel and `Done` becomes permanently unreachable
    // (the ORCH-1193 bug). The designed content leaves ~20pt of slack.
    expect(src(SHEET)).toMatch(/bodyScroll:\s*\{\s*flex:\s*1\s*\}/);
  });

  test("the flex-bounded style is actually APPLIED to the body ScrollView", () => {
    expect(src(SHEET)).toMatch(/<ScrollView\s+style=\{styles\.bodyScroll\}/);
  });

  test("the body ScrollView keeps taps working while the keyboard is up", () => {
    expect(src(SHEET)).toContain('keyboardShouldPersistTaps="handled"');
  });

  test("the footer is a SIBLING of the scroll body, not inside it", () => {
    const s = src(SHEET);
    const scrollEnd = s.indexOf("</ScrollView>");
    const footer = s.indexOf("<View style={styles.footer}>");
    expect(scrollEnd).toBeGreaterThan(-1);
    expect(footer).toBeGreaterThan(scrollEnd);
  });
});

describe("keyboard — the hex field can never be occluded", () => {
  test("the hex input carries the ORCH-0964 input props", () => {
    const s = src(SHEET);
    expect(s).toContain('autoCapitalize="none"');
    expect(s).toContain("autoCorrect={false}");
    expect(s).toContain("maxLength={7}");
    expect(s).toContain('accessibilityLabel="Hex colour code"');
  });

  test("the hex draft is SEPARATE state, never bound to the committed value", () => {
    const s = src(SHEET);
    // Binding the field to the committed value is what collapsed char-by-char
    // typing in ORCH-0964.
    expect(s).toMatch(/value=\{hexDraft\}/);
    expect(s).not.toMatch(/value=\{value\?\.color/);
  });

  test("short-hex expansion happens on BLUR only, never on keystroke", () => {
    const s = src(SHEET);
    expect(s).toMatch(/onChangeText=\{handleHexChange\}/);
    // handleHexChange must use the strict 6-digit gate...
    const change = s.slice(
      s.indexOf("const handleHexChange"),
      s.indexOf("const handleHexBlur"),
    );
    expect(change).toContain("normalizeHexColor(raw)");
    expect(change).not.toContain("normalizeHexColorOnBlur");
    // ...and only the blur path may expand.
    const blur = s.slice(
      s.indexOf("const handleHexBlur"),
      s.indexOf("const pickSwatch"),
    );
    expect(blur).toContain("normalizeHexColorOnBlur");
  });
});

describe("T-15 — two sheets can never stack (A/F-13)", () => {
  test.each([
    ["Event/RSVP/EditPublished cover", "src/components/event/CreatorStep4Cover.tsx"],
    ["Trip Step 1", "src/components/trip/TripCreatorStep1Basics.tsx"],
    ["Experience cover", "src/components/experience/ExperienceCoverStep.tsx"],
  ])("%s holds ONE discriminated sheet state, not two booleans", (_label, file) => {
    const s = src(file);
    expect(s).toMatch(
      /useState<"none" \| "cover" \| "theme">\("none"\)/,
    );
    // Opening one closes the other BY CONSTRUCTION — no timeout sequencing,
    // which would race the 240ms close animation / 280ms unmount delay.
    expect(s).toContain('activeSheet === "theme"');
    expect(s).toContain('activeSheet === "cover"');
  });

  test("every host mounts the theme sheet as a JSX child of its own root View", () => {
    // I-SUB-SHEET-INSIDE-PARENT
    for (const file of [
      "src/components/event/CreatorStep4Cover.tsx",
      "src/components/trip/TripCreatorStep1Basics.tsx",
      "src/components/experience/ExperienceCoverStep.tsx",
    ]) {
      const s = src(file);
      const sheetAt = s.indexOf("<ThemeSheet");
      const closeAt = s.lastIndexOf("</View>");
      expect(sheetAt).toBeGreaterThan(-1);
      expect(sheetAt).toBeLessThan(closeAt);
    }
  });
});

describe("T-19 — browsing fonts loads ZERO typefaces (ORCH-1083)", () => {
  test("the sheet has exactly ONE useThemeFont call site", () => {
    const s = src(SHEET);
    const calls = s.match(/useThemeFont\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  test("that call site loads only the RESOLVED (selected) family", () => {
    expect(src(SHEET)).toContain("useThemeFont(resolved.fontFamilyValue)");
  });

  test("no specimen sets fontFamily — that is what would trigger a load", () => {
    // CODE only: the file deliberately NAMES fontFamily in its docblock to
    // explain why it is absent. Matching that would be a false positive.
    const specimens = src("src/components/theme/fontSpecimens/index.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(specimens).not.toContain("fontFamily");
  });

  test("every one of the 14 token slugs has a specimen, and vice versa", () => {
    // Parity in BOTH directions: a token without a specimen renders a blank
    // row; a specimen without a token is dead weight.
    const specimens = src("src/components/theme/fontSpecimens/index.ts");
    const tokens = src("../packages/offering-rendering/designTokens.ts");
    const slugs =
      tokens
        .slice(tokens.indexOf("THEME_FONT_SLUGS"), tokens.indexOf("THEME_ANIMATION_SLUGS"))
        .match(/"([a-z_]+)"/g) ?? [];
    expect(slugs.length).toBe(14);
    for (const quoted of slugs) {
      const slug = quoted.replace(/"/g, "");
      expect(specimens).toContain(`  ${slug}: specimen(`);
    }
  });
});

describe("motion — exactly one Lottie instance is ever alive", () => {
  test("the sheet renders ThemeEntranceAnimation exactly once, in the preview band", () => {
    const s = src(SHEET);
    const instances = s.match(/<ThemeEntranceAnimation/g) ?? [];
    expect(instances).toHaveLength(1);
  });

  test("motion tiles are STATIC — no Lottie inside the grid", () => {
    const s = src(SHEET);
    const grid = s.slice(s.indexOf("styles.motionGrid"), s.indexOf("</View>\n      ) : null}\n      </ScrollView>"));
    expect(grid).not.toContain("ThemeEntranceAnimation");
  });

  test("the web build shows the app-only truth banner", () => {
    const s = src(SHEET);
    expect(s).toContain('Platform.OS === "web"');
    expect(s).toContain("Entrance motion plays in the Mingla apps");
  });

  test("'none' renders as 'No motion', never 'None'", () => {
    const model = src("src/components/theme/themeColorModel.ts");
    expect(model).toMatch(/none:\s*"No motion"/);
  });
});

describe("T-27 — the row honours `disabled` (B-13)", () => {
  test("Trip Step 1 passes submitting through to the row", () => {
    const s = src("src/components/trip/TripCreatorStep1Basics.tsx");
    expect(s).toMatch(/<ThemeControlRow[\s\S]*?disabled=\{disabled\}/);
  });

  test("an open theme sheet is force-closed when the step becomes disabled", () => {
    // A theme write during publish could otherwise land inside
    // handleConfirmPublish's artificial 1200ms window.
    const s = src("src/components/trip/TripCreatorStep1Basics.tsx");
    expect(s).toMatch(/if \(disabled && activeSheet === "theme"\) setActiveSheet\("none"\)/);
  });

  test("the row makes itself non-tappable and dimmed when disabled", () => {
    const s = src("src/components/theme/ThemeControlRow.tsx");
    expect(s).toContain("onPress={disabled ? undefined : onPress}");
    expect(s).toContain("accessibilityState={{ disabled }}");
    expect(s).toMatch(/rowDisabled:\s*\{\s*opacity:\s*0\.5/);
  });
});

describe("gesture safety — coordination stays forbidden inside the sheet", () => {
  test("the sheet uses its own Pan gestures with NO coordination APIs", () => {
    const s = src(SHEET)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const api of [
      "Gesture.Simultaneous",
      "Gesture.Native",
      "simultaneousWithExternalGesture",
      "blocksExternalGesture",
    ]) {
      expect(s).not.toContain(api);
    }
  });
});
