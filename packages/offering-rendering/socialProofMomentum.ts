/**
 * socialProofMomentum — ORCH-1339 [momentum-card-cross-entity] (META-ORCH-1337).
 *
 * The ONE owner of the HONEST cross-entity (ticketed event / trip / experience)
 * momentum derivation: going/booked COUNT + capacity METER + glyph-cluster
 * sizing + the entity-appropriate sub-line. Dep-free (no react / react-native
 * imports — mirrors rsvpMomentum.ts) so the regression tests run under
 * Deno/node without a renderer.
 *
 * Constitution rule 9 (missing is hidden, never faked) is enforced HERE:
 *   - #3827: privateGuestList / goingCount null → visible:false (private
 *                              means no box; a withheld count is never 0).
 *   - display (real + extras) <= 0 → visible:false (NO unit; no "be the first"
 *                              fabrication next to possibly sold-out/ended
 *                              tickets — the shared RSVP unit keeps its own
 *                              zero-state in rsvpMomentum.ts).
 *   - capacity null / hidden → NO availability claim (sub-line omitted; a
 *                              "Tickets available" string could be false when
 *                              tiers are ended/door-only — omission is the only
 *                              always-honest copy). Fixed low meter fill.
 *   - full                   → per-entity full string (state, never a number
 *                              beyond the count + spots-left).
 *
 * D2 (sealed): `hideRemainingCount` hides scarcity for DISPLAY only — the
 * effective capacity becomes null (count kept, sub-line omitted, fixed low
 * meter). Decision/CTA math elsewhere NEVER uses this display capacity.
 *
 * COMMS-0057 / single-owner: the RSVP derivation stays SOLELY in
 * rsvpMomentum.ts::deriveMomentum — this function deliberately has NO branch
 * for that entity type (a lookup miss returns the invisible model). Do not
 * merge the two derivations.
 */

// Type-only import (erased at runtime — the module stays dep-free/deno-
// runnable exactly like rsvpMomentum.ts; Deno never fetches type-only imports).
import type { SocialProofEntityType, SocialProofSummary } from "./socialProofTypes";

/**
 * Cluster size — BYTE-PARITY with rsvpMomentum.RSVP_CLUSTER_SHOWN (the spec's
 * "reuse the exact semantics" contract). Kept as a LOCAL constant so this
 * module carries zero value imports (deno-runnable without extensions); the
 * orch_1339 regression test pins the two constants equal.
 */
const CLUSTER_SHOWN = 3;

export interface SocialProofMomentumModel {
  /** False → the unit is NOT rendered at all (honest absence, zero layout). */
  visible: boolean;
  /** The word after the count ("going" / "booked"). */
  countLabel: string;
  /** Honest derived sub-line; null = OMITTED (capacity null/hidden — rule 9). */
  subLabel: string | null;
  /** Meter fill 0..100 (fixed low fill when capacity is null/hidden). */
  meterPercent: number;
  /** How many faceless glyph disks to draw (0..CLUSTER_SHOWN). */
  shownGlyphs: number;
  /** Number for the "+N" overflow chip (0 → no overflow chip). */
  overflowCount: number;
  /** The cluster tail note ("are pulling up" / "are on this trip" / …). */
  clusterNote: string;
  /** #3827 — the going NUMBER to render: real + the host's own-list guests. */
  displayCount: number;
  /** #3827 — faces / overflow / "See who's going" only when real > 0. */
  showCluster: boolean;
  /** #3827 — false when real is 0 beside a shown capacity (no empty track). */
  showMeter: boolean;
}

/** Per-entity copy table (SPEC_ORCH-1339 §4.3 — decided copy, Seth veto at review). */
interface EntityMomentumCopy {
  countLabel: string;
  fullLabel: string;
  clusterNote: string;
}

const ENTITY_COPY: Record<"event" | "trip" | "experience", EntityMomentumCopy> = {
  event: {
    countLabel: "going",
    fullLabel: "Sold out",
    clusterNote: "are pulling up",
  },
  trip: {
    countLabel: "going",
    fullLabel: "Trip full",
    clusterNote: "are on this trip",
  },
  experience: {
    countLabel: "booked",
    fullLabel: "Fully booked",
    clusterNote: "have booked this",
  },
};

