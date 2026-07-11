/**
 * socialProofService — ORCH-1339 [momentum-card-cross-entity] (META-ORCH-1337).
 *
 * The consumer-app read for the ONE privacy-aware social-proof payload
 * (`pg_public_social_proof`, ORCH-1338 — anon-callable SECURITY DEFINER RPC).
 * The payload keys are camelCase-identical to the frozen
 * `SocialProofSummary` contract (packages/offering-rendering/socialProofTypes.ts)
 * — NO client mapping layer by design.
 *
 * Error posture (SPEC §4.5-A): json `null` → null (event missing / not public
 * → the momentum unit is simply omitted); RPC error → THROW (React Query owns
 * retry; callers render nothing on error). Fail-OPEN is identity-safe in this
 * leg because clusters are glyph-only; ORCH-1340 inherits fail-CLOSE
 * automatically since real avatars exist only inside this payload.
 */

import { supabase } from "./supabase";
import type {
  PeerGuestListPage,
  SocialProofSummary,
} from "@mingla/offering-rendering";

export const fetchSocialProof = async (
  eventId: string,
): Promise<SocialProofSummary | null> => {
  const { data, error } = await supabase.rpc("pg_public_social_proof", {
    p_event_id: eventId,
  });
  if (error !== null) {
    throw new Error(error.message);
  }
  if (data === null || data === undefined) return null;
  return data as SocialProofSummary;
};

// ─── ORCH-1341 [guest-list-sheet-consumer] — peer guest-list read ────────────
//
// `peer_list_event_guests` (ORCH-1338, authed-only SECURITY DEFINER RPC) is the
// ONE privacy-final guest read: named rows only where D1 allows, anonymous rows
// otherwise, blocked pairs excluded SERVER-side (the client never re-filters —
// SPEC ORCH-1341 §4.4/T-8). Hard row-cap 100 — ONE page, no offset-walking in
// v1 (`hasMore` + the host's goingCount drive the "and N more" tail).
//
// Error contract (SPEC §4.1, discriminated as lightweight Error subclasses so
// the sheet can pick states): `guest_list_private` → GuestListGatedError (the
// designed lock state — an EMPTY state, not an error); `event_not_available` →
// GuestListUnavailableError (error+retry state); anything else (network,
// `authentication_required` — unreachable in the authed app) → generic Error.

/** Host flipped `privateGuestList` ON between card render and this read (D2). */
export class GuestListGatedError extends Error {
  readonly code = "guest_list_private";
}

/** Event missing / not public / not readable for this viewer. */
export class GuestListUnavailableError extends Error {
  readonly code = "event_not_available";
}

export const fetchPeerGuestList = async (
  eventId: string,
): Promise<PeerGuestListPage> => {
  const { data, error } = await supabase.rpc("peer_list_event_guests", {
    p_event_id: eventId,
    p_limit: 100,
  });
  if (error !== null) {
    const message = error.message ?? "peer_guest_list_failed";
    if (message.includes("guest_list_private")) {
      throw new GuestListGatedError(message);
    }
    if (message.includes("event_not_available")) {
      throw new GuestListUnavailableError(message);
    }
    throw new Error(message);
  }
  // Payload keys are camelCase-identical to the frozen PeerGuestListPage
  // contract (packages/offering-rendering/socialProofTypes.ts) — no mapping.
  return data as PeerGuestListPage;
};
