/**
 * #1532 [stay-manager-ux] — the Stay manager's LAYOUT + DISMISSAL contracts,
 * as EXECUTABLE values rather than numbers scattered through six StyleSheets.
 *
 * WHY THIS FILE EXISTS. Three of the four defects Seth reported on a physical
 * iPhone were geometry, and every one of them was invisible to the render
 * suites that were green at the time:
 *
 *   - the cards declared `gap: 16` on a node with ONE in-flow child, so the
 *     rendered field-to-field gap was 0.0pt (#1532 defect 2);
 *   - the module pill row inflated 36.7pt -> 323.7pt on a keystroke, because a
 *     keyboard-aware wrapper appended its keyboard-height spacer as a ROW ITEM
 *     in a HORIZONTAL scroller (#1532 defect 4);
 *   - the editor was an inline early-return, so switching tab changed the pill
 *     and not the content (#1532 defect 3).
 *
 * Numbers that live only inside `StyleSheet.create` cannot be asserted without
 * a full mount, and a mount assertion that reads `undefined` passes in both
 * directions (the #1484 / #1501 unfalsifiable-test trap, four times running).
 * Exporting the contract makes the geometry a VALUE a test can compute against
 * — and makes a silent revert of the scale arithmetically impossible to hide.
 *
 * Nothing here imports React or react-native components: it is pure data plus
 * pure functions, so it runs under the DEFAULT node/ts-jest config where the
 * required `mingla-business jest suite` check actually lives.
 */

import { spacing, typography } from "../../constants/designSystem";

// ---------------------------------------------------------------------------
// §4 — the spacing scale that never rendered.
// ---------------------------------------------------------------------------

/**
 * The approved scale: 2 / 8 / 16 / 24 / 32, every value an existing token and
 * every value width-independent (so it reads identically at 320, 390 and
 * 440pt). Each key names the BOUNDARY it governs, not the element it sits on —
 * the boundary is the thing an operator's eye actually groups by.
 */
export const STAY_SPACING = {
  /** label -> its own helper. Tightest pair on the screen; they are one unit. */
  labelToHelper: spacing.xxs,
  /** helper -> its own input. Still inside one field. */
  helperToInput: spacing.sm,
  /** field <-> field SIDE BY SIDE (inside `styles.row`). */
  fieldToFieldInRow: spacing.md,
  /** field -> field STACKED in a card. The boundary that measured 0.0pt. */
  fieldToFieldStacked: spacing.lg,
  /** section title -> its caption. */
  sectionTitleToCaption: spacing.xxs,
  /** section caption -> the card beneath it. */
  captionToCard: spacing.sm,
  /** section -> section. */
  sectionToSection: spacing.xl,
  /** card interior padding. */
  cardPadding: spacing.md,
} as const;

/**
 * The pinned action bar's own height: `spacing.md` above a `size="lg"` Button
 * (52) and `spacing.md` below. Values lifted from the shipped trip dock
 * (`EditPublishedTripScreen.tsx` `styles.dock`), which is the precedent this
 * bar copies rather than reinvents. The device's bottom safe-area inset is
 * added at render time and is NOT part of this constant — it is not a layout
 * decision, it is a hardware fact that varies per device.
 */
export const STAY_ACTION_BAR_HEIGHT = spacing.md + 52 + spacing.md;

/**
 * Every Stay page's scroll bottom padding.
 *
 * REPLACES `spacing.xxl * 3` (144pt) — dead space sized for a bottom nav that
 * `/venue/[venueId]` does not render (it lives OUTSIDE `app/(tabs)/`), so it
 * gives back 44pt of real workspace on every Stay page.
 *
 * IT DOES NOT PAY FOR THE PILL ROW, and an earlier version of this comment said
 * it did. Measured on device (#1532 tester): the wrapped module band is THREE
 * rows / 142.0pt, not the two rows / 96pt the design computed — the pills are
 * content-sized and total ~813pt, so they wrap to three rows at 440, 402, 390
 * and 360 alike. Band 53 -> 142.0pt is +89pt against 44pt reclaimed here, so the
 * net is -45pt of workspace. Recorded rather than quietly dropped: the
 * requirement (all six destinations visible at rest) is met, the cost is real,
 * and it is Seth's call, not this constant's.
 */
export const STAY_PAGE_BOTTOM_PAD = STAY_ACTION_BAR_HEIGHT + spacing.md;

/** Half-leading: the empty band a line box puts above/below the glyph ink. */
const halfLeading = (token: {
  readonly fontSize: number;
  readonly lineHeight: number;
}): number => (token.lineHeight - token.fontSize) / 2;

export interface StayFieldProximity {
  /** helper INK bottom -> its own input's top border, in points. */
  readonly cohesionPt: number;
  /** input bottom border -> the NEXT field's label INK top, in points. */
  readonly separationPt: number;
  /** separation : cohesion. Must be > 1 or proximity is inverted. */
  readonly ratio: number;
}

/**
 * THE NUMBER THIS ISSUE IS ABOUT.
 *
 * Gestalt proximity says the eye groups whatever is closest. On the shipped
 * build a field's input sat CLOSER to the NEXT field's label than to its own
 * helper, so the eye grouped the wrong things and the form read as noise —
 * measured on-device at 7.3pt vs 16.7pt, a ratio of 0.44.
 *
 * Measured here in the line-box model the styles actually compose, stated
 * explicitly so the before/after are comparable:
 *
 *   cohesion   = caption half-leading + the field wrapper's `gap`
 *   separation = the card CONTENT node's `gap` + bodySm half-leading
 *
 * `stackGap` is the card's CONTENT-node gap on purpose. Passing the gap the
 * card declares on its CHROME node reproduces the bug: it renders as 0.
 */
