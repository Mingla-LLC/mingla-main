/**
 * Issue #1532 [stay-manager-ux] — the LAYOUT + DISMISSAL contracts, executed.
 *
 * WHY THIS FILE IS SHAPED LIKE THIS. The unfalsifiable test has shipped four
 * times in this exact workstream: a `maxWidth: undefined` assertion that was
 * true in both directions (#1484 P1-1), a regex that missed react-native-web's
 * trailing `;` and matched zero rules, a column model that read `320px` as
 * `320%`, and an injection regex that never matched at all. Every one was green
 * CI over a broken product.
 *
 * So this suite asserts on VALUES PRODUCED BY EXECUTING the shipped code, never
 * on the absence of something, and every claim carries a POSITIVE CONTROL: the
 * pre-#1532 shape is fed through the SAME function and shown to fail the SAME
 * assertion. A metric that cannot tell the old build from the new one is not
 * measuring anything, and that is precisely how the last four got through.
 *
 * Runs under the DEFAULT node/ts-jest config — i.e. inside the REQUIRED
 * `mingla-business jest suite` check, not a per-issue workflow that can be
 * skipped by a paths filter.
 */

import { spacing, typography } from "../../../constants/designSystem";
import {
  STAY_ACTION_BAR_HEIGHT,
  STAY_CHIP_ROW_MAX_HEIGHT,
  STAY_EDITOR_DISCARD_COPY,
  STAY_FIELD_PROXIMITY,
  STAY_FIELD_PROXIMITY_MIN_RATIO,
  STAY_PAGE_BOTTOM_PAD,
  STAY_SPACING,
  resolveStayEditorClose,
  stayChipRowHeight,
  stayEditorReadinessLabel,
  stayEditorTitle,
  stayFieldProximity,
  type StayEditorCloseSource,
} from "../stayLayoutContracts";

// ===========================================================================
// DEFECT 2 — the spacing scale that never rendered.
// ===========================================================================

