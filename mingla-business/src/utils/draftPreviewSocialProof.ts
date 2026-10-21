/**
 * issue #3827 going-box (amendment §5.6) — what a host's DRAFT preview shows in
 * the going box, so the preview matches what buyers will see at launch.
 *
 * A draft has nobody going yet (real 0). The only thing that can make a box
 * appear is "Guests on your own list": with none, or with a private list, there
 * is no box at all — exactly the buyer page. With some, the preview shows the
 * extras-only box (count, "N spots left" when a capacity is shown, no faces).
 *
 * Preview only: this object is never sent anywhere. Pure, so it is tested
 * directly.
 */

import type { SocialProofSummary } from "@mingla/offering-rendering";

import { asExtraGuestCount } from "../constants/guestListPrivacy";

export interface DraftPreviewSocialProofInput {
  eventId: string;
  entityType: "event" | "trip" | "experience";
  extraGuestCount: number | undefined;
  privateGuestList: boolean;
  hideRemainingCount: boolean;
  /** The draft's total capacity; null = unlimited / unknown. */
  capacity: number | null;
}

export const buildDraftPreviewSocialProof = (
  input: DraftPreviewSocialProofInput,
): SocialProofSummary | null => {
  const extra = asExtraGuestCount(input.extraGuestCount ?? 0);
  if (input.privateGuestList || extra === 0) return null;
  return {
    eventId: input.eventId,
    entityType: input.entityType,
    goingCount: 0,
    extraGuestCount: extra,
    capacity:
      input.capacity !== null && Number.isFinite(input.capacity) && input.capacity > 0
        ? Math.floor(input.capacity)
        : null,
    privateGuestList: false,
    hideRemainingCount: input.hideRemainingCount,
    sample: [],
    capacityFull: false,
  };
};

/** Σ ticket capacities, or null when any tier is unlimited / uncapped. */
export const draftTicketCapacity = (
  tickets: ReadonlyArray<{ capacity?: number | null; isUnlimited?: boolean }>,
): number | null => {
  if (tickets.length === 0) return null;
  let total = 0;
  for (const t of tickets) {
    if (t.isUnlimited === true) return null;
    if (typeof t.capacity !== "number" || !Number.isFinite(t.capacity)) return null;
    total += t.capacity;
  }
  return total;
};
