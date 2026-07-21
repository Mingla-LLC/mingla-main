import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

/**
 * #1036 — the readability-advisory apparatus is removed from the colour tab.
 *
 * Seth's decision (issue #1036, 2026-07-21): "we can remove it, the preview
 * already shows which is ok, no need to confuse the user." The live preview
 * band is now the SOLE readability signal. This suite pins the removal of the
 * three parts that went, and the survival of the controls that stayed.
 *
 * REMOVED (must be ABSENT from ThemeSheet.tsx):
 *   1. the three-tier contrast chip ("AA · Crisp" / warn / "Hard to read")
 *      and its tap-to-nudge press handler,
 *   2. the "Nudge to AA" affordance,
 *   3. the seed->derived disclosure ("On the page this becomes … so labels
 *      stay readable") and its raw-hex print,
 *   plus the now-dead supporting logic (contrastTier / nudgeToAA imports,
 *   nudgeTarget / seedVsDerived locals) and the orphaned chip/disclosure styles.
 *
 * KEPT (must remain PRESENT):
 *   the S/V plane, hue rail, hex field, swatches/presets, the live preview
 *   band, the Done footer, and — load-bearing (ORCH-1193) — the flex-bounded
 *   SmartScrollView body.
 *
 * WHY A SOURCE GATE: ThemeSheet.tsx transitively imports react-native; the
 * default node/ts-jest project has no RN render transform, so the repo's own
 * precedent for asserting structure inside this exact module is readFileSync
 * (see issue1022ThemeSheetLayout.test.ts / jest.config.cjs). A real mounted
 * render belongs to the tester under a dedicated RN render config.
 *
 * FAILS-ON-REVERT: restore the contrast chip / Nudge / disclosure JSX (or the
 * contrastTier/nudgeToAA imports) and the "must be ABSENT" assertions below go
 * red. Verified by true line-restoration during implementation.
 */

const src = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const SHEET = "src/components/theme/ThemeSheet.tsx";

describe("#1036 — the contrast chip is gone", () => {
  const sheet = src(SHEET);

  test("the contrast-chip style and its three tier variants are removed", () => {
    expect(sheet).not.toContain("contrastChip");
    expect(sheet).not.toContain("chipPass");
    expect(sheet).not.toContain("chipWarn");
    expect(sheet).not.toContain("chipFail");
    expect(sheet).not.toContain("chipLabel");
  });

  test("the chip's user-facing tier copy is gone", () => {
    expect(sheet).not.toContain("AA · Crisp");
    expect(sheet).not.toContain("Hard to read");
    expect(sheet).not.toContain("Small labels look faint");
    expect(sheet).not.toContain("Crisp");
    expect(sheet).not.toContain("Faint");
  });
});

describe("#1036 — the Nudge-to-AA affordance is gone", () => {
  const sheet = src(SHEET);

  test("no 'Nudge to AA' label and no nudge press wiring", () => {
    expect(sheet).not.toContain("Nudge to AA");
    expect(sheet).not.toContain("Tap to nudge to AA");
    expect(sheet).not.toContain("nudgeTarget");
  });

  test("the now-dead contrast/nudge helpers are no longer imported or computed", () => {
    expect(sheet).not.toContain("nudgeToAA");
    expect(sheet).not.toContain("contrastTier");
    // contrastRatio was imported ONLY to feed the removed chip/disclosure.
    expect(sheet).not.toContain("contrastRatio");
    // the debounced tier-announcement effect and its constant are gone too.
    expect(sheet).not.toContain("ANNOUNCE_DEBOUNCE_MS");
    expect(sheet).not.toContain("announceForAccessibility");
  });
});

describe("#1036 — the seed->derived disclosure is gone", () => {
  const sheet = src(SHEET);

  test("no 'so labels stay readable' disclosure and no raw-hex print", () => {
    expect(sheet).not.toContain("so labels stay");
    expect(sheet).not.toContain("On the page this becomes");
    expect(sheet).not.toContain("seedVsDerived");
    expect(sheet).not.toContain("styles.disclosure");
    expect(sheet).not.toContain("disclosureDot");
    expect(sheet).not.toContain("disclosureText");
  });
});

describe("#1036 — the real colour controls survive", () => {
  const sheet = src(SHEET);

  test("S/V plane and hue rail are still rendered", () => {
    expect(sheet).toContain("planeGesture");
    expect(sheet).toContain("styles.plane");
    expect(sheet).toContain("railGesture");
    expect(sheet).toContain("styles.rail");
  });

  test("the hex field is still present", () => {
    expect(sheet).toContain("styles.hexInput");
    expect(sheet).toContain('accessibilityLabel="Hex colour code"');
    expect(sheet).toContain("handleHexChange");
  });

  test("the swatch strip (brand · recents · presets) is still present", () => {
    expect(sheet).toContain("SwatchDot");
    expect(sheet).toContain("THEME_PRESETS");
    expect(sheet).toContain("styles.swatchStrip");
  });

  test("the live preview band — now the sole readability signal — survives", () => {
    expect(sheet).toContain("styles.preview");
    expect(sheet).toContain("palette.accent");
    expect(sheet).toContain("Preview: your page with this theme");
  });

  test("the Done footer stays, so the sheet is dismissable", () => {
    expect(sheet).toContain('label="Done"');
    expect(sheet).toContain("styles.footer");
  });

  test("the load-bearing flex-bounded scroll body is untouched (ORCH-1193)", () => {
    expect(sheet).toContain("styles.bodyScroll");
    expect(sheet).toContain("SmartScrollView");
    expect(sheet).toContain("bodyScroll: { flex: 1 }");
  });

  test("the single colour write path (commitColor) is preserved", () => {
    expect(sheet).toContain("const commitColor = useCallback");
  });
});
