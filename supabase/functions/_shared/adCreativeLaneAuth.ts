// Issue #3040 — who may drive an `ad_creative` video-lane upload.
//
// An ad upload is private to its requester. A house (brandless) upload belongs
// to an active Admin, matched by the caller's email exactly as
// admin-ad-creative-upload already does; a brand upload follows the brand's ad
// plan permission (`ad_can_host_action(..., 'plan')`), so a marketing manager
// who can plan ads can also add an ad video (C-15).
//
// Kept free of environment reads and provider imports so both the video lane
// (eventCoverVideo.requireCoverVideoTargetManager) and the ads functions share
// one rule.

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export type AdCreativeLaneSelector = {
  brandId: string | null;
  draftOwnerKey: string | null;
  requestedBy?: string | null;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (input: unknown): input is string =>
  typeof input === "string" && UUID_REGEX.test(input);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Issue #3040 — the owner key of an `ad_creative` upload names where the
// finished video belongs: the Admin library of one admin, one Host Ads draft,
// or one Ari proposal.
export type AdCreativeOwnerKey = {
  kind: "admin-library" | "host-ad" | "ari";
  id: string;
};

const AD_CREATIVE_OWNER_KEY_RE = /^(admin-library|host-ad|ari):([A-Za-z0-9_-]{3,120})$/;

export function parseAdCreativeOwnerKey(
  key: unknown,
): AdCreativeOwnerKey | null {
  if (typeof key !== "string") return null;
  const match = AD_CREATIVE_OWNER_KEY_RE.exec(key);
  if (!match) return null;
  return { kind: match[1] as AdCreativeOwnerKey["kind"], id: match[2] };
}

// Issue #3040 — an active Admin, matched by the caller's email exactly as
// admin-ad-creative-upload already does.
async function callerIsActiveAdmin(
  supabase: SupabaseLike,
  userId: string,
): Promise<boolean | Response> {
  const { data: userData, error: userError } = await supabase.auth.admin
    .getUserById(userId);
  if (userError) {
    console.error("[event-cover-video] admin user read failed:", {
      code: userError.code ?? null,
    });
    return jsonResponse({
      error: "internal_error",
      detail: "admin_check_failed",
    }, 500);
  }
  const email = userData?.user?.email;
  if (typeof email !== "string" || email.length === 0) return false;
  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", email)
    .eq("status", "active")
    .maybeSingle();
  if (adminError) {
    console.error("[event-cover-video] admin row read failed:", {
      code: adminError.code ?? null,
    });
    return jsonResponse({
      error: "internal_error",
      detail: "admin_check_failed",
    }, 500);
  }
  return Boolean(adminRow);
}

async function requireAdCreativeUploader(
  supabase: SupabaseLike,
  selector: AdCreativeLaneSelector,
  userId: string,
): Promise<Response | null> {
  if (selector.brandId === null) {
    const admin = await callerIsActiveAdmin(supabase, userId);
    if (admin instanceof Response) return admin;
    return admin ? null : jsonResponse(
      { error: "forbidden", detail: "permission_denied" },
      403,
    );
  }
  if (!isValidUuid(selector.brandId)) {
    return jsonResponse({
      error: "validation_error",
      detail: "brand_id_invalid_uuid",
    }, 400);
  }
  const { data: canPlan, error } = await supabase.rpc("ad_can_host_action", {
    p_brand_id: selector.brandId,
    p_user_id: userId,
    p_action: "plan",
  });
  if (error) {
    console.error("[event-cover-video] ad plan permission failed:", {
      code: error.code ?? null,
    });
    return jsonResponse({
      error: "internal_error",
      detail: "role_check_failed",
    }, 500);
  }
  return canPlan === true ? null : jsonResponse(
    { error: "forbidden", detail: "permission_denied" },
    403,
  );
}


// Returns null when the caller may drive this upload, otherwise the refusal.
export async function requireAdCreativeLaneAccess(
  supabase: SupabaseLike,
  selector: AdCreativeLaneSelector,
  userId: string,
): Promise<Response | null> {
  if (
    selector.requestedBy !== undefined && selector.requestedBy !== null &&
    selector.requestedBy !== userId
  ) {
    return jsonResponse(
      { error: "forbidden", detail: "draft_owner_mismatch" },
      403,
    );
  }
  if (parseAdCreativeOwnerKey(selector.draftOwnerKey) === null) {
    return jsonResponse({
      error: "validation_error",
      detail: "draft_owner_key_invalid",
    }, 400);
  }
  return await requireAdCreativeUploader(supabase, selector, userId);
}
