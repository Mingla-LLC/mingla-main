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
import type { SocialProofSummary } from "@mingla/offering-rendering";

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
