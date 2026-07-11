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
 *   - goingCount <= 0        → visible:false (NO unit; no "be the first"
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
};

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
  >,
): SocialProofMomentumModel => {
  const copy = (
    ENTITY_COPY as Partial<Record<SocialProofEntityType, EntityMomentumCopy>>
  )[summary.entityType];
  if (copy === undefined) return INVISIBLE;

  const safeGoing =
    Number.isFinite(summary.goingCount) && summary.goingCount > 0
      ? Math.floor(summary.goingCount)
      : 0;
  if (safeGoing === 0) return INVISIBLE;

  const shownGlyphs = Math.min(CLUSTER_SHOWN, safeGoing);
  const overflowCount =
    safeGoing > CLUSTER_SHOWN ? safeGoing - CLUSTER_SHOWN : 0;

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
    };
  }

  const spotsLeft = Math.max(0, Math.floor(capacity) - safeGoing);
  const meterPercent = Math.min(100, Math.round((safeGoing / capacity) * 100));
  if (spotsLeft === 0) {
    return {
      visible: true,
      countLabel: copy.countLabel,
      subLabel: copy.fullLabel,
      meterPercent: 100,
      shownGlyphs,
      overflowCount,
      clusterNote: copy.clusterNote,
    };
  }
  const fillingFast = meterPercent >= 80;
  return {
    visible: true,
    countLabel: copy.countLabel,
    subLabel: `${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left · ${
      fillingFast ? "filling fast" : "filling up"
    }`,
    meterPercent,
    shownGlyphs,
    overflowCount,
    clusterNote: copy.clusterNote,
  };
};
