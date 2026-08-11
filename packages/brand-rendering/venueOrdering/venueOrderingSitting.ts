// ===========================================================================
// Issue #1793 — the SITTING, remembered across rounds.
//
// SET-B: may sell, may never touch money. Not a single price is stored here.
//
// WHY THIS EXISTS. OQ-2, standing: the tip is asked on the FIRST round of a
// sitting and remembered thereafter — changeable at any round, never re-asked
// unprompted. The memory itself is SERVER-SIDE, on
// `venue_order_sessions.tip_bps_choice`; what a guest's device has to keep is
// the HANDLE to that sitting, so round two says "same table, same evening"
// instead of minting a second session. Without it a four-round table is four
// sittings, the tip question is asked four times, and spend-per-cover — the
// number this whole programme exists to measure — is divided by the wrong
// denominator.
//
// WHAT IS STORED, AND WHY IT IS NOT A SERVER RECORD. Ids and opaque tokens:
// the sitting id, the last order id, its status/cancel tokens, the tip CHOICE
// the guest made, their own party-size estimate, and an expiry. No prices, no
// menu, no order contents, no venue record — nothing fetched. That distinction
// is the house rule (`feedback_zustand_persist_no_server_snapshots`): a
// persisted copy of a server object goes stale and starts lying; a persisted id
// asks the server again and cannot.
//
// AND IT EXPIRES. A sitting is an evening, not an account. Four hours after the
// last round the handle is gone and the next order starts a new sitting, which
// is exactly right — the table has turned over and the person holding the phone
// may not even be the same person.
// ===========================================================================

import type { VenueOrderTipChoice } from "./venueOrderingTypes";

/** Four hours. Long enough for a long dinner, short enough not to span a day. */
export const VENUE_ORDER_SITTING_TTL_MS = 4 * 60 * 60 * 1000;

export interface VenueOrderSitting {
  sessionId: string;
  /** The most recent round, so a returning guest lands on its live status. */
  orderId: string | null;
  buyerStatusToken: string | null;
  guestCancelToken: string | null;
  /** OQ-2 — the answer that must never be asked for twice. */
  tip: VenueOrderTipChoice;
  /** Asked ONCE per sitting, optional, the guest's own estimate. */
  partySizeClaimed: number | null;
  buyerName: string;
  expiresAt: number;
}

/**
 * The storage key. Scoped to the SPOT when there is one, because a sitting is a
 * table's evening — two people at two tables in one venue are two sittings, and
 * a venue-scoped key would splice them together. A counter guest is scoped to
 * the venue, which is the truest handle available when nobody scanned anything.
 */
export function venueOrderSittingKey(input: {
  venueId: string | null;
  spotCode: string | null;
}): string | null {
  if (input.spotCode !== null && input.spotCode.trim() !== "") {
    return `mingla.venueOrderSitting.spot.${input.spotCode.trim()}`;
  }
  if (input.venueId !== null && input.venueId.trim() !== "") {
    return `mingla.venueOrderSitting.venue.${input.venueId.trim()}`;
  }
  return null;
}

/**
 * Parse a stored sitting, returning null for anything expired, malformed or of
 * an unrecognised shape. Fails toward FORGETTING: a sitting we cannot read is a
 * sitting we do not have, and the guest is asked once more. The opposite
 * failure — resurrecting a half-parsed handle — would attach tonight's round to
 * last week's session id and hand a stranger's tab an extra course.
 */
export function parseVenueOrderSitting(
  raw: string | null,
  now: number,
): VenueOrderSitting | null {
  if (raw === null || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  if (typeof row.sessionId !== "string" || row.sessionId === "") return null;
  const expiresAt = Number(row.expiresAt ?? 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  const tip = (row.tip ?? null) as Record<string, unknown> | null;
  return {
    sessionId: row.sessionId,
    orderId: typeof row.orderId === "string" ? row.orderId : null,
    buyerStatusToken: typeof row.buyerStatusToken === "string"
      ? row.buyerStatusToken
      : null,
    guestCancelToken: typeof row.guestCancelToken === "string"
      ? row.guestCancelToken
      : null,
    tip: {
      bps: tip !== null && Number.isInteger(tip.bps) ? Number(tip.bps) : null,
      flatCents: tip !== null && Number.isInteger(tip.flatCents)
        ? Number(tip.flatCents)
        : null,
    },
    partySizeClaimed: Number.isInteger(row.partySizeClaimed)
      ? Number(row.partySizeClaimed)
      : null,
    buyerName: typeof row.buyerName === "string" ? row.buyerName : "",
    expiresAt,
  };
}

export function serialiseVenueOrderSitting(
  sitting: Omit<VenueOrderSitting, "expiresAt">,
  now: number,
): string {
  const payload: VenueOrderSitting = {
    ...sitting,
    expiresAt: now + VENUE_ORDER_SITTING_TTL_MS,
  };
  return JSON.stringify(payload);
}

/**
 * Has this sitting already been asked "how many of you?"
 *
 * The question is asked ONCE per sitting and skipping it is free (D-10: party
 * size is a metric input, never a payment mechanic). A guest who skipped it is
 * not asked again on round two either — nagging someone mid-meal for a number
 * they declined to give is exactly the behaviour "optional" is supposed to rule
 * out. So the trigger is "is this a new sitting", not "did they answer".
 */
export function venueOrderShouldAskPartySize(
  sitting: VenueOrderSitting | null,
): boolean {
  return sitting === null;
}

/**
 * The tip after a sitting resolves, applied to a screen that is already on.
 *
 * OQ-2 says the tip is asked ONCE and remembered. A sitting is read from disk
 * (native) or from `localStorage` (web), which lands at least one render after
 * the screen mounted — so "remembered" has to be applied late, and applying it
 * late must never overwrite an answer the guest has meanwhile given with their
 * thumb. That is the entire rule, and it is a pure function so it can be driven
 * directly rather than inferred from a rendered chip.
 */
export function venueOrderTipAfterHydration(input: {
  current: VenueOrderTipChoice;
  /** Has the guest touched the tip on THIS screen? */
  touched: boolean;
  remembered: VenueOrderTipChoice | null;
}): VenueOrderTipChoice {
  if (input.touched) return input.current;
  if (input.remembered === null) return input.current;
  return input.remembered;
}

/** The same rule for the name: fill a blank, never overwrite what was typed. */
export function venueOrderNameAfterHydration(
  current: string,
  remembered: string,
): string {
  return current.trim() === "" ? remembered : current;
}
