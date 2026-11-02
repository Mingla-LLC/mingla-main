/**
 * Issue #3355 P3 — honest words when Ari's model loop stops.
 *
 * The loop only reads; every write becomes a protected proposal the owner
 * approves separately. So when the loop stops without a proposal, nothing was
 * changed, and that is what Ari says. It never claims "I kept the completed
 * steps and can resume" (nothing was kept) or "I have stated the blocker
 * below" when nothing is below. When a step was refused for a verified reason
 * (a typed domain refusal from the database), Ari names that reason.
 */

import { assertOwnerCopy } from "../ariOwnerCopy.ts";
import { DOMAIN_REFUSED_CODE } from "../ariRefusalCopy.ts";

export const ARI_OUT_OF_TIME_LINE =
  "I ran out of time before I could finish, so nothing was changed. Ask me again and I'll start fresh.";
export const ARI_STEP_LIMIT_LINE =
  "That needed more steps than I can take in one go, so I stopped. Nothing was changed. Ask me again, one part at a time.";
export const ARI_LOOP_PROBLEM_LINE =
  "I ran into a problem getting what I needed, so I stopped. Nothing was changed. Try again in a moment.";

export function honestLoopStopText(
  reason: string,
  observations: ReadonlyArray<
    { error?: { code: string; message: string } | undefined }
  >,
): string {
  if (reason === "deadline") return ARI_OUT_OF_TIME_LINE;
  if (reason === "budget") return ARI_STEP_LIMIT_LINE;
  const refusal = observations.find((observation) =>
    observation.error?.code === DOMAIN_REFUSED_CODE &&
    observation.error.message.trim().length > 0
  );
  if (refusal?.error) {
    const verified = assertOwnerCopy(refusal.error.message.trim(), {
      fallback: "",
      surface: "loop_refusal",
      mode: "prose",
    });
    if (verified) return `I couldn't do that. ${verified}`;
  }
  return ARI_LOOP_PROBLEM_LINE;
}