describe("#1532 D2 — field proximity is no longer inverted", () => {
  /**
   * THE SHIPPED DEFECT, restated as arithmetic.
   *
   * `styles.form`'s 16pt field-to-field gap was declared on `GlassCard`'s
   * `style` prop, which lands on `GlassChrome`'s OUTER node — a node whose only
   * in-flow child is the clip view, because L1-L4 are `StyleSheet.absoluteFill`.
   * A gap with one child spaces nothing, so the RENDERED separation between two
   * stacked fields was 0.0pt (measured on an iPhone 17 Pro Max), while a field's
   * own label/helper/input sat 4pt apart.
   *
   * The result was REVERSED Gestalt proximity: an input was closer to the NEXT
   * field's label than to its own helper, so the eye grouped the wrong things.
   */
  const OLD_FIELD_GAP = spacing.xs; // 4 — one gap for label->helper AND helper->input
  const OLD_STACK_GAP = 0; // the 16pt that never reached the children

  it("D2-1 — POSITIVE CONTROL: the pre-#1532 scale really was inverted", () => {
    const before = stayFieldProximity({
      fieldGap: OLD_FIELD_GAP,
      stackGap: OLD_STACK_GAP,
    });
    // Not vacuous: the metric produced real, finite numbers on the old shape.
    expect(before.cohesionPt).toBeGreaterThan(0);
    expect(Number.isFinite(before.separationPt)).toBe(true);
    // …and it FAILS the contract the new scale must pass. Without this arm, a
    // ratio assertion could be satisfied by any two numbers and would prove
    // nothing about the change.
    expect(before.ratio).toBeLessThan(1);
    expect(before.ratio).toBeLessThan(STAY_FIELD_PROXIMITY_MIN_RATIO);
  });

  it("D2-2 — the shipped scale puts separation well above cohesion", () => {
    // Cohesion  = caption half-leading (2) + the field wrapper's gap  (8) = 10
    // Separation = the card CONTENT gap (24) + bodySm half-leading (3)  = 27
    const captionHalfLeading =
      (typography.caption.lineHeight - typography.caption.fontSize) / 2;
    const bodySmHalfLeading =
      (typography.bodySm.lineHeight - typography.bodySm.fontSize) / 2;

    expect(STAY_FIELD_PROXIMITY.cohesionPt).toBe(
      captionHalfLeading + STAY_SPACING.helperToInput,
    );
    expect(STAY_FIELD_PROXIMITY.separationPt).toBe(
      STAY_SPACING.fieldToFieldStacked + bodySmHalfLeading,
    );
    expect(STAY_FIELD_PROXIMITY.cohesionPt).toBe(10);
    expect(STAY_FIELD_PROXIMITY.separationPt).toBe(27);
    expect(Number(STAY_FIELD_PROXIMITY.ratio.toFixed(2))).toBe(2.7);
    expect(STAY_FIELD_PROXIMITY.ratio).toBeGreaterThanOrEqual(
      STAY_FIELD_PROXIMITY_MIN_RATIO,
    );
  });

  it("D2-3 — the scale is the approved 2 / 8 / 16 / 24 / 32, all real tokens", () => {
    expect({
      labelToHelper: STAY_SPACING.labelToHelper,
      helperToInput: STAY_SPACING.helperToInput,
      fieldToFieldInRow: STAY_SPACING.fieldToFieldInRow,
      fieldToFieldStacked: STAY_SPACING.fieldToFieldStacked,
      sectionToSection: STAY_SPACING.sectionToSection,
    }).toEqual({
      labelToHelper: 2,
      helperToInput: 8,
      fieldToFieldInRow: 16,
      fieldToFieldStacked: 24,
      sectionToSection: 32,
    });
    // Every value is an EXISTING token, not a magic number: the scale has to be
    // width-independent so it reads the same at 320, 390 and 440pt.
    const tokens = new Set(Object.values(spacing));
    for (const [name, value] of Object.entries(STAY_SPACING)) {
      expect({ name, isToken: tokens.has(value) }).toEqual({
        name,
        isToken: true,
      });
    }
  });

  it("D2-4 — the 144pt of dead page padding is gone, and the bar is real", () => {
    const DEAD_BOTTOM_NAV_PAD = spacing.xxl * 3; // 144 — sized for a nav this route never renders
    expect(DEAD_BOTTOM_NAV_PAD).toBe(144);
    expect(STAY_ACTION_BAR_HEIGHT).toBe(spacing.md + 52 + spacing.md);
    expect(STAY_PAGE_BOTTOM_PAD).toBe(STAY_ACTION_BAR_HEIGHT + spacing.md);
    // Strictly less: the two extra rows of wrapped module pills are PAID FOR.
    expect(STAY_PAGE_BOTTOM_PAD).toBeLessThan(DEAD_BOTTOM_NAV_PAD);
  });
});

// ===========================================================================
// DEFECT 4 — chrome does not react to the keyboard.
// ===========================================================================

describe("#1532 D4 — a chip row cannot inflate to keyboard height", () => {
  /** Measured on an iPhone 17 Pro Max: the pill went 36.7pt -> 323.7pt. */
  const MEASURED_CLOSED_PT = 36.7;
  const MEASURED_OPEN_PT = 323.7;

  it("D4-1 — POSITIVE CONTROL: the measured inflated row breaches the ceiling", () => {
    // The defect, expressed against the same ceiling the fix is held to. If the
    // ceiling could not reject 323.7pt it would not be a ceiling.
    expect(MEASURED_OPEN_PT).toBeGreaterThan(STAY_CHIP_ROW_MAX_HEIGHT);
    expect(MEASURED_OPEN_PT / MEASURED_CLOSED_PT).toBeGreaterThan(8);
  });

  it("D4-2 — a one-line chip row is a function of the chip only", () => {
    // A `Choice` chip: paddingVertical 8 x2 + bodySm line box 20 + hairline.
    const chipHeight = spacing.sm * 2 + typography.bodySm.lineHeight + 1;
    const height = stayChipRowHeight({
      chipHeight,
      contentPaddingVertical: 0,
    });
    expect(height).toBe(chipHeight);
    expect(height).toBeLessThanOrEqual(STAY_CHIP_ROW_MAX_HEIGHT);

    // The reservations tabs carry their own 2pt content padding and a 44pt
    // touch target — still under the ceiling.
    const tabbed = stayChipRowHeight({
      chipHeight: 44,
      contentPaddingVertical: spacing.xxs,
    });
    expect(tabbed).toBe(48);
    expect(tabbed).toBeLessThanOrEqual(STAY_CHIP_ROW_MAX_HEIGHT);
  });

  it("D4-3 — the ceiling is below any plausible keyboard frame", () => {
    // The smallest iOS keyboard frame in portrait is ~216pt. The ceiling has to
    // sit far below it, or a re-injected spacer could pass unnoticed.
    expect(STAY_CHIP_ROW_MAX_HEIGHT).toBeLessThan(216);
  });
});

