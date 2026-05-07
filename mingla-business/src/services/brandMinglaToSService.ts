/**
 * brandMinglaToSService — Mingla Business platform ToS acceptance surface.
 *
 * Per B2a Path C V3 SPEC §6 + I-PROPOSED-U.
 *
 * Two operations:
 *  - fetchMinglaToSAcceptance(brandId, userId) — reads brand_team_members
 *    to check current acceptance state.
 *  - acceptMinglaToS(brandId, version) — invokes brand-mingla-tos-accept
 *    edge fn to record acceptance.
 *
 * Error contract per Const #3: throws on Postgrest/edge-fn error.
 */

import { supabase } from "./supabase";

export interface MinglaToSAcceptanceState {
  /** ISO timestamp when accepted; null if not yet */
  acceptedAt: string | null;
  /** Version string accepted; null if not yet */
  versionAccepted: string | null;
}

interface RawAcceptanceRow {
  mingla_tos_accepted_at: string | null;
  mingla_tos_version_accepted: string | null;
}

/**
 * Reads current ToS acceptance state for the given user + brand.
 * Returns acceptedAt=null when the user has not yet accepted.
 */
export async function fetchMinglaToSAcceptance(
  brandId: string,
  userId: string,
): Promise<MinglaToSAcceptanceState> {
  const { data, error } = await supabase
    .from("brand_team_members")
    .select("mingla_tos_accepted_at, mingla_tos_version_accepted")
    .eq("brand_id", brandId)
    .eq("user_id", userId)
    .maybeSingle<RawAcceptanceRow>();

  if (error) throw error;
  if (!data) {
    // No membership row — treat as not accepted; gate will block onboarding.
    return { acceptedAt: null, versionAccepted: null };
  }
  return {
    acceptedAt: data.mingla_tos_accepted_at,
    versionAccepted: data.mingla_tos_version_accepted,
  };
}

export interface AcceptMinglaToSResult {
  acceptedAt: string;
  version: string;
}

interface RawAcceptResponse {
  accepted_at?: string;
  version?: string;
}

/**
 * Records the calling user's acceptance for a brand. Always passes through the
 * edge fn (never writes the table directly from the client) so audit log +
 * permission check happen server-side.
 */
export async function acceptMinglaToS(
  brandId: string,
  version: string,
): Promise<AcceptMinglaToSResult> {
  const { data, error } = await supabase.functions.invoke<RawAcceptResponse>(
    "brand-mingla-tos-accept",
    { body: { brand_id: brandId, version } },
  );
  if (error) throw error;
  if (data === null || !data.accepted_at || !data.version) {
    throw new Error("acceptMinglaToS: edge fn returned malformed payload");
  }
  return { acceptedAt: data.accepted_at, version: data.version };
}
