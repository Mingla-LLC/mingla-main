/**
 * rsvpMomentum — ORCH-1157 [rsvp-public-redesign] Direction-C "Momentum" pure
 * helpers. Dep-free (no react / react-native imports) so the regression tests run
 * under Deno/node without a renderer (mirrors experienceOpenDaily.ts).
 *
 * The ONE owner of the HONEST momentum derivation: going COUNT + capacity METER +
 * the faceless anonymous cluster sizing + the derived sub-line. Constitution rule
 * 9 (no fabricated data) is enforced HERE: goingCount=0 → "Be the first to RSVP"
 * with an empty meter and ZERO cluster avatars; capacity=null → "Open invite" (no
 * scarcity); full → "Full · waitlist open" (state, NEVER a waitlist number).
 */

/** How many faceless avatar disks the cluster shows before the "+N" overflow. */
export const RSVP_CLUSTER_SHOWN = 3;

export interface RsvpMomentumModel {
  /** True only when there is at least one confirmed-going guest. */
  hasGoing: boolean;
  /** Honest derived sub-line under the count (never a fabricated scarcity). */
  subLabel: string;
  /** Meter fill 0..100 (a low fixed fill for unlimited-capacity open invites). */
  meterPercent: number;
  /** Number to render in the "+N" overflow chip (0 → no overflow chip). */
  overflowCount: number;
  /** How many faceless disks to draw (0..RSVP_CLUSTER_SHOWN). */
  shownAvatars: number;
}

/**
 * Derive the HONEST momentum copy + meter from the real columns ONLY.
 *   goingCount=0           → "Be the first to RSVP", meter 0, NO cluster
 *   capacity=null/≤0       → "Open invite", low fixed meter (momentum, not scarcity)
 *   spotsLeft=0            → "Full · waitlist open", meter 100 (state, no number)
 *   else                   → "N spots left · filling up / filling fast"
 */
export const deriveMomentum = (
  goingCount: number,
  capacity: number | null,
): RsvpMomentumModel => {
  const safeGoing =
    Number.isFinite(goingCount) && goingCount > 0 ? Math.floor(goingCount) : 0;
  if (safeGoing === 0) {
    return {
      hasGoing: false,
      subLabel: "Be the first to RSVP",
      meterPercent: 0,
      overflowCount: 0,
      shownAvatars: 0,
    };
  }

  const shownAvatars = Math.min(RSVP_CLUSTER_SHOWN, safeGoing);
  const overflowCount =
    safeGoing > RSVP_CLUSTER_SHOWN ? safeGoing - RSVP_CLUSTER_SHOWN : 0;

  if (capacity === null || !Number.isFinite(capacity) || capacity <= 0) {
    return {
      hasGoing: true,
      subLabel: "Open invite",
      meterPercent: 18,
      overflowCount,
      shownAvatars,
    };
  }

  const spotsLeft = Math.max(0, Math.floor(capacity) - safeGoing);
  const meterPercent = Math.min(100, Math.round((safeGoing / capacity) * 100));
  if (spotsLeft === 0) {
    return {
      hasGoing: true,
      subLabel: "Full · waitlist open",
      meterPercent: 100,
      overflowCount,
      shownAvatars,
    };
  }
  const fillingFast = meterPercent >= 80;
  return {
    hasGoing: true,
    subLabel: `${spotsLeft} ${spotsLeft === 1 ? "spot" : "spots"} left · ${
      fillingFast ? "filling fast" : "filling up"
    }`,
    meterPercent,
    overflowCount,
    shownAvatars,
  };
};

/** kebab-case canonical slug → "Title case" chip label (in-package; no app dep). */
export const partyTypeLabel = (slug: string): string =>
  slug
    .split("-")
    .filter((w) => w.length > 0)
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
