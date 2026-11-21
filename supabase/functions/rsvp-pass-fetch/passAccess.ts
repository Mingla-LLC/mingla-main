// Issue #4508 K — who may fetch an RSVP pass (metadata or PDF).
//
// The signed-in owner of the entity, or the signed-in owner of the party a
// guest pass belongs to. A plus-one's pass is theirs only once they have
// CLAIMED it: claiming is what makes the inviter and guest friends, shows
// "Brought by" and joins the Guest chat, so an account a number merely
// matched gets "claim your pass" (409 claim_required) instead of the pass.
// The party owner (the inviter) keeps their read. Guest rows matched before
// #4508 were backfilled as claimed, so their owners keep fetching as before.

export type PassAccess =
  | { ok: true }
  | { ok: false; status: number; error: "sign_in_required" | "claim_required" };

export function passAccess(input: {
  role: "primary" | "guest";
  userId: string | null;
  ownerUserId: string | null;
  parentOwnerUserId: string | null;
  guestClaimed: boolean;
}): PassAccess {
  const entityOwner = input.userId !== null &&
    input.ownerUserId === input.userId;
  const partyOwner = input.userId !== null &&
    input.parentOwnerUserId === input.userId;
  if (!entityOwner && !partyOwner) {
    return { ok: false, status: 403, error: "sign_in_required" };
  }
  if (input.role === "guest" && !partyOwner && !input.guestClaimed) {
    return { ok: false, status: 409, error: "claim_required" };
  }
  return { ok: true };
}
