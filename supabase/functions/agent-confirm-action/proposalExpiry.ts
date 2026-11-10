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

/**
 * #3355 bundle 5 — the claim-time expiry answer. Only the request whose
 * expire wins re-presents the flow step (a double tap shows one card), and
 * only for an Ari proposal; the 409 envelope is the same either way.
 */
export async function answerClaimExpired(args: {
  source: string | null | undefined;
  terminalize: () => Promise<void>;
  represent: () => Promise<void>;
  hubExpired: () => Response;
}): Promise<Response> {
  let expiredHere = false;
  try {
    await args.terminalize();
    expiredHere = true;
  } catch {
    // Another request terminalized it first; the answer is the same, and
    // that request re-presents the step.
  }
  if (expiredProposalAnswer(args.source) !== "ari_proposal_expired") {
    return args.hubExpired();
  }
  if (expiredHere) await args.represent();
  return ariProposalExpiredResponse();
}
