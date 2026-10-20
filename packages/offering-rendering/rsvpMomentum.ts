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
  /** #3827 — the going NUMBER to render: real + the host's own-list guests. */
  displayCount: number;
  /** #3827 — false when real is 0 beside a shown capacity (no empty track). */
  showMeter: boolean;
}

const safeWhole = (n: number): number =>
  Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

/**
 * Derive the HONEST momentum copy + meter from the real columns ONLY.
 *   goingCount=0           → "Be the first to RSVP", meter 0, NO cluster
 *   capacity=null/≤0       → "Open invite", low fixed meter (momentum, not scarcity)
 *   spotsLeft=0            → "Full · waitlist open", meter 100 (state, no number)
 *   else                   → "N spots left · filling up / filling fast"
 *
 * issue #3827 going-box — `extraGuestCount` (guests on the host's own list) is
 * added to `displayCount` ONLY. `hasGoing`, the meter, spots left and full all
 * stay on the real count: extras never consume a Mingla spot. Real 0 with
 * extras says "N spots left" / "Open invite", never "Be the first to RSVP".
 */
export const deriveMomentum = (
  goingCount: number,
  capacity: number | null,
  extraGuestCount = 0,
): RsvpMomentumModel => {
  const safeGoing = safeWhole(goingCount);
  const extra = safeWhole(extraGuestCount);
  const display = safeGoing + extra;
  const capOk = capacity !== null && Number.isFinite(capacity) && capacity > 0;
  if (safeGoing === 0) {
    if (extra === 0) {
      return {
        hasGoing: false,
        subLabel: "Be the first to RSVP",
        meterPercent: 0,
        overflowCount: 0,
        shownAvatars: 0,
        displayCount: 0,
        showMeter: !capOk,
      };
    }
    // issue #3827 going-box — extras only: no faces, every spot still open.
    if (capOk) {
      const cap = Math.floor(capacity as number);
      return {
        hasGoing: false,
        subLabel: `${cap} ${cap === 1 ? "spot" : "spots"} left`,
        meterPercent: 0,
        overflowCount: 0,
        shownAvatars: 0,
        displayCount: display,
        showMeter: false,
      };
    }
    return {
      hasGoing: false,
      subLabel: "Open invite",
      meterPercent: 18,
      overflowCount: 0,
      shownAvatars: 0,
      displayCount: display,
      showMeter: true,
    };
  }

  const shownAvatars = Math.min(RSVP_CLUSTER_SHOWN, display);
  const overflowCount =
    display > RSVP_CLUSTER_SHOWN ? display - RSVP_CLUSTER_SHOWN : 0;

  if (!capOk) {
    return {
      hasGoing: true,
      subLabel: "Open invite",
      meterPercent: 18,
      overflowCount,
      shownAvatars,
      displayCount: display,
      showMeter: true,
    };
  }

  const cap = capacity as number;
  const spotsLeft = Math.max(0, Math.floor(cap) - safeGoing);
  const meterPercent = Math.min(100, Math.round((safeGoing / cap) * 100));
  if (spotsLeft === 0) {
    return {
      hasGoing: true,
      subLabel: "Full · waitlist open",
      meterPercent: 100,
      overflowCount,
      shownAvatars,
      displayCount: display,
      showMeter: true,
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
    displayCount: display,
    showMeter: true,
  };
};

/** kebab-case canonical slug → "Title case" chip label (in-package; no app dep). */
export const partyTypeLabel = (slug: string): string =>
  slug
    .split("-")
    .filter((w) => w.length > 0)
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");

export interface RsvpMomentumSubLabelOptions {
  /** events.rsvp_waitlist_enabled — when known to be OFF a full list reads "Full". */
  waitlistEnabled?: boolean;
  /** #3827 — guests on the host's own list (going number only). */
  extraGuestCount?: number;
}

/**
 * The sub-line the public RSVP card actually renders. Starts from
 * `deriveMomentum` (the one owner of the momentum model) and adds what a guest
 * needs that the model's zero-state leaves out:
 *
 *   goingCount=0 + capacity N → "Be the first to RSVP · N spots"
 *     The page used to say only "Be the first to RSVP" under an empty meter, so
 *     a guest never learned an 80-person event HAD 80 spots. Callers pass the
 *     DISPLAY capacity (null under "Hide the spots-left count"), so a host who
 *     hides the count still gets the bare line.
 *   full + waitlist known OFF → "Full"
 *     "Full · waitlist open" promised a waitlist the host had switched off.
 *
 * Every other state returns `deriveMomentum`'s sub-line unchanged.
 */
export const rsvpMomentumSubLabel = (
  goingCount: number,
  displayCapacity: number | null,
  options: RsvpMomentumSubLabelOptions = {},
): string => {
  const extra = options.extraGuestCount ?? 0;
  const model = deriveMomentum(goingCount, displayCapacity, extra);
  // issue #3827 going-box — extras-only: the model's own line, no " · N spots".
  if (!model.hasGoing && model.displayCount > 0) return model.subLabel;
  const cap =
    displayCapacity !== null && Number.isFinite(displayCapacity) && displayCapacity > 0
      ? Math.floor(displayCapacity)
      : null;
  if (!model.hasGoing) {
    return cap === null
      ? model.subLabel
      : `${model.subLabel} · ${cap} ${cap === 1 ? "spot" : "spots"}`;
  }
  const spotsLeft = cap === null ? null : cap - Math.floor(goingCount);
  if (spotsLeft !== null && spotsLeft <= 0 && options.waitlistEnabled === false) {
    return "Full";
  }
  return model.subLabel;
};

export interface RsvpCapacityChipInput {
  /** Capacity shown to guests: null under "Hide the spots-left count" or no cap. */
  displayCapacity: number | null;
  /** The server's full flag (real count only). */
  capacityFull: boolean;
  waitlistEnabled: boolean;
}

/**
 * issue #3827 going-box (R-4) — the one capacity chip an RSVP page shows when
 * the going box is absent (private list, or nobody going yet). It never reveals
 * how many are going: a total, or a full state, only.
 */
export const rsvpCapacityChipLabel = (
  input: RsvpCapacityChipInput,
): string | null => {
  if (input.capacityFull) {
    return input.waitlistEnabled ? "Full · waitlist open" : "Full";
  }
  const cap = input.displayCapacity;
  if (cap !== null && Number.isFinite(cap) && cap > 0) {
    const n = Math.floor(cap);
    return `${n} ${n === 1 ? "spot" : "spots"}`;
  }
  return null;
};
