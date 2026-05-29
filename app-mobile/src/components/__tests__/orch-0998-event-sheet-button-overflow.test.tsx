// @ts-nocheck
/**
 * ORCH-0998 [Ticketmaster expanded event sheet — text bleeds out of buttons;
 * make them premium + compact] — implementor happy-path regression test.
 *
 * Bug: the secondary action row on the external/Ticketmaster expanded event
 * sheet (Save / Share / Add to Calendar) rendered three `flex: 1` chips whose
 * `<Text>` labels had NO overflow protection (no numberOfLines, no
 * adjustsFontSizeToFit, no flexShrink). The long "Add to Calendar" label (and
 * its longer translations) bled past the rounded chip border.
 *
 * Fix (EventDetailLayout.tsx):
 *   1. All three chip labels now clamp to one line with adjustsFontSizeToFit +
 *      minimumFontScale={0.85}.
 *   2. The calendar chip's VISIBLE label is the new short i18n key
 *      `cards:expanded.calendar` ("Calendar"); the full localized
 *      `cards:expanded.add_to_calendar` is preserved as the accessibilityLabel.
 *   3. The chip text style gained flexShrink/minWidth/textAlign for a compact,
 *      no-bleed layout, and the chips were tightened (height 38) for a premium
 *      look.
 *
 * This is a source-assertion test (the established app-mobile regression
 * pattern — see orch-0994-business-event-card-video-cover.test.tsx). It asserts
 * the rendering contract at the source level so it runs without RN render infra.
 *
 * Run directly:  node app-mobile/src/components/__tests__/orch-0998-event-sheet-button-overflow.test.tsx
 * Fails-on-revert proof: point ORCH_0998_LAYOUT_SRC at the pre-fix file.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function resolveLayoutSrc() {
  const override = process.env.ORCH_0998_LAYOUT_SRC;
  if (override) return override;
  const rel = "src/components/expandedCard/EventDetailLayout.tsx";
  const direct = path.resolve(process.cwd(), rel);
  if (fs.existsSync(direct)) return direct;
  return path.resolve(process.cwd(), "app-mobile", rel);
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function runOrch0998Happy() {
  const src = fs.readFileSync(resolveLayoutSrc(), "utf8");

  // [FAILS-ON-REVERT KEY] T-01: all THREE secondary chips clamp their label
  // with minimumFontScale={0.85}. The pre-fix code had none → count 0 → fails.
  assert.equal(
    countOccurrences(src, "minimumFontScale={0.85}"),
    3,
    "EventDetailLayout must clamp all 3 secondary chip labels with minimumFontScale={0.85}",
  );

  // T-02: the clamp pairs adjustsFontSizeToFit with each minimumFontScale, and
  // the primary CTA's own clamp (minimumFontScale={0.8}) is left intact, so the
  // file carries >= 4 adjustsFontSizeToFit (3 chips + 1 CTA).
  assert.ok(
    countOccurrences(src, "adjustsFontSizeToFit") >= 4,
    "all 3 secondary chips (plus the CTA) must use adjustsFontSizeToFit",
  );

  // [FAILS-ON-REVERT KEY] T-03: the calendar chip's VISIBLE label is the new
  // short key. The pre-fix code rendered the long `expanded.add_to_calendar`
  // as the visible label → this assertion fails on revert.
  assert.ok(
    src.includes('{t("cards:expanded.calendar")}'),
    'the calendar chip must render the short visible label t("cards:expanded.calendar")',
  );

  // T-04: accessibility is NOT sacrificed for compactness — the full localized
  // phrase is preserved as the accessibilityLabel.
  assert.ok(
    src.includes('accessibilityLabel={t("cards:expanded.add_to_calendar")}'),
    "the full localized add_to_calendar phrase must remain the accessibilityLabel",
  );

  // T-05: the chip text style carries the no-bleed / compact contract.
  assert.match(
    src,
    /secondaryChipText:\s*\{[^}]*flexShrink:\s*1[^}]*\}/s,
    "secondaryChipText must set flexShrink: 1 so a long label can never push past the chip",
  );
  assert.match(
    src,
    /secondaryChipText:\s*\{[^}]*textAlign:\s*"center"[^}]*\}/s,
    "secondaryChipText must center its (possibly shrunk) label",
  );

  // T-06: the chips are compact (premium pass tightened height to 38).
  assert.match(
    src,
    /secondaryChip:\s*\{[^}]*height:\s*38[^}]*\}/s,
    "secondaryChip must be the compact height: 38",
  );

  console.log("ORCH-0998 implementor happy-path: PASS (6 assertions)");
}

runOrch0998Happy();

// Jest-visible wrapper (also runs as a plain node script).
if (typeof describe === "function") {
  describe("ORCH-0998: expanded event sheet buttons clamp + compact", () => {
    it("clamps all 3 chip labels, uses the short Calendar key, keeps a11y", () => {
      runOrch0998Happy();
    });
  });
}
