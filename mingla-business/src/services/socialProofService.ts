/**
 * socialProofService — ORCH-1339 [momentum-card-cross-entity] (META-ORCH-1337).
 *
 * The business-app/buyer-web read for the ONE privacy-aware social-proof
 * payload (`pg_public_social_proof`, ORCH-1338 — anon-callable SECURITY
 * DEFINER RPC; safe on the anon buyer routes). The payload keys are
 * camelCase-identical to the frozen `SocialProofSummary` contract
 * (packages/offering-rendering/socialProofTypes.ts) — NO client mapping layer
 * by design. Identical contract to app-mobile/src/services/socialProofService.ts
 * (business supabase client).
 *
 * Error posture (SPEC §4.5-B): json `null` → null (event missing / not public
 * → the momentum unit is simply omitted); RPC error → THROW (React Query owns
 * retry; callers render nothing on error — the page renders exactly as today).
 *
 * Query keys: Constitution #4 — one key factory per entity, no hardcoded key
 * strings at the query sites (PublicEventPage + the /t and /exp routes all
 * key off this factory). mingla-business has no central queryKeys file, so the
 * entity's factory lives with its service (single owner).
 */

import { supabase } from "./supabase";
import type { SocialProofSummary } from "@mingla/offering-rendering";

export const socialProofKeys = {
  all: ["socialProof"] as const,
  summary: (eventId: string) => [...socialProofKeys.all, eventId] as const,
};

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