const INVISIBLE: SocialProofMomentumModel = {
  visible: false,
  countLabel: "",
  subLabel: null,
  meterPercent: 0,
  shownGlyphs: 0,
  overflowCount: 0,
  clusterNote: "",
  displayCount: 0,
  showCluster: false,
  showMeter: false,
};

/** Whole number >= 0, anything else (NaN, negative, non-number) is 0. */
const safeWhole = (n: number | null | undefined): number =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

/** The fixed low "momentum, not scarcity" fill (byte-parity with rsvpMomentum). */
const OPEN_FILL_PERCENT = 18;

/**
 * Derive the HONEST cross-entity momentum copy + meter from the server payload
 * ONLY. Handles event / trip / experience; any other entity type returns the
 * invisible model (the RSVP unit has its own single owner — COMMS-0057).
 */
export const deriveSocialProofMomentum = (
  summary: Pick<
    SocialProofSummary,
    "entityType" | "goingCount" | "capacity" | "hideRemainingCount"
  > &
    Partial<Pick<SocialProofSummary, "privateGuestList" | "extraGuestCount">>,
): SocialProofMomentumModel => {
  const copy = (
    ENTITY_COPY as Partial<Record<SocialProofEntityType, EntityMomentumCopy>>
  )[summary.entityType];
  if (copy === undefined) return INVISIBLE;

  // issue #3827 going-box — a private guest list hides the WHOLE box, and a
  // withheld (null) count is never rendered as 0. Rule 9.
  if (summary.privateGuestList === true || summary.goingCount === null) {
    return INVISIBLE;
  }

  // issue #3827 going-box — `real` drives every supply claim (meter, spots
  // left, full); `display` (real + the host's own-list guests) is only the
  // going NUMBER. Extras never consume a Mingla spot.
  const real = safeWhole(summary.goingCount);
  const display = real + safeWhole(summary.extraGuestCount ?? 0);
  if (display === 0) return INVISIBLE;

  // issue #3827 going-box — faces and "See who's going" only when somebody
  // real is going (an extras-only box has nobody to list).
  const showCluster = real > 0;
  const shownGlyphs = showCluster ? Math.min(CLUSTER_SHOWN, display) : 0;
  const overflowCount =
    showCluster && display > CLUSTER_SHOWN ? display - CLUSTER_SHOWN : 0;

  // D2 — effective capacity for DISPLAY only.
  const capacity = summary.hideRemainingCount ? null : summary.capacity;

  if (capacity === null || !Number.isFinite(capacity) || capacity <= 0) {
    return {
      visible: true,
      countLabel: copy.countLabel,
      subLabel: null, // omitted — the only always-honest string (rule 9).
      meterPercent: OPEN_FILL_PERCENT,
      shownGlyphs,
      overflowCount,
      clusterNote: copy.clusterNote,
      displayCount: display,
      showCluster,
      showMeter: true,
    };
  }

  const spotsLeft = Math.max(0, Math.floor(capacity) - real);
  const spotsCopy = `${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left`;
  if (real === 0) {
    // issue #3827 going-box — extras only beside a shown capacity: every spot
    // is still open, no "filling" claim, and no empty meter track (R-3b).
    return {
      visible: true,
      countLabel: copy.countLabel,
      subLabel: spotsCopy,
      meterPercent: 0,
      shownGlyphs,
      overflowCount,
      clusterNote: copy.clusterNote,
      displayCount: display,
      showCluster,
      showMeter: false,
    };
  }
  const meterPercent = Math.min(100, Math.round((real / capacity) * 100));
  if (spotsLeft === 0) {
    return {
      visible: true,
      countLabel: copy.countLabel,
      subLabel: copy.fullLabel,
      meterPercent: 100,
      shownGlyphs,
      overflowCount,
      clusterNote: copy.clusterNote,
      displayCount: display,
      showCluster,
      showMeter: true,
    };
  }
  const fillingFast = meterPercent >= 80;
  return {
    visible: true,
    countLabel: copy.countLabel,
    subLabel: `${spotsCopy} · ${fillingFast ? "filling fast" : "filling up"}`,
    meterPercent,
    shownGlyphs,
    overflowCount,
    clusterNote: copy.clusterNote,
    displayCount: display,
    showCluster,
    showMeter: true,
  };
};
