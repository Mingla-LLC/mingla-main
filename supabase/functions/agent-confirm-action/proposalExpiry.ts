/**
 * #2830 (D-3) — how an expired proposal answers.
 *
 * Ari proposals get an explicit, terminal 409 PROPOSAL_EXPIRED: nothing was
 * saved, and the Host tells the owner so instead of clearing the card as if
 * it had succeeded. Hub proposals (menu / brochure snaps) keep their 200
 * `expired_regenerate` re-snap contract, which only the Hub knows how to act
 * on. Kept out of index.ts so tests can import it without starting the server.
 */

import { ariErrorResponse } from "../_shared/agentReliabilityHttp.ts";

export function expiredProposalAnswer(
  source: string | null | undefined,
): "ari_proposal_expired" | "hub_regenerate" {
  return source === "hub_experience" || source === "hub_trip_day"
    ? "hub_regenerate"
    : "ari_proposal_expired";
}

export function ariProposalExpiredResponse(): Response {
  // The owner copy is registry-owned (ARI_ERROR_REGISTRY.PROPOSAL_EXPIRED).
  return ariErrorResponse(
    409,
    "PROPOSAL_EXPIRED",
    "That approval timed out, so nothing was saved.",
  );
}
