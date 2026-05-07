/**
 * brand-mingla-tos-accept — records the calling user's acceptance of the
 * Mingla Business platform Terms of Service for a brand.
 *
 * Per B2a Path C V3 SPEC §6 + I-PROPOSED-U (ToS gate before Stripe Connect).
 *
 * Updates `brand_team_members.mingla_tos_accepted_at = now()` and
 * `mingla_tos_version_accepted = $version` for the (user_id, brand_id) pair.
 * Authenticated only (`requireUserId`); auth role must satisfy
 * `requirePaymentsManager` (i.e., the user is a brand admin who would
 * also be eligible to start Stripe onboarding).
 *
 * Audit log entry on success per I-PROPOSED-S.
 *
 * Returns: { accepted_at: string, version: string }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { writeAudit } from "../_shared/audit.ts";
import {
  corsHeaders,
  isValidUuid,
  jsonResponse,
  requirePaymentsManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/stripeEdgeAuth.ts";

interface AcceptRequestBody {
  brand_id?: string;
  brandId?: string;
  version?: string;
}

interface AcceptedRow {
  mingla_tos_accepted_at: string;
  mingla_tos_version_accepted: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const userIdOrResponse = await requireUserId(req);
  if (userIdOrResponse instanceof Response) return userIdOrResponse;
  const userId = userIdOrResponse;

  let body: AcceptRequestBody;
  try {
    body = (await req.json()) as AcceptRequestBody;
  } catch {
    return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
  }

  const brandId = body.brand_id ?? body.brandId;
  if (!isValidUuid(brandId)) {
    return jsonResponse({ error: "validation_error", detail: "brand_id_invalid_uuid" }, 400);
  }

  // Version is operator-controlled; UI passes the current ToS version. Reject empty.
  const version =
    typeof body.version === "string" && body.version.trim().length > 0
      ? body.version.trim()
      : null;
  if (version === null) {
    return jsonResponse(
      { error: "validation_error", detail: "version_required" },
      400,
    );
  }

  const supabase = serviceRoleClient();

  // Same gate as Stripe ops: only brand admins / finance managers / account
  // owners can accept ToS on behalf of the brand. This prevents any
  // non-payment-manager team member (e.g., scanner) from clicking through
  // the gate.
  const forbidden = await requirePaymentsManager(supabase, brandId, userId);
  if (forbidden) return forbidden;

  const acceptedAt = new Date().toISOString();

  const { data: updateRow, error: updateErr } = await supabase
    .from("brand_team_members")
    .update({
      mingla_tos_accepted_at: acceptedAt,
      mingla_tos_version_accepted: version,
    })
    .eq("brand_id", brandId)
    .eq("user_id", userId)
    .select("mingla_tos_accepted_at, mingla_tos_version_accepted")
    .single<AcceptedRow>();

  if (updateErr) {
    console.error("[brand-mingla-tos-accept] update failed:", updateErr);
    return jsonResponse({ error: "update_failed", detail: updateErr.message }, 500);
  }

  if (!updateRow) {
    return jsonResponse(
      { error: "membership_not_found", detail: "no brand_team_members row for this user_id + brand_id" },
      404,
    );
  }

  await writeAudit(supabase, {
    actor_user_id: userId,
    action: "mingla_tos_accept",
    target_table: "brand_team_members",
    target_id: brandId,
    metadata: {
      brand_id: brandId,
      version_accepted: version,
      accepted_at: updateRow.mingla_tos_accepted_at,
    },
  });

  return jsonResponse({
    accepted_at: updateRow.mingla_tos_accepted_at,
    version: updateRow.mingla_tos_version_accepted,
  });
});