export function stayFieldProximity(input: {
  readonly fieldGap: number;
  readonly stackGap: number;
}): StayFieldProximity {
  const cohesionPt = halfLeading(typography.caption) + input.fieldGap;
  const separationPt = input.stackGap + halfLeading(typography.bodySm);
  return {
    cohesionPt,
    separationPt,
    ratio: cohesionPt === 0 ? Number.POSITIVE_INFINITY : separationPt / cohesionPt,
  };
}

/** The proximity the shipped scale produces. */
export const STAY_FIELD_PROXIMITY: StayFieldProximity = stayFieldProximity({
  fieldGap: STAY_SPACING.helperToInput,
  stackGap: STAY_SPACING.fieldToFieldStacked,
});

/**
 * The floor a regression may not cross. 2.5 rather than the shipped 2.7 so a
 * deliberate future retune has room, but any return to a ratio <= 1 — i.e. any
 * return to INVERTED proximity, which is the actual defect — fails.
 */
export const STAY_FIELD_PROXIMITY_MIN_RATIO = 2.5;

// ---------------------------------------------------------------------------
// §2 — chrome does not react to the keyboard.
// ---------------------------------------------------------------------------

/**
 * The ceiling a Stay chip/tab row may occupy with the keyboard up.
 *
 * On the shipped build the module row measured 36.7pt closed and 323.7pt open —
 * an 8.8x inflation that left the workspace at ~0pt, so the field being typed
 * into and the Save button were both off-screen. 56pt is one 44pt touch target
 * plus its padding: enough for any single row of chips, far below anything a
 * keyboard-height spacer could produce.
 */
export const STAY_CHIP_ROW_MAX_HEIGHT = 56;

/**
 * Rendered height of a one-line chip row. `alignItems: "center"` on the content
 * container is LOAD-BEARING and is why this is a function of the CHIP height
 * only: RN's default `stretch` is what let a 324pt sibling drag every chip to
 * 324pt tall.
 */
export function stayChipRowHeight(input: {
  readonly chipHeight: number;
  readonly contentPaddingVertical: number;
}): number {
  return input.chipHeight + input.contentPaddingVertical * 2;
}

// ---------------------------------------------------------------------------
// §3 — the editor is a committed task, with ONE dismissal funnel.
// ---------------------------------------------------------------------------

/**
 * Every way out of the offering editor. They are enumerated because the bug was
 * that they were NOT: `X` dropped 23 fields silently, a module pill left the
 * content frozen, Android back popped the whole manager, and none of the three
 * agreed with the others.
 */
export type StayEditorCloseSource =
  /** The header `Cancel` — the affordance that did not exist. */
  | "cancel"
  /** Scrim tap or drag-to-dismiss on the sheet, and Android hardware back. */
  | "sheet-dismiss"
  /** A save that actually succeeded: nothing is unsaved, so nothing to guard. */
  | "saved";

export type StayEditorCloseDecision = "close" | "confirm-discard";

/**
 * THE FUNNEL. Every exit routes through here; a clean draft closes at once, a
 * dirty one raises a `ConfirmDialog`. A successful save is never dirty by
 * definition, so it is decided by SOURCE and not by the flag — otherwise a
 * stale `dirty` would prompt the operator to discard work that is already on
 * the server.
 */
export function resolveStayEditorClose(input: {
  readonly dirty: boolean;
  readonly source: StayEditorCloseSource;
}): StayEditorCloseDecision {
  if (input.source === "saved") return "close";
  return input.dirty ? "confirm-discard" : "close";
}

/**
 * The discard copy. The photo sentence is LOAD-BEARING HONESTY, not softening:
 * `stayMediaService.ts` uploads on pick and has NO delete path for an unattached
 * upload, so a discarded draft really does leave objects in the bucket. The
 * storage cleanup is #1539; telling the operator the truth in the meantime is
 * this issue's job.
 */
export const STAY_EDITOR_DISCARD_COPY = {
  title: "Discard this draft?",
  description:
    "Nothing here is saved yet — including the photos you’ve added.",
  /** The SAFE slot. `ConfirmDialog` renders it first, as the secondary button. */
  cancelLabel: "Keep editing",
  confirmLabel: "Discard draft",
} as const;

/**
 * The editor's live title. The shipped header said "Add Rooms or Places" no
 * matter what the operator had chosen, and the TopBar above it said "Stay" —
 * so the editor was an unlabelled navigation level.
 */
export function stayEditorTitle(input: {
  readonly existingName: string | null;
  readonly kind: "room" | "place";
  readonly bulk: boolean;
}): string {
  if (input.existingName !== null) return `Edit ${input.existingName}`;
  const singular = input.kind === "room" ? "Room" : "Place";
  const plural = input.kind === "room" ? "Rooms" : "Places";
  return input.bulk ? `Add several ${plural}` : `Add a ${singular}`;
}

/** The header readiness pill: `Ready`, or how many items are still outstanding. */
export function stayEditorReadinessLabel(pendingCount: number): string {
  return pendingCount <= 0 ? "Ready" : `${pendingCount} to go`;
}