// ===========================================================================
// DEFECT 3 — one dismissal funnel.
// ===========================================================================

describe("#1532 D3 — every exit routes through one funnel", () => {
  const SOURCES: readonly StayEditorCloseSource[] = [
    "cancel",
    "sheet-dismiss",
    "saved",
  ];

  it("D3-1 — a DIRTY draft confirms on every user-initiated exit", () => {
    const userExits = SOURCES.filter((source) => source !== "saved");
    // Vacuity guard: there really are user-initiated exits to check.
    expect(userExits.length).toBeGreaterThan(0);
    for (const source of userExits) {
      expect({
        source,
        decision: resolveStayEditorClose({ dirty: true, source }),
      }).toEqual({ source, decision: "confirm-discard" });
    }
  });

  it("D3-2 — a CLEAN draft closes immediately, from every exit", () => {
    for (const source of SOURCES) {
      expect({
        source,
        decision: resolveStayEditorClose({ dirty: false, source }),
      }).toEqual({ source, decision: "close" });
    }
  });

  it("D3-3 — a successful SAVE never prompts, even if `dirty` is stale", () => {
    // Decided by SOURCE, not by the flag. Otherwise a stale `dirty` would ask
    // an operator to discard work that is already on the server.
    expect(resolveStayEditorClose({ dirty: true, source: "saved" })).toBe(
      "close",
    );
  });

  it("D3-4 — the discard copy tells the truth about the photos", () => {
    // LOAD-BEARING: photos upload to storage the moment they are picked and
    // `stayMediaService` has no delete path for an unattached upload, so a
    // discarded draft really does orphan objects. Cleanup is #1539; saying so
    // is #1532's job, and a silent reword would take the honesty back out.
    expect(STAY_EDITOR_DISCARD_COPY.description).toContain("photos");
    expect(STAY_EDITOR_DISCARD_COPY.description).toContain("Nothing here is saved yet");
    // Cancel sits in the SAFE slot and does not say "Cancel" — in a dialog
    // raised BY a Cancel button, "Cancel" is genuinely ambiguous.
    expect(STAY_EDITOR_DISCARD_COPY.cancelLabel).toBe("Keep editing");
    expect(STAY_EDITOR_DISCARD_COPY.confirmLabel).toBe("Discard draft");
  });

  it("D3-5 — the editor title says what is actually being created", () => {
    // The shipped header was the constant "Add Rooms or Places" whatever the
    // operator had chosen, above a TopBar that always said "Stay".
    expect(
      stayEditorTitle({ existingName: null, kind: "room", bulk: false }),
    ).toBe("Add a Room");
    expect(
      stayEditorTitle({ existingName: null, kind: "place", bulk: false }),
    ).toBe("Add a Place");
    expect(
      stayEditorTitle({ existingName: null, kind: "place", bulk: true }),
    ).toBe("Add several Places");
    expect(
      stayEditorTitle({ existingName: null, kind: "room", bulk: true }),
    ).toBe("Add several Rooms");
    // Editing names the thing, and the existing name WINS over kind/bulk.
    expect(
      stayEditorTitle({ existingName: "Suite 4", kind: "place", bulk: true }),
    ).toBe("Edit Suite 4");
  });

  it("D3-6 — the readiness pill counts what is left, and says Ready at zero", () => {
    expect(stayEditorReadinessLabel(0)).toBe("Ready");
    expect(stayEditorReadinessLabel(1)).toBe("1 to go");
    expect(stayEditorReadinessLabel(4)).toBe("4 to go");
    // Defensive: a negative count is still "Ready", never "-1 to go".
    expect(stayEditorReadinessLabel(-2)).toBe("Ready");
  });
});
